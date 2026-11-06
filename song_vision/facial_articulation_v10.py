"""SONG-Vision v10: audio-to-facial expression/skin movement + lip inpainting.

Research objective: learn synchronised visible articulation of lip, jaw/chin
surface, cheeks, nose/lip folds, brows and eyes. MediaPipe is a *frozen local
teacher*, not a muscular EMG instrument. The eye/brow movements are only weakly
penalised because gaze and blink are not uniquely determined by phonemes.

Matched and time-shifted *same-singer* vocal windows plus next-frame motion
are used to test audio/visible-motion coupling. This is NOT a physical model
of sound production: camera views cannot recover vocal fold, tongue, or
nasopharynx anatomy, so no sound is generated from the face coordinates.

The model preserves old v2 checkpoints and only saves separately versioned
research checkpoints. It is NOT a validated talking/singing portrait renderer.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import cv2
import numpy as np
import torch
from torch import nn
from torch.nn import functional as F
from torch.utils.data import Dataset, DataLoader

from .core import FACE_SIZE, MOUTH_SIZE, AUDIO_CONTEXT, NUM_MELS, mel_window, mouth_bounds, tensor_patch
from .face_surface_motion import FEATURE_NAMES, EXPRESSION_EXTRAS
from .masked_retrain import (
    MaskedSingingMouthNet, hide_reference_mouth, load_masked_model,
    masked_loss, masked_mae,
)
from .real_training import validate_prepared

MODEL_VERSION = "song-vision-audiovisual-articulation-v10"
TARGET_NAMES = FEATURE_NAMES + EXPRESSION_EXTRAS
FEATURE_COUNT = len(TARGET_NAMES)
# Units were normalized to per-video neutral (clip median). Stronger weights
# for measurable articulation; blink/eyebrows have weaker audio coupling.
MOTION_WEIGHTS = torch.tensor(
    [1.2, 1.2, 1., 1.4, 1.0, 1.0, .6, .6, 1.2, .7, .7, .7]
    + [.30] * 9
    + [1.0] * 9
    + [.45] * 8,
    dtype=torch.float32,
)
assert len(MOTION_WEIGHTS) == FEATURE_COUNT
# Eyes/brows: source movements often independent of acoustic production.
ARTICULATORY_NAMES = (
    "lipGapEyeScaled", "mouthWidthEyeScaled", "lowerLipVerticalToNose",
    "chinVerticalToNose", "jawOpenBlendshape", "mouthClose", "mouthFunnel",
    "mouthPucker", "mouthPressLeft", "mouthPressRight",
    "mouthStretchLeft", "mouthStretchRight", "mouthLowerDownLeft",
    "mouthLowerDownRight", "mouthUpperUpLeft", "mouthUpperUpRight",
)
ARTICULATORY_IDS = tuple(TARGET_NAMES.index(x) for x in ARTICULATORY_NAMES)


def _crop_mouth(full_face: torch.Tensor) -> torch.Tensor:
    if full_face.ndim != 4 or full_face.shape[1:] != (3, FACE_SIZE, FACE_SIZE):
        raise ValueError("Expected full face crop [B,3,96,96]")
    x1, y1, x2, y2 = mouth_bounds(FACE_SIZE)
    return F.interpolate(full_face[:, :, y1:y2, x1:x2],
                         size=(MOUTH_SIZE, MOUTH_SIZE),
                         mode="bilinear", align_corners=False)


class AudioFacialArticulationNet(nn.Module):
    """Frozen-teacher targets, original trainable singer audio/face network.

    96px face context includes eyes and cheek tissue. v2 mouth subnetwork
    is reused for initializing previously learned lower-face rendering.
    Outputs an image of the *mouth*, not complete generated 96px face pixels.
    """
    def __init__(self):
        super().__init__()
        self.mouth = MaskedSingingMouthNet()
        self.face_encoder = nn.Sequential(
            nn.Conv2d(3, 24, 4, 2, 1), nn.GELU(),
            nn.Conv2d(24, 48, 4, 2, 1), nn.GELU(),
            nn.Conv2d(48, 64, 4, 2, 1), nn.GELU(),
            nn.Conv2d(64, 64, 4, 2, 1), nn.GELU(),
            nn.AdaptiveAvgPool2d((4, 4)),
        )
        self.motion_predictor = nn.Sequential(
            nn.Flatten(), nn.Linear(192 * 4 * 4, 224), nn.GELU(),
            nn.Linear(224, FEATURE_COUNT),
        )
        self.surface_feedback = nn.Linear(FEATURE_COUNT, 96 * 4 * 4)
        self.feedback_gate = nn.Parameter(torch.tensor(-3.))

    def forward(self, source_face: torch.Tensor, vocal_mel: torch.Tensor):
        if vocal_mel.ndim != 3 or vocal_mel.shape[1:] != (NUM_MELS, AUDIO_CONTEXT):
            raise ValueError("Expected aligned vocal mel [B,80,21]")
        if source_face.shape[0] != vocal_mel.shape[0]:
            raise ValueError("Audio/reference batch mismatch")
        lower = _crop_mouth(source_face)
        mouth_context = self.mouth.image_encoder(hide_reference_mouth(lower))
        acoustic_context = self.mouth.audio_encoder(vocal_mel).view(-1, 64, 4, 4)
        full_face_context = self.face_encoder(source_face)
        full = torch.cat((mouth_context, acoustic_context, full_face_context), dim=1)
        predicted_motion = 2.0 * torch.tanh(self.motion_predictor(full))
        mouth_hidden = self.mouth.merge(torch.cat((mouth_context, acoustic_context), dim=1))
        feedback = self.surface_feedback(predicted_motion).view(-1, 96, 4, 4)
        predicted_mouth = self.mouth.decoder(
            mouth_hidden + torch.sigmoid(self.feedback_gate) * feedback
        )
        return predicted_mouth, predicted_motion


class TemporalFaceArticulationFrames(Dataset):
    """Each sample includes same-clip next frame and shifted-audio negative.

    No fake labels. 80% minimum tracked frames per clip and no train/val
    mixing: the outer pipeline gives performer-disjoint splits.
    """
    def __init__(self, split_folder: Path):
        self.records = []
        for index_path in sorted(split_folder.glob("*/index.json")):
            folder = index_path.parent
            frames = json.loads(index_path.read_text(encoding="utf-8"))["frames"]
            if len(frames) < 16:
                continue
            label_file = folder / "face-surface-v1.npz"
            if not label_file.is_file():
                raise FileNotFoundError(f"Missing real tracked face labels: {label_file}")
            with np.load(label_file, allow_pickle=False) as data:
                valid = data["valid"].copy()
                basic = data["motion"].copy()
                extra = data["expressionMotion"].copy()
                names = list(data["featureNames"])
                extra_names = list(data["expressionNames"])
            if names != list(FEATURE_NAMES) or extra_names != list(EXPRESSION_EXTRAS):
                raise ValueError("Face expression teaching schema mismatch")
            if (valid.shape != (len(frames),) or
                    basic.shape != (len(frames), len(FEATURE_NAMES)) or
                    extra.shape != (len(frames), len(EXPRESSION_EXTRAS))):
                raise ValueError("Misaligned face expression frames")
            if valid.sum() / len(valid) < .80:
                raise ValueError("Not enough real face detections")
            motion = np.concatenate((basic, extra), axis=1).astype(np.float32)
            if not np.isfinite(motion[valid]).all():
                raise ValueError("NaN/inf in real face surface feature targets")
            mel = np.load(folder / "mel.npy", allow_pickle=False)
            for i in range(len(frames) - 1):
                if not (valid[i] and valid[i + 1]):
                    continue
                # Same performer, same clip shifted by 8 video frames ≈320ms.
                # Contrastive loss is only a weak auxiliary training signal.
                shifted_i = (i + 8) % len(frames)
                if not valid[shifted_i]:
                    continue
                ref_idx = (i + 13) % len(frames)
                self.records.append((
                    folder, frames[i], frames[i + 1], frames[shifted_i],
                    frames[ref_idx], motion[i], motion[i + 1], mel,
                ))
        if len(self.records) < 4:
            raise ValueError("No real sequential face/audio samples available")

    def __len__(self):
        return len(self.records)

    def __getitem__(self, i):
        folder, target, after, shifted, source, motion, next_motion, mel = self.records[i]
        ref = cv2.imread(str(folder / "frames" / source["file"]))
        current = cv2.imread(str(folder / "frames" / target["file"]))
        if ref is None or current is None or ref.shape != (FACE_SIZE, FACE_SIZE, 3):
            raise FileNotFoundError("Missing validated 96x96 face crop")
        return (
            tensor_patch(ref),
            torch.from_numpy(mel_window(mel, float(target["seconds"]))),
            tensor_patch(cv2.resize(current[mouth_bounds(FACE_SIZE)[1]:
                                                   mouth_bounds(FACE_SIZE)[3],
                                                   mouth_bounds(FACE_SIZE)[0]:
                                                   mouth_bounds(FACE_SIZE)[2]],
                                           (MOUTH_SIZE, MOUTH_SIZE))),
            torch.from_numpy(motion.copy()),
            torch.from_numpy(mel_window(mel, float(after["seconds"]))),
            torch.from_numpy(next_motion.copy()),
            torch.from_numpy(mel_window(mel, float(shifted["seconds"]))),
        )


def motion_error(predicted, actual, indexes=None):
    if predicted.shape != actual.shape or predicted.ndim != 2:
        raise ValueError("Motion target dimensions mismatch")
    if indexes is None:
        if predicted.shape[1] != FEATURE_COUNT:
            raise ValueError("Full motion feature dimensions mismatch")
        w = MOTION_WEIGHTS.to(predicted.device)
    else:
        predicted, actual = predicted[:, indexes], actual[:, indexes]
        w = MOTION_WEIGHTS[list(indexes)].to(predicted.device)
    return ((predicted - actual).abs() * w).sum(dim=1).mean() / w.sum()


def multitask_loss(model, sample, *, contrastive=True):
    face, audio, target, target_motion, next_audio, next_motion, shifted_audio = sample
    mouth, motion = model(face, audio)
    _, next_pred = model(face, next_audio)
    loss_mouth = masked_loss(mouth, target)
    loss_pose = motion_error(motion, target_motion)
    # True 40-ms motion difference, not static landmark matching.
    loss_velocity = motion_error(next_pred - motion, next_motion - target_motion)
    loss = loss_mouth + .40 * loss_pose + .12 * loss_velocity
    if contrastive:
        _, incorrect = model(face, shifted_audio)
        ids = ARTICULATORY_IDS
        correct_err = motion_error(motion, target_motion, ids)
        incorrect_err = motion_error(incorrect, target_motion, ids)
        loss += .08 * F.relu(.015 + correct_err - incorrect_err)
    return loss


def _validate(model, loader, device):
    sums = dict(mouthMAE=0., copyReferenceMouthMAE=0.,
                motionMAE=0., staticNeutralMAE=0.,
                lipJawMAE=0., cheeksMAE=0., eyesBrowMAE=0.,
                temporalDeltaMAE=0., correctVsShiftedAudioGain=0.,
                audioMotionSensitivity=0.)
    groups = {
        "lipJawMAE": tuple(range(4)) + (8,) + tuple(range(21, 30)),
        "cheeksMAE": tuple(range(4, 8)) + tuple(range(9, 12)) + tuple(range(30, 32)),
        "eyesBrowMAE": tuple(range(12, 21)),
    }
    count = 0
    model.eval()
    with torch.no_grad():
        for batch in loader:
            face, audio, target, actual, a1, motion1, incorrect_audio = [
                x.to(device) for x in batch
            ]
            mouth, predicted = model(face, audio)
            _, next_pred = model(face, a1)
            _, wrong_pred = model(face, incorrect_audio)
            n = len(audio)
            reference = _crop_mouth(face)
            values = {
                "mouthMAE": masked_mae(mouth, target),
                "copyReferenceMouthMAE": masked_mae(reference, target),
                "motionMAE": motion_error(predicted, actual),
                "staticNeutralMAE": motion_error(torch.zeros_like(actual), actual),
                "temporalDeltaMAE": motion_error(next_pred-predicted, motion1-actual),
                "correctVsShiftedAudioGain": (
                    motion_error(wrong_pred, actual, ARTICULATORY_IDS) -
                    motion_error(predicted, actual, ARTICULATORY_IDS)
                ),
                "audioMotionSensitivity": (wrong_pred - predicted).abs().mean(),
            }
            for name, indexes in groups.items():
                values[name] = motion_error(predicted, actual, indexes)
            for key, val in values.items():
                sums[key] += float(val) * n
            count += n
    if not count:
        raise ValueError("Empty validation split")
    return {k: round(v/count, 7) for k, v in sums.items()}


def train_articulation(dataset: Path, checkpoint: Path, *, epochs: int = 8,
                       min_epochs: int = 4, patience: int = 4,
                       batch_size: int = 12, lr: float = .0003,
                       init_checkpoint: Path | None = None, device: str = "cpu"):
    if not (1 <= epochs <= 30 and 1 <= min_epochs <= epochs and
            0 <= patience <= 30 and 2 <= batch_size <= 64 and
            1e-7 <= lr <= .01):
        raise ValueError("Invalid articulation research hyperparameters")
    if checkpoint.exists():
        raise FileExistsError("Do not overwrite research weights")
    if init_checkpoint is not None and checkpoint.resolve() == init_checkpoint.resolve():
        raise ValueError("Warm start source and target checkpoint cannot match")
    if torch.device(device).type == "cuda" and not torch.cuda.is_available():
        raise ValueError("CUDA requested but unavailable")
    torch.set_num_threads(min(2, torch.get_num_threads()))
    torch.manual_seed(42)
    np.random.seed(42)
    clips = validate_prepared(dataset)
    training = TemporalFaceArticulationFrames(dataset/"train")
    validation = TemporalFaceArticulationFrames(dataset/"val")
    train_loader = DataLoader(training, batch_size=batch_size, shuffle=True, num_workers=0)
    val_loader = DataLoader(validation, batch_size=batch_size, shuffle=False, num_workers=0)
    model = AudioFacialArticulationNet().to(device)
    initial_hash = None
    if init_checkpoint is not None:
        if not init_checkpoint.is_file():
            raise FileNotFoundError("Owner-restored v2 research checkpoint not found")
        initial_hash = hashlib.sha256(init_checkpoint.read_bytes()).hexdigest()
        model.mouth.load_state_dict(
            load_masked_model(init_checkpoint, device="cpu").state_dict(), strict=True
        )
    optimizer = torch.optim.AdamW(model.parameters(), lr=lr)
    best_score = float("inf")
    significant_best = float("inf")
    stale = 0
    history = []
    stopped = False
    for epoch in range(1, epochs + 1):
        model.train()
        cum_loss, number = 0., 0
        for sample in train_loader:
            sample = [x.to(device) for x in sample]
            loss = multitask_loss(model, sample)
            optimizer.zero_grad(set_to_none=True)
            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(), 1.)
            optimizer.step()
            cum_loss += float(loss.detach()) * len(sample[0])
            number += len(sample[0])
        metrics = _validate(model, val_loader, device)
        metrics.update(epoch=epoch, trainLoss=round(cum_loss/number, 7))
        history.append(metrics)
        print("SONG_AUDIO_FACE_ARTICULATION_EPOCH=" +
              json.dumps(metrics, sort_keys=True), flush=True)
        score = metrics["mouthMAE"] + .40 * metrics["motionMAE"] + .12 * metrics["temporalDeltaMAE"]
        if score < best_score:
            best_score = score
            checkpoint.parent.mkdir(parents=True, exist_ok=True)
            torch.save({
                "modelVersion": MODEL_VERSION,
                "surfaceFeatures": list(TARGET_NAMES),
                "stateDict": {k:v.detach().cpu() for k,v in model.state_dict().items()},
                "epoch": epoch, "bestScore": best_score,
                "initializedFromMouthV2": bool(initial_hash),
                "sourceCheckpointSha256": initial_hash,
                "optimizerStateRestored": False,
                "status": "research_only_unvalidated_checkpoint",
                "commerciallyValidated": False,
            },checkpoint)
        if score < significant_best - .0002:
            significant_best, stale = score, 0
        else:
            stale += 1
        if patience and epoch >= min_epochs and stale >= patience:
            stopped = True
            break
    best = min(history, key=lambda x:x["mouthMAE"] + .40*x["motionMAE"] +
               .12*x["temporalDeltaMAE"])
    flags=[]
    if best["mouthMAE"] >= best["copyReferenceMouthMAE"]:
        flags.append("WORSE_THAN_COPY_MOUTH")
    if best["motionMAE"] >= best["staticNeutralMAE"]:
        flags.append("WORSE_THAN_STATIC_FACE_MOTION")
    if best["correctVsShiftedAudioGain"] <= .0001:
        flags.append("NO_POSITIVE_ARTICULATION_ALIGNMENT_GAIN")
    report = {
        "modelVersion": MODEL_VERSION,
        "status": "research_only_not_lipsync_validated",
        "trainFrames": len(training), "valFrames": len(validation),
        "trainClips": clips["train"], "valClips": clips["val"],
        "requestedEpochs": epochs, "completedEpochs": len(history),
        "bestEpoch": best["epoch"], "bestMetrics": best, "history": history,
        "diagnosticFlags": flags,
        "surfaceMeasurementsNotActualMuscleOrBones": True,
        "eyeMovementNotUniquelyPredictedFromVoice": True,
        "speechAcousticsNotRecoveredFromLipImageAlone": True,
        "requiresIndependentLipSyncTesting": True,
        "warmStartedFromOldMouth": bool(initial_hash),
        "sourceCheckpointSha256": initial_hash,
        "optimizerStateRestored": False,
        "commercialUseAllowed": False, "canAcceptPaidJobs": False,
        "checkpointSha256": hashlib.sha256(checkpoint.read_bytes()).hexdigest(),
    }
    checkpoint.with_suffix(".report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return report


if __name__=="__main__":
    parser=argparse.ArgumentParser()
    parser.add_argument("--dataset",type=Path,required=True)
    parser.add_argument("--checkpoint",type=Path,required=True)
    parser.add_argument("--epochs",type=int,default=8)
    parser.add_argument("--min-epochs",type=int,default=4)
    parser.add_argument("--batch-size",type=int,default=12)
    parser.add_argument("--init-checkpoint",type=Path)
    args=parser.parse_args()
    report=train_articulation(args.dataset,args.checkpoint,epochs=args.epochs,
                              min_epochs=args.min_epochs,batch_size=args.batch_size,
                              init_checkpoint=args.init_checkpoint)
    print("SONG_AUDIO_FACE_ARTICULATION_RESULT="+json.dumps({
        "bestMetrics":report["bestMetrics"],
        "diagnosticFlags":report["diagnosticFlags"],
        "canAcceptPaidJobs":False},sort_keys=True))
