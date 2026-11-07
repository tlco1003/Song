"""SONG-Vision v13: trainable articulation -> prosody -> emotion -> fusion.

Input: EXISTING aligned singer vocal (Mel + measured acoustic cues), static
reference face and observed face-surface labels from licensed video.
Output: lip pixels and 38 visible facial-motion coefficients. NO AUDIO GENERATED.

Stage 1 learns visually observed consonant/vowel articulation. Exact Korean
consonant/vowel cross-entropy is used ONLY for externally HUMAN-REVIEWED phone
timelines tied to the real vocal SHA256; never fabricated from audio.
Stage 2 learns strength/attack/sustain-conditioned *changes* in articulation.
Stage 3 learns eyes/brows/cheek/mouth-corner expression, optionally using
RAVDESS PORTRAYED emotion classes (not objectively inferred internal affect).
Stage 4 learns a shared motion+lip decoder; prior stages are jointly tuned.

The network is research code: it does not generate full 96x96 facial pixels or
muscle EMG, it does not prove cross-lingual phone recognition and cannot be
used for paid customer songs. This file does not modify prior v2-v12 weights.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
import torch
from torch import nn
from torch.nn import functional as F
from torch.utils.data import DataLoader, Dataset

from .core import FACE_SIZE, AUDIO_CONTEXT, NUM_MELS
from .facial_articulation_v10 import (
    FEATURE_COUNT, TARGET_NAMES, _crop_mouth, motion_error,
)
from .masked_retrain import masked_loss, masked_mae
from .phoneme_targets_v13 import (
    CONSONANTS, VOWELS, IGNORE_LABEL, read_reviewed_phone_timeline,
    labels_at_second,
)
from .real_training import validate_prepared
from .projected_iris_v13 import IRIS_COUNT, IRIS_FEATURES, iris_motion_from_private_face_labels
from .voice_to_face_v11 import VoiceFaceFrames, VocalDrivenFaceNet
from .vocal_acoustics import CUE_COUNT, CUE_CONTEXT

MODEL_VERSION = "song-vision-articulation-prosody-emotion-fusion-v13"
STAGES = ("articulation", "prosody", "emotion", "fusion")
PORTRAYED_EMOTION_CODES = ("02", "03", "04", "05", "06")
PORTRAYED_EMOTION_NAMES = ("calm", "happy", "sad", "angry", "fearful")

ARTICULATION_NAMES = (
    "lipGapEyeScaled", "mouthWidthEyeScaled",
    "lowerLipVerticalToNose", "chinVerticalToNose", "jawOpenBlendshape",
    "mouthClose", "mouthFunnel", "mouthPucker",
    "mouthPressLeft", "mouthPressRight", "mouthStretchLeft", "mouthStretchRight",
    "mouthLowerDownLeft", "mouthLowerDownRight",
    "mouthUpperUpLeft", "mouthUpperUpRight",
)
EXPRESSION_NAMES = (
    "leftCheekVerticalToEye", "rightCheekVerticalToEye",
    "leftCheekHorizontalToNose", "rightCheekHorizontalToNose",
    "cheekPuffBlendshape", "cheekSquintLeftBlendshape",
    "cheekSquintRightBlendshape", "eyeBlinkLeft", "eyeBlinkRight",
    "eyeSquintLeft", "eyeSquintRight", "eyeWideLeft", "eyeWideRight",
    "browInnerUp", "browDownLeft", "browDownRight",
    "noseSneerLeft", "noseSneerRight", "jawLeft", "jawRight",
    "mouthSmileLeft", "mouthSmileRight",
)
ART_IDS = tuple(TARGET_NAMES.index(name) for name in ARTICULATION_NAMES)
EXPR_IDS = tuple(TARGET_NAMES.index(name) for name in EXPRESSION_NAMES)
PROSODY_IDS = tuple(sorted(set(ART_IDS) | {
    TARGET_NAMES.index("cheekPuffBlendshape"),
    TARGET_NAMES.index("cheekSquintLeftBlendshape"),
    TARGET_NAMES.index("cheekSquintRightBlendshape"),
}))
if len(TARGET_NAMES) != FEATURE_COUNT or len(CONSONANTS) != 13 or len(VOWELS) != 5:
    raise RuntimeError("Unexpected v13 articulatory/visible-surface taxonomy")


def _acted_emotion_index(clip_id: str) -> int:
    """Only known acted source labels. Never infer emotions from personal video."""
    parts = clip_id.split("-")
    if len(parts) == 8 and parts[:3] == ["ravdess", "01", "02"]:
        if parts[3] not in PORTRAYED_EMOTION_CODES:
            raise ValueError("Unknown acted RAVDESS source class")
        return PORTRAYED_EMOTION_CODES.index(parts[3])
    return IGNORE_LABEL


class StagedFaceFrames(VoiceFaceFrames):
    """Same genuine audio/video pairing + OPTIONAL human-reviewed phone labels."""
    def __init__(self, root: Path):
        super().__init__(root)
        self.timelines = {}
        self.acted_labels = {}
        self.iris_labels = {}
        self.reviewed_consonant_samples = 0
        self.reviewed_vowel_samples = 0
        for folder, *_ in self.records:
            if folder in self.timelines:
                continue
            meta = json.loads((folder / "index.json").read_text(encoding="utf-8"))
            clip_id = meta["clipId"]
            self.acted_labels[folder] = _acted_emotion_index(clip_id)
            with np.load(folder / "face-surface-v1.npz", allow_pickle=False) as detected:
                iris_value, iris_ok = iris_motion_from_private_face_labels(
                    detected["surfacePoints"], detected["valid"])
            if len(iris_value) != len(meta["frames"]):
                raise ValueError("Unmatched iris/eye motion and vocal video frames")
            self.iris_labels[folder] = {
                row["file"]: (iris_value[i].copy(), bool(iris_ok[i]))
                for i, row in enumerate(meta["frames"])
            }
            annotation_file = folder / "phones-reviewed-v13.json"
            if annotation_file.exists():
                self.timelines[folder] = read_reviewed_phone_timeline(
                    annotation_file, meta["sourceVocalsSha256"])
            else:
                self.timelines[folder] = None
        for folder, target, *_ in self.records:
            consonant, vowel = labels_at_second(
                self.timelines[folder], float(target["seconds"]))
            self.reviewed_consonant_samples += int(consonant != IGNORE_LABEL)
            self.reviewed_vowel_samples += int(vowel != IGNORE_LABEL)

    def __getitem__(self, index):
        base = super().__getitem__(index)
        folder, target, *_ = self.records[index]
        consonant, vowel = labels_at_second(
            self.timelines[folder], float(target["seconds"]))
        iris_value, iris_valid = self.iris_labels[folder][target["file"]]
        return base + (
            torch.tensor(consonant, dtype=torch.long),
            torch.tensor(vowel, dtype=torch.long),
            torch.tensor(self.acted_labels[folder], dtype=torch.long),
            torch.from_numpy(iris_value.copy()),
            torch.tensor(iris_valid, dtype=torch.bool),
        )


class StagedSingingFaceNet(nn.Module):
    """Explicitly independent trainable branches + differentiable composer.

    The input FACE is a reference face, NOT the target video at the same time.
    A frozen backbone is used in stages 1-3 and optionally updated in stage 4.
    This prevents sound volume from being a fixed mouth opening multiplier.
    """
    def __init__(self):
        super().__init__()
        self.backbone = VocalDrivenFaceNet()
        self.articulation_encoder = nn.Sequential(
            nn.Conv1d(NUM_MELS, 48, 3, padding=1), nn.GELU(),
            nn.Conv1d(48, 64, 3, padding=1), nn.GELU(),
            nn.AdaptiveAvgPool1d(3), nn.Flatten(),
            nn.Linear(64 * 3, 128), nn.GELU(),
        )
        self.articulation_head = nn.Sequential(
            nn.Linear(128, 96), nn.GELU(), nn.Linear(96, FEATURE_COUNT),
        )
        self.consonant_head = nn.Linear(128, len(CONSONANTS))
        self.vowel_head = nn.Linear(128, len(VOWELS))
        self.prosody_encoder = nn.Sequential(
            nn.Conv1d(CUE_COUNT, 32, 5, padding=2), nn.GELU(),
            nn.Conv1d(32, 64, 5, padding=2), nn.GELU(),
            nn.AdaptiveAvgPool1d(4), nn.Flatten(),
            nn.Linear(64 * 4, 128), nn.GELU(),
        )
        self.prosody_head = nn.Sequential(
            nn.Linear(128, 96), nn.GELU(), nn.Linear(96, FEATURE_COUNT),
        )
        self.emotion_face_encoder = nn.Sequential(
            nn.Conv2d(3, 24, 4, 2, 1), nn.GELU(),
            nn.Conv2d(24, 40, 4, 2, 1), nn.GELU(),
            nn.Conv2d(40, 48, 4, 2, 1), nn.GELU(),
            nn.AdaptiveAvgPool2d((2, 2)), nn.Flatten(),
        )
        # Acoustic cues + articulation context + visible reference face;
        # emotion branch is NOT a psychological diagnosis.
        self.emotion_encoder = nn.Sequential(
            nn.Linear(48 * 2 * 2 + 128 + 128, 192), nn.GELU(),
            nn.Linear(192, 128), nn.GELU(),
        )
        self.emotion_head = nn.Linear(128, FEATURE_COUNT)
        self.portrayed_emotion_head = nn.Linear(128, len(PORTRAYED_EMOTION_CODES))
        self.projected_iris_head = nn.Linear(128, IRIS_COUNT)
        self.prosody_gate = nn.Parameter(torch.tensor(-.75))
        self.emotion_gate = nn.Parameter(torch.tensor(-.75))
        self.image_correction = nn.Sequential(
            nn.Linear(FEATURE_COUNT, 48 * 4 * 4), nn.GELU(),
            nn.Unflatten(1, (48, 4, 4)),
            nn.ConvTranspose2d(48, 32, 4, 2, 1), nn.GELU(),
            nn.ConvTranspose2d(32, 24, 4, 2, 1), nn.GELU(),
            nn.ConvTranspose2d(24, 16, 4, 2, 1), nn.GELU(),
            nn.ConvTranspose2d(16, 3, 4, 2, 1), nn.Tanh(),
        )

    def forward(self, face: torch.Tensor, mel: torch.Tensor,
                cues: torch.Tensor, *, stage: str = "fusion") -> dict:
        if stage not in STAGES:
            raise ValueError("Unknown face training stage")
        if (face.ndim != 4 or face.shape[1:] != (3, FACE_SIZE, FACE_SIZE) or
                mel.ndim != 3 or mel.shape[1:] != (NUM_MELS, AUDIO_CONTEXT) or
                cues.ndim != 3 or cues.shape[1:] != (CUE_COUNT, CUE_CONTEXT) or
                not face.shape[0] == mel.shape[0] == cues.shape[0]):
            raise ValueError("Expected aligned face [B,3,96,96], Mel [B,80,21], cue [B,8,61]")
        mouth_base, motion_base = self.backbone(face, mel, cues)
        a_context = self.articulation_encoder(mel)
        p_context = self.prosody_encoder(cues)
        e_visual = self.emotion_face_encoder(face)
        e_context = self.emotion_encoder(
            torch.cat((e_visual, a_context, p_context), dim=1))
        articulation = motion_base + torch.tanh(self.articulation_head(a_context))
        prosody_delta = torch.tanh(self.prosody_head(p_context))
        expression_delta = torch.tanh(self.emotion_head(e_context))
        motion = articulation
        if stage in ("prosody", "emotion", "fusion"):
            motion = motion + torch.sigmoid(self.prosody_gate) * prosody_delta
        if stage in ("emotion", "fusion"):
            motion = motion + torch.sigmoid(self.emotion_gate) * expression_delta
        motion = motion.clamp(-2., 2.)
        mouth = (mouth_base + .08 * self.image_correction(motion)).clamp(0., 1.)
        return {
            "mouth": mouth, "motion": motion,
            "articulation": articulation,
            "prosodyDelta": prosody_delta,
            "emotionDelta": expression_delta,
            "consonantLogits": self.consonant_head(a_context),
            "vowelLogits": self.vowel_head(a_context),
            "portrayedEmotionLogits": self.portrayed_emotion_head(e_context),
            "projectedIrisMotion": 2. * torch.tanh(self.projected_iris_head(e_context)),
        }


def configure_stage(model: StagedSingingFaceNet, stage: str):
    """Gradients only update designated branch until final integrated stage."""
    if stage not in STAGES:
        raise ValueError("Invalid train stage")
    for p in model.parameters():
        p.requires_grad_(stage == "fusion")
    groups = {
        "articulation": ("articulation_encoder", "articulation_head",
                         "consonant_head", "vowel_head"),
        "prosody": ("prosody_encoder", "prosody_head"),
        "emotion": ("emotion_face_encoder", "emotion_encoder",
                    "emotion_head", "portrayed_emotion_head",
                    "projected_iris_head"),
    }
    if stage != "fusion":
        for name in groups[stage]:
            for p in getattr(model, name).parameters():
                p.requires_grad_(True)
        if stage == "prosody":
            model.prosody_gate.requires_grad_(True)
        if stage == "emotion":
            model.emotion_gate.requires_grad_(True)
    if not any(p.requires_grad for p in model.parameters()):
        raise AssertionError("Stage has no trainable parameters")


def _supervised_ce(logits, labels) -> tuple[torch.Tensor, int]:
    mask = labels != IGNORE_LABEL
    n = int(mask.sum())
    if not n:
        # Zero loss and ZERO pretending that unseen classes were learned.
        return logits.sum() * 0., 0
    if int(labels[mask].min()) < 0 or int(labels[mask].max()) >= logits.shape[-1]:
        raise ValueError("Unsupported manually reviewed phoneme/emotion label")
    return F.cross_entropy(logits[mask], labels[mask]), n


def _iris_mae(predicted, observed, observed_valid):
    if predicted.ndim != 2 or predicted.shape != observed.shape or predicted.shape[1] != IRIS_COUNT:
        raise ValueError("Projected iris dimensions must be B x 4")
    if observed_valid.ndim != 1 or len(observed_valid) != len(predicted):
        raise ValueError("Projected iris validity mask must be per frame")
    weights = observed_valid.to(dtype=predicted.dtype)
    if float(weights.sum()) == 0.:
        return predicted.sum() * 0.
    return ((predicted - observed).abs().mean(dim=1) * weights).sum() / weights.sum()


def _stage_loss(model, batch, stage: str) -> tuple[torch.Tensor, dict]:
    (face, mel, cues, true_mouth, motion_gt, next_mel, next_cues,
     next_motion, wrong_mel, wrong_cues, consonant, vowel, acted,
     iris_observed, iris_valid) = batch
    out = model(face, mel, cues, stage=stage)
    phone_c, n_c = _supervised_ce(out["consonantLogits"], consonant)
    phone_v, n_v = _supervised_ce(out["vowelLogits"], vowel)
    acted_loss, acted_count = _supervised_ce(out["portrayedEmotionLogits"], acted)
    supervision = {
        "verifiedConsonantFrames": n_c, "verifiedVowelFrames": n_v,
        "portrayedEmotionFrames": acted_count,
    }
    if stage == "articulation":
        return (motion_error(out["motion"], motion_gt, ART_IDS) +
                .20 * (phone_c + phone_v)), supervision
    if stage == "prosody":
        later = model(face, next_mel, next_cues, stage=stage)
        return (motion_error(out["motion"], motion_gt, PROSODY_IDS) +
                .15 * motion_error(later["motion"] - out["motion"],
                                   next_motion - motion_gt, PROSODY_IDS)), supervision
    if stage == "emotion":
        return (motion_error(out["motion"], motion_gt, EXPR_IDS) +
                .12 * acted_loss +
                .04 * _iris_mae(out["projectedIrisMotion"], iris_observed, iris_valid)), supervision
    later = model(face, next_mel, next_cues, stage=stage)
    shifted = model(face, wrong_mel, wrong_cues, stage=stage)
    correct = motion_error(out["motion"], motion_gt, ART_IDS)
    wrong = motion_error(shifted["motion"], motion_gt, ART_IDS)
    loss = (
        masked_loss(out["mouth"], true_mouth) +
        .36 * motion_error(out["motion"], motion_gt) +
        .12 * motion_error(later["motion"] - out["motion"],
                           next_motion - motion_gt) +
        .07 * F.relu(.015 + correct - wrong) +
        .10 * (phone_c + phone_v) +
        .04 * acted_loss +
        .02 * _iris_mae(out["projectedIrisMotion"], iris_observed, iris_valid)
    )
    return loss, supervision


def evaluate_stage(model, loader, stage, device: str) -> dict:
    model.eval()
    totals = {
        "mouthMaskedMAE": 0., "copyReferenceMAE": 0.,
        "articulationMAE": 0., "neutralArticulationMAE": 0.,
        "emotionSurfaceMAE": 0., "neutralEmotionSurfaceMAE": 0.,
        "overallMotionMAE": 0., "temporalChangeMAE": 0.,
        "matchedVsShiftedAudioGain": 0., "voiceMotionSensitivity": 0.,
    }
    count = 0
    iris_error_sum = 0.
    iris_total = 0
    pc_hits = pv_hits = pe_hits = pc_total = pv_total = pe_total = 0
    with torch.no_grad():
        for packed in loader:
            (face, mel, cues, mouth, motion, next_mel, next_cues,
             future_motion, wrong_mel, wrong_cues, consonant, vowel, acted,
             iris_observed, iris_valid) = [
                x.to(device) for x in packed
            ]
            out = model(face, mel, cues, stage=stage)
            predicted = out["motion"]
            later = model(face, next_mel, next_cues, stage=stage)["motion"]
            wrong = model(face, wrong_mel, wrong_cues, stage=stage)["motion"]
            values = {
                "mouthMaskedMAE": masked_mae(out["mouth"], mouth),
                "copyReferenceMAE": masked_mae(_crop_mouth(face), mouth),
                "articulationMAE": motion_error(predicted, motion, ART_IDS),
                "neutralArticulationMAE": motion_error(torch.zeros_like(motion), motion, ART_IDS),
                "emotionSurfaceMAE": motion_error(predicted, motion, EXPR_IDS),
                "neutralEmotionSurfaceMAE": motion_error(torch.zeros_like(motion), motion, EXPR_IDS),
                "overallMotionMAE": motion_error(predicted, motion),
                "temporalChangeMAE": motion_error(later - predicted, future_motion - motion),
                "matchedVsShiftedAudioGain": (
                    motion_error(wrong, motion, ART_IDS) -
                    motion_error(predicted, motion, ART_IDS)),
                "voiceMotionSensitivity": (wrong - predicted).abs().mean(),
            }
            n = len(face)
            valid_iris = iris_valid.to(dtype=face.dtype)
            iris_error_sum += float((((out["projectedIrisMotion"] - iris_observed).abs()
                                       .mean(dim=1)) * valid_iris).sum())
            iris_total += int(iris_valid.sum())
            for name, value in values.items():
                totals[name] += float(value.detach()) * n
            count += n
            for logits, labels, key in (
                (out["consonantLogits"], consonant, "c"),
                (out["vowelLogits"], vowel, "v"),
                (out["portrayedEmotionLogits"], acted, "e"),
            ):
                mask = labels != IGNORE_LABEL
                hits = int((logits[mask].argmax(dim=1) == labels[mask]).sum())
                total = int(mask.sum())
                if key == "c":
                    pc_hits += hits
                    pc_total += total
                elif key == "v":
                    pv_hits += hits
                    pv_total += total
                else:
                    pe_hits += hits
                    pe_total += total
    if not count:
        raise ValueError("Cannot evaluate empty singer holdout")
    return {
        **{k: round(v / count, 7) for k, v in totals.items()},
        "reviewedConsonantFrameCount": pc_total,
        "reviewedVowelFrameCount": pv_total,
        "reviewedConsonantAccuracy": round(pc_hits / pc_total, 5) if pc_total else None,
        "reviewedVowelAccuracy": round(pv_hits / pv_total, 5) if pv_total else None,
        "actedEmotionFrameCount": pe_total,
        "actedEmotionClassAccuracy": round(pe_hits / pe_total, 5) if pe_total else None,
        "projectedIrisFrameCount": iris_total,
        "projectedIrisMotionMAE": round(iris_error_sum / iris_total, 7) if iris_total else None,
    }


def _rank_metric(stage, scores):
    if stage == "articulation":
        return scores["articulationMAE"]
    if stage == "prosody":
        return scores["articulationMAE"] + .15 * scores["temporalChangeMAE"]
    if stage == "emotion":
        return scores["emotionSurfaceMAE"]
    return (scores["mouthMaskedMAE"] +
            .36 * scores["overallMotionMAE"] +
            .12 * scores["temporalChangeMAE"])


def train_staged(dataset: Path, checkpoint: Path, *,
                 epochs_per_stage: tuple[int, int, int, int] = (2, 2, 2, 2),
                 batch_size: int = 12, lr: float = .0003,
                 device: str = "cpu", seed: int = 42,
                 init_v11_checkpoint: Path | None = None,
                 init_seoul_phone_checkpoint: Path | None = None) -> dict:
    if (len(epochs_per_stage) != 4 or any(
            type(n) is not int or not 1 <= n <= 30 for n in epochs_per_stage)
            or not 2 <= batch_size <= 64 or not 1e-7 <= lr <= .01):
        raise ValueError("Unsupported v13 stage epochs/batch/lr")
    if checkpoint.exists():
        raise FileExistsError("Existing research model cannot be overwritten")
    if init_v11_checkpoint is not None and not init_v11_checkpoint.is_file():
        raise FileNotFoundError("Owner-restored prior v11 research checkpoint not found")
    if init_seoul_phone_checkpoint is not None and not init_seoul_phone_checkpoint.is_file():
        raise FileNotFoundError("Owner-restored Seoul Korean phone checkpoint absent")
    if init_seoul_phone_checkpoint is not None and checkpoint.resolve()==init_seoul_phone_checkpoint.resolve():
        raise ValueError("Research Korean speech pretrained weights must never be overwritten")
    if init_v11_checkpoint is not None and checkpoint.resolve() == init_v11_checkpoint.resolve():
        raise ValueError("Warm-start must never overwrite original research model")
    if torch.device(device).type == "cuda" and not torch.cuda.is_available():
        raise ValueError("Requested GPU is unavailable")
    torch.set_num_threads(min(2, torch.get_num_threads()))
    torch.manual_seed(seed)
    np.random.seed(seed)
    splits = validate_prepared(dataset)
    train_data = StagedFaceFrames(dataset / "train")
    val_data = StagedFaceFrames(dataset / "val")
    train_loader = DataLoader(train_data, batch_size=batch_size, shuffle=True, num_workers=0)
    val_loader = DataLoader(val_data, batch_size=batch_size, shuffle=False, num_workers=0)
    net = StagedSingingFaceNet().to(device)
    prior_sha = None
    if init_v11_checkpoint is not None:
        data = torch.load(init_v11_checkpoint, map_location="cpu", weights_only=True)
        if (data.get("modelVersion") != "song-vision-pronunciation-prosody-face-v11" or
                data.get("status") != "research_only_unvalidated_checkpoint" or
                data.get("commerciallyValidated") is not False):
            raise ValueError("Only trusted, operator-restored v11 research model supported")
        net.backbone.load_state_dict(data["stateDict"], strict=True)
        prior_sha = hashlib.sha256(init_v11_checkpoint.read_bytes()).hexdigest()
    seoul_sha = None
    if init_seoul_phone_checkpoint is not None:
        seoul = torch.load(init_seoul_phone_checkpoint, map_location="cpu", weights_only=True)
        if (seoul.get("modelVersion") != "song-vision-seoul-hand-corrected-phones-v1"
                or seoul.get("sourceLicense") != "CC-BY-NC-2.0"
                or seoul.get("commerciallyValidated") is not False
                or tuple(seoul.get("consonants", ())) != CONSONANTS
                or tuple(seoul.get("vowels", ())) != VOWELS):
            raise ValueError("Only source-attributed Korean hand-corrected speech phoneme weights accepted")
        source_weights = seoul["stateDict"]
        for module_name in ("articulation_encoder", "consonant_head", "vowel_head"):
            prefix = module_name + "."
            relevant = {key[len(prefix):]:value
                        for key,value in source_weights.items() if key.startswith(prefix)}
            getattr(net,module_name).load_state_dict(relevant,strict=True)
        seoul_sha = hashlib.sha256(init_seoul_phone_checkpoint.read_bytes()).hexdigest()
    hist, stage_bests = [], {}
    for stage, stage_epochs in zip(STAGES, epochs_per_stage):
        configure_stage(net, stage)
        optimizer = torch.optim.AdamW((p for p in net.parameters() if p.requires_grad), lr=lr)
        best_score = float("inf")
        best_params = None
        for epoch in range(1, stage_epochs + 1):
            net.train()
            acc, total = 0., 0
            verified_consonant = verified_vowel = 0
            for items in train_loader:
                batch = [t.to(device) for t in items]
                loss, counts = _stage_loss(net, batch, stage)
                optimizer.zero_grad(set_to_none=True)
                loss.backward()
                nn.utils.clip_grad_norm_(
                    (p for p in net.parameters() if p.requires_grad), 1.)
                optimizer.step()
                acc += float(loss.detach()) * len(batch[0])
                total += len(batch[0])
                verified_consonant += counts["verifiedConsonantFrames"]
                verified_vowel += counts["verifiedVowelFrames"]
            metrics = evaluate_stage(net, val_loader, stage, device)
            rank = _rank_metric(stage, metrics)
            log = {"stage": stage, "epoch": epoch,
                   "trainingLoss": round(acc / total, 7),
                   "trainingVerifiedConsonantFrames": verified_consonant,
                   "trainingVerifiedVowelFrames": verified_vowel, **metrics}
            hist.append(log)
            print("SONG_V13_STAGE_EPOCH=" + json.dumps(log, sort_keys=True), flush=True)
            if rank < best_score:
                best_score = rank
                # Restore the best stage state before moving to next branch.
                best_params = {k: v.detach().cpu().clone()
                               for k, v in net.state_dict().items()}
                stage_bests[stage] = log
        if best_params is None:
            raise RuntimeError("No learned weights for v13 stage")
        net.load_state_dict(best_params)
    result = evaluate_stage(net, val_loader, "fusion", device)
    failures = []
    if result["mouthMaskedMAE"] >= result["copyReferenceMAE"]:
        failures.append("MOUTH_WORSE_THAN_REFERENCE")
    if result["articulationMAE"] >= result["neutralArticulationMAE"]:
        failures.append("ARTICULATION_WORSE_THAN_NEUTRAL")
    if result["emotionSurfaceMAE"] >= result["neutralEmotionSurfaceMAE"]:
        failures.append("EXPRESSION_WORSE_THAN_NEUTRAL")
    if result["matchedVsShiftedAudioGain"] <= .0001:
        failures.append("AUDIO_ALIGNMENT_NOT_PROVEN")
    if result["projectedIrisFrameCount"] == 0:
        failures.append("PROJECTED_IRIS_MOVEMENT_NOT_EVALUATED")
    if result["reviewedConsonantFrameCount"] == 0 or result["reviewedVowelFrameCount"] == 0:
        failures.append("EXACT_SINGING_PHONEME_CLASSIFICATION_NOT_VALIDATED")
        if seoul_sha is None:
            failures.append("EXACT_PHONEME_CLASSIFICATION_NOT_TRAINED_OR_VALIDATED")
        else:
            failures.append("KOREAN_SPEECH_PHONE_PRETRAINING_NOT_SINGING_VALIDATION")
    checkpoint.parent.mkdir(parents=True, exist_ok=True)
    torch.save({
        "modelVersion": MODEL_VERSION,
        "stateDict": {k: v.detach().cpu() for k,v in net.state_dict().items()},
        "phonemes": {"consonants": CONSONANTS, "vowels": VOWELS},
        "sourceEmotionLabels": PORTRAYED_EMOTION_NAMES,
        "projectedIrisFeatures": IRIS_FEATURES,
        "trainedStages": STAGES,
        "status": "research_only_unvalidated_checkpoint",
        "commerciallyValidated": False,
        "warmStartV11Sha256": prior_sha,
        "pretrainedKoreanSpeechPhoneCheckpointSha256": seoul_sha,
        "optimizerStateRestored": False,
    }, checkpoint)
    report = {
        "modelVersion": MODEL_VERSION,
        "status": "research_only_not_lipsync_validated",
        "input": "existing_synchronized_singer_voice_plus_reference_face",
        "output": "mouth_pixels_and_visible_face_motion_only_no_audio_generation",
        "speechOrSingingSynthesisImplemented": False,
        "physicalMuscleForceInferred": False,
        "estimated2dIrisMotionNotPhysicalEyeGaze": True,
        "phonemeClasses": {"consonants": CONSONANTS, "vowels": VOWELS},
        "phonemeSource": "ONLY_HUMAN_REVIEWED_PHONES_WITH_SOURCE_SHA256",
        "trainReviewedConsonantSamples": train_data.reviewed_consonant_samples,
        "trainReviewedVowelSamples": train_data.reviewed_vowel_samples,
        "valReviewedConsonantSamples": val_data.reviewed_consonant_samples,
        "valReviewedVowelSamples": val_data.reviewed_vowel_samples,
        "portrayedEmotionTypes": PORTRAYED_EMOTION_NAMES,
        "stages": list(STAGES),
        "epochsPerStage": list(epochs_per_stage),
        "bestStageMetrics": stage_bests,
        "finalValidation": result,
        "history": hist,
        "diagnosticFlags": failures,
        "trainFrames": len(train_data), "valFrames": len(val_data),
        "trainClips": splits["train"], "valClips": splits["val"],
        "warmStartV11Sha256": prior_sha,
        "pretrainedKoreanSpeechPhoneCheckpointSha256": seoul_sha,
        "KoreanSpeechNotEquivalentToSinging": True,
        "optimizerStateRestored": False,
        "canAcceptPaidJobs": False,
        "commercialUseAllowed": False,
        "checkpointSha256": hashlib.sha256(checkpoint.read_bytes()).hexdigest(),
        "limitations": [
            "No exact consonant/vowel accuracy without verified phone timelines",
            "RAVDESS portrayed emotion is an acting label, not psychological ground truth",
            "Facial coefficients are image-derived estimates, not electromyography",
            "Iris-centre pixel displacement is a 2D projection, not gaze target or pupil dilation",
            "Current decoder predicts mouth pixels, not complete 96x96 facial skin",
            "No claim of universal language performance or commercial suitability",
        ],
    }
    checkpoint.with_suffix(".report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return report


def main():
    parser = argparse.ArgumentParser(
        description="4-stage actual singer audio -> articulatory, prosody, emotion, fused face research")
    parser.add_argument("--dataset", type=Path, required=True)
    parser.add_argument("--checkpoint", type=Path, required=True)
    parser.add_argument("--art-epochs", type=int, default=2)
    parser.add_argument("--prosody-epochs", type=int, default=2)
    parser.add_argument("--emotion-epochs", type=int, default=2)
    parser.add_argument("--fusion-epochs", type=int, default=2)
    parser.add_argument("--batch-size", type=int, default=12)
    parser.add_argument("--init-v11-checkpoint", type=Path)
    parser.add_argument("--init-seoul-phone-checkpoint", type=Path)
    args = parser.parse_args()
    result = train_staged(
        args.dataset, args.checkpoint,
        epochs_per_stage=(args.art_epochs, args.prosody_epochs,
                          args.emotion_epochs, args.fusion_epochs),
        batch_size=args.batch_size,
        init_v11_checkpoint=args.init_v11_checkpoint,
        init_seoul_phone_checkpoint=args.init_seoul_phone_checkpoint,
    )
    print("SONG_V13_RESULT=" + json.dumps({
        "modelVersion": result["modelVersion"],
        "finalValidation": result["finalValidation"],
        "diagnosticFlags": result["diagnosticFlags"],
        "canAcceptPaidJobs": False,
    }, sort_keys=True))


if __name__ == "__main__":
    main()
