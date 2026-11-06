"""SONG v11: pretrained-voice-free AUDIO -> FACE pronunciation & dynamics study.

The SOURCE is an existing song's own singer vocal waveform. This module
does NOT synthesize audio, convert a voice, or classify Korean phonemes.
It learns the *visible* mouth/jaw/cheek/eyebrow surface movements from
paired video and that audio's spectral / amplitude dynamics.

20-21-10ms log-Mel provides sound identity-like spectral context; a
610-ms 8-channel measured acoustic cue stream preserves RMS/attack/
spectral shape across sustained vowels and syllable transitions.
There are NO hard-coded rules mapping volume or a vowel to jaw opening.

The v10 base remains unchanged, and all new weights are independently
versioned research-only. The v11 outputs remain the same 64px lip image
and 38D motion vector, NOT full-face video or a phoneme recognizer.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

import cv2
import numpy as np
import torch
from torch import nn
from torch.nn import functional as F
from torch.utils.data import DataLoader

from .core import AUDIO_CONTEXT, NUM_MELS, FACE_SIZE, MOUTH_SIZE, mel_window
from .facial_articulation_v10 import (
    AudioFacialArticulationNet, TemporalFaceArticulationFrames,
    FEATURE_COUNT, TARGET_NAMES, ARTICULATORY_IDS,
    _crop_mouth, motion_error,
)
from .masked_retrain import masked_loss, masked_mae, load_masked_model
from .real_training import validate_prepared
from .vocal_acoustics import (
    CUE_COUNT, CUE_CONTEXT, CUE_NAMES, CUE_VERSION, cue_window,
)

MODEL_VERSION = "song-vision-pronunciation-prosody-face-v11"


class VocalDrivenFaceNet(AudioFacialArticulationNet):
    """Separate singing spectral context and measured vocal dynamics branches.

    Inference is voice+static owner image -> visible face motion; not sound.
    Missing phoneme labels cannot be turned into verified phoneme accuracy.
    """

    def __init__(self):
        super().__init__()
        self.vocal_cue_encoder = nn.Sequential(
            nn.Conv1d(CUE_COUNT, 32, 5, padding=2), nn.GELU(),
            nn.Conv1d(32, 64, 5, padding=2), nn.GELU(),
            nn.AdaptiveAvgPool1d(4), nn.Flatten(),
            nn.Linear(64 * 4, 128), nn.GELU(),
        )
        self.cue_motion = nn.Sequential(
            nn.Linear(128, 128), nn.GELU(), nn.Linear(128, FEATURE_COUNT),
        )
        self.cue_image = nn.Sequential(
            nn.Linear(128, 24 * 4 * 4), nn.GELU(),
        )
        self.cue_decoder = nn.Sequential(
            nn.ConvTranspose2d(24, 24, 4, 2, 1), nn.GELU(),
            nn.ConvTranspose2d(24, 16, 4, 2, 1), nn.GELU(),
            nn.ConvTranspose2d(16, 8, 4, 2, 1), nn.GELU(),
            nn.ConvTranspose2d(8, 3, 4, 2, 1), nn.Tanh(),
        )
        # Starts near base v10 behaviour, but gradients can learn the
        # necessary amplitude/spectral changes rather than imposing them.
        self.cue_motion_gate = nn.Parameter(torch.tensor(-1.0))
        self.cue_image_gate = nn.Parameter(torch.tensor(-2.0))

    def forward(self, source_face: torch.Tensor, vocal_mel: torch.Tensor,
                vocal_cues: torch.Tensor):
        if source_face.ndim != 4 or source_face.shape[1:] != (3, FACE_SIZE, FACE_SIZE):
            raise ValueError("Expected source face [B,3,96,96]")
        if vocal_mel.ndim != 3 or vocal_mel.shape[1:] != (NUM_MELS, AUDIO_CONTEXT):
            raise ValueError("Expected aligned log-Mel singer signal [B,80,21]")
        if vocal_cues.ndim != 3 or vocal_cues.shape[1:] != (CUE_COUNT, CUE_CONTEXT):
            raise ValueError("Expected 610-ms acoustic voice features [B,8,61]")
        if not source_face.shape[0] == vocal_mel.shape[0] == vocal_cues.shape[0]:
            raise ValueError("Singer face / Mel / loudness-phonetic context batch mismatch")
        predicted_mouth, predicted_motion = super().forward(source_face, vocal_mel)
        cue_embedding = self.vocal_cue_encoder(vocal_cues)
        correction = self.cue_motion(cue_embedding)
        motion = torch.clamp(predicted_motion +
                             torch.sigmoid(self.cue_motion_gate) * correction,
                             -2.0, 2.0)
        face_correction = self.cue_decoder(
            self.cue_image(cue_embedding).view(-1, 24, 4, 4))
        image = torch.clamp(
            predicted_mouth + .08 * torch.sigmoid(self.cue_image_gate) * face_correction,
            0.0, 1.0,
        )
        return image, motion


class VoiceFaceFrames(TemporalFaceArticulationFrames):
    """Reuses v10 real face/video labels, pairs each frame with voice dynamics."""
    def __init__(self, split_dir: Path):
        super().__init__(split_dir)
        self.controls = {}
        for folder, *_ in self.records:
            if folder in self.controls:
                continue
            file = folder / "vocal-cues-v1.npy"
            if not file.is_file():
                raise FileNotFoundError(f"Missing measured singer sound features: {file}")
            controls = np.load(file, allow_pickle=False)
            mel = np.load(folder / "mel.npy", allow_pickle=False)
            if controls.shape != (CUE_COUNT, mel.shape[1]) or not np.isfinite(controls).all():
                raise ValueError("Singer voice dynamics not aligned to Mel/singer frames")
            self.controls[folder] = controls

    def __getitem__(self, index):
        base = super().__getitem__(index)
        folder, target, after, shifted, *_ = self.records[index]
        controls = self.controls[folder]
        # face, logmel, true mouth, true skin motion, next mel, next skin, shifted mel
        return (
            base[0], base[1],
            torch.from_numpy(cue_window(controls, float(target["seconds"]))),
            base[2], base[3],
            base[4],
            torch.from_numpy(cue_window(controls, float(after["seconds"]))),
            base[5], base[6],
            torch.from_numpy(cue_window(controls, float(shifted["seconds"]))),
        )


def _evaluate(model: VocalDrivenFaceNet, loader, device: str) -> dict:
    sums = dict(mouthMAE=0.0, copiedReferenceMouthMAE=0.0,
                facialMotionMAE=0.0, staticFaceMotionMAE=0.0,
                articulatoryFaceMAE=0.0, temporalFaceChangeMAE=0.0,
                matchedVsShiftedVoiceGain=0.0, soundControlsSensitivity=0.0,
                visualResponseToVoice=0.0)
    count = 0
    model.eval()
    with torch.no_grad():
        for batch in loader:
            (face, mel, controls, target_mouth, true_motion,
             next_mel, next_controls, next_motion, wrong_mel,
             wrong_controls) = [x.to(device) for x in batch]
            mouth, movement = model(face, mel, controls)
            _, delayed = model(face, next_mel, next_controls)
            _, wrong = model(face, wrong_mel, wrong_controls)
            _, same_mel_wrong_controls = model(face, mel, wrong_controls)
            metrics = {
                "mouthMAE": masked_mae(mouth, target_mouth),
                "copiedReferenceMouthMAE": masked_mae(_crop_mouth(face), target_mouth),
                "facialMotionMAE": motion_error(movement, true_motion),
                "staticFaceMotionMAE": motion_error(torch.zeros_like(true_motion), true_motion),
                "articulatoryFaceMAE": motion_error(movement, true_motion, ARTICULATORY_IDS),
                "temporalFaceChangeMAE": motion_error(delayed - movement,
                                                      next_motion - true_motion),
                "matchedVsShiftedVoiceGain": (
                    motion_error(wrong, true_motion, ARTICULATORY_IDS) -
                    motion_error(movement, true_motion, ARTICULATORY_IDS)
                ),
                "soundControlsSensitivity": (
                    same_mel_wrong_controls - movement).abs().mean(),
                "visualResponseToVoice": (wrong - movement).abs().mean(),
            }
            n = len(face)
            for key, val in metrics.items():
                sums[key] += float(val.detach()) * n
            count += n
    if count == 0:
        raise ValueError("No independent singer validation frames")
    return {k: round(v / count, 7) for k, v in sums.items()}


def _objective(model, batch, *, use_audio_negative=True):
    (face, mel, cues, image, face_motion, future_mel,
     future_cues, future_motion, shifted_mel, shifted_cues) = batch
    image_pred, face_pred = model(face, mel, cues)
    _, future_pred = model(face, future_mel, future_cues)
    l = (masked_loss(image_pred, image) +
         .4 * motion_error(face_pred, face_motion) +
         .12 * motion_error(future_pred-face_pred, future_motion-face_motion))
    if use_audio_negative:
        _, shifted_pred = model(face, shifted_mel, shifted_cues)
        correct = motion_error(face_pred, face_motion, ARTICULATORY_IDS)
        wrong = motion_error(shifted_pred, face_motion, ARTICULATORY_IDS)
        l += .08 * F.relu(.015 + correct - wrong)
    return l


def train_voice_to_face(dataset: Path, checkpoint: Path, *,
                        epochs: int = 8, batch_size: int = 12,
                        lr: float = .0003, min_epochs: int = 4,
                        patience: int = 4, device: str = "cpu",
                        init_checkpoint: Path | None = None) -> dict:
    if (not 1 <= epochs <= 40 or not 1 <= min_epochs <= epochs
            or not 2 <= batch_size <= 64 or not 0 <= patience <= 40
            or not 1e-7 <= lr <= .01):
        raise ValueError("Invalid voice-to-face study configuration")
    if checkpoint.exists():
        raise FileExistsError("Never overwrite saved research model")
    if init_checkpoint and init_checkpoint.resolve() == checkpoint.resolve():
        raise ValueError("Old weights cannot be overwritten by the new model")
    if torch.device(device).type == "cuda" and not torch.cuda.is_available():
        raise ValueError("CUDA selected on host without GPU")
    torch.set_num_threads(min(torch.get_num_threads(), 2))
    torch.manual_seed(42)
    np.random.seed(42)
    clip_splits = validate_prepared(dataset)
    train_data = VoiceFaceFrames(dataset / "train")
    val_data = VoiceFaceFrames(dataset / "val")
    train = DataLoader(train_data, batch_size=batch_size, shuffle=True, num_workers=0)
    val = DataLoader(val_data, batch_size=batch_size, shuffle=False, num_workers=0)
    net = VocalDrivenFaceNet().to(device)
    source_sha = None
    if init_checkpoint is not None:
        if not init_checkpoint.is_file():
            raise FileNotFoundError("Private owner restored v2 checkpoint missing")
        source_sha = hashlib.sha256(init_checkpoint.read_bytes()).hexdigest()
        net.mouth.load_state_dict(
            load_masked_model(init_checkpoint, device="cpu").state_dict(), strict=True)
    opt = torch.optim.AdamW(net.parameters(), lr=lr)
    history = []
    best = significant_best = float("inf")
    stale = 0
    stopped = False
    for epoch in range(1, epochs + 1):
        net.train()
        weighted_loss, seen = 0., 0
        for sample in train:
            sample = [x.to(device) for x in sample]
            loss = _objective(net, sample)
            opt.zero_grad(set_to_none=True)
            loss.backward()
            nn.utils.clip_grad_norm_(net.parameters(), 1.)
            opt.step()
            n = len(sample[0])
            weighted_loss += float(loss.detach()) * n
            seen += n
        metrics = _evaluate(net, val, device)
        metrics.update(epoch=epoch, trainJointLoss=round(weighted_loss / seen, 7))
        history.append(metrics)
        print("SONG_V11_VOICE_TO_FACE_EPOCH=" + json.dumps(metrics, sort_keys=True), flush=True)
        score = (metrics["mouthMAE"] + .4 * metrics["facialMotionMAE"] +
                 .12 * metrics["temporalFaceChangeMAE"])
        if score < best:
            best = score
            checkpoint.parent.mkdir(parents=True, exist_ok=True)
            torch.save({
                "modelVersion": MODEL_VERSION,
                "stateDict": {k: v.detach().cpu() for k,v in net.state_dict().items()},
                "surfaceTargetNames": list(TARGET_NAMES),
                "acousticCueNames": list(CUE_NAMES), "acousticCueVersion": CUE_VERSION,
                "epoch": epoch, "bestValidationJointScore": best,
                "status": "research_only_unvalidated_checkpoint",
                "commerciallyValidated": False,
                "priorMouthWeightsSha256": source_sha,
                "optimizerStateRestored": False,
            }, checkpoint)
        if score < significant_best - .0002:
            significant_best, stale = score, 0
        else:
            stale += 1
        if patience and epoch >= min_epochs and stale >= patience:
            stopped = True
            break
    best_metrics = min(history, key=lambda m:m["mouthMAE"] +
                       .4*m["facialMotionMAE"] + .12*m["temporalFaceChangeMAE"])
    flags = []
    if best_metrics["mouthMAE"] >= best_metrics["copiedReferenceMouthMAE"]:
        flags.append("LIP_RECONSTRUCTION_WORSE_THAN_COPY")
    if best_metrics["facialMotionMAE"] >= best_metrics["staticFaceMotionMAE"]:
        flags.append("FACE_MOVEMENT_WORSE_THAN_NEUTRAL")
    if best_metrics["matchedVsShiftedVoiceGain"] <= .0001:
        flags.append("NO_POSITIVE_VOCAL_ARTICULATION_MATCH")
    if best_metrics["soundControlsSensitivity"] <= .0001:
        flags.append("LOW_ACOUSTIC_CUE_SENSITIVITY")
    report = {
        "modelVersion": MODEL_VERSION,
        "status": "research_only_not_lipsync_validated",
        "input": "preexisting_synchronized_vocal_audio_and_owner_reference_face",
        "output": "mouth_pixels_and_visible_face_surface_motion_only",
        "generatesOrTransformsVoice": False,
        "precisePhonemeLabelsAvailable": False,
        "recognizedPhonemesNotClaimed": True,
        "acousticFeatures": list(CUE_NAMES),
        "melAndCueContextMs": [210, 610],
        "trainClips": clip_splits["train"], "valClips": clip_splits["val"],
        "trainFrames": len(train_data), "valFrames": len(val_data),
        "bestEpoch": best_metrics["epoch"], "bestMetrics": best_metrics,
        "epochsCompleted": len(history), "earlyStopped": stopped,
        "diagnosticFlags": flags, "history": history,
        "warmStartMouthSha256": source_sha, "optimizerStateRestored": False,
        "canAcceptPaidJobs": False, "commercialUseAllowed": False,
        "checkpointSha256": hashlib.sha256(checkpoint.read_bytes()).hexdigest(),
        "limitations": [
            "Acoustic band shape is not ground-truth phoneme identity",
            "Eye blink/gaze and emotion cannot be determined uniquely from loudness",
            "No full-frame facial skin renderer or proven Korean lyric synchrony",
            "Only noncommercial consent/license RAVDESS study data",
        ],
    }
    checkpoint.with_suffix(".report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return report
