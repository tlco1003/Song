"""SONG-Vision v9: joint audio-conditioned lip + chin + cheek surface training.

Self-authored PyTorch network; optional offline Google MediaPipe is a FROZEN
pseudo-label detector. It is not a SONG-owned 478-point landmark detector.
No hidden skull/zygomatic bone/jawbone locations can be inferred from RGB.

The 64x64 decoder still only synthesizes the lower-face crop. The auxiliary
motion branch predicts visible-surface metrics for future full-face rendering,
but does not by itself create photographic cheek/jaw pixels. Training the
shared audio/image trunk and motion feedback makes this a JOINT loss.
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
from torch.utils.data import DataLoader, Dataset

from .core import AUDIO_CONTEXT, MOUTH_SIZE, NUM_MELS, mel_window, mouth_patch, tensor_patch
from .face_surface_motion import FEATURE_NAMES, FEATURE_SCALE, VERSION as LABEL_VERSION
from .masked_retrain import (
    MaskedSingingMouthNet, hide_reference_mouth, load_masked_model,
    masked_loss, masked_mae, reveal_mask,
)
from .real_training import validate_prepared

JOINT_MODEL_VERSION = "song-vision-joint-face-surface-v3"
N_MOTION = len(FEATURE_NAMES)
# Explicit priorities: jaw/chin and cheeks should not be marginalized by lips.
FEATURE_WEIGHTS = torch.tensor([
    1.4, 1.1, 1.1, 1.6, 1.25, 1.25, .75, .75, 1.2, .9, .9, .9,
], dtype=torch.float32)


class SurfaceLabeledFrames(Dataset):
    """Audio, source mouth crop, target mouth, signed per-clip surface motion.

    Only confirmed MediaPipe detections are used. No silent interpolation.
    """
    def __init__(self, root: Path):
        self.samples = []
        for index_path in sorted(root.glob("*/index.json")):
            folder = index_path.parent
            index = json.loads(index_path.read_text(encoding="utf-8"))
            frames = index["frames"]
            if len(frames) < 16:
                continue
            label_path = folder / "face-surface-v1.npz"
            if not label_path.is_file():
                raise FileNotFoundError(f"Missing actual surface labels: {label_path}")
            with np.load(label_path, allow_pickle=False) as data:
                valid = data["valid"]
                motion = data["motion"]
                names = data["featureNames"].tolist()
            if names != list(FEATURE_NAMES) or valid.shape != (len(frames),):
                raise ValueError("Face geometry label schema/length mismatch")
            if motion.shape != (len(frames), N_MOTION):
                raise ValueError("Incorrect face motion target dimensions")
            if valid.dtype != np.dtype("bool"):
                raise ValueError("Surface detector validity must be explicit bool")
            if np.any(~np.isfinite(motion[valid])):
                raise ValueError("Nonfinite ground-truth face surface target")
            mel = np.load(folder / "mel.npy", allow_pickle=False)
            indices = np.flatnonzero(valid)
            if len(indices) < 16 or len(indices) / len(frames) < .8:
                raise ValueError("Insufficient verified surface detections")
            for i in indices:
                # Reference image is a DIFFERENT frame for the same signer.
                reference = frames[(int(i) + 8) % len(frames)]
                self.samples.append((
                    folder, frames[int(i)], reference, mel,
                    motion[int(i)].astype(np.float32),
                ))
        if not self.samples:
            raise ValueError("No directly detected singing face surface labels")

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, position):
        folder, target, reference, mel, surface = self.samples[position]
        bgr_target = cv2.imread(str(folder / "frames" / target["file"]))
        bgr_reference = cv2.imread(str(folder / "frames" / reference["file"]))
        if bgr_target is None or bgr_reference is None:
            raise FileNotFoundError("Missing privately prepared face images")
        return (
            tensor_patch(mouth_patch(bgr_reference)),
            torch.from_numpy(mel_window(mel, float(target["seconds"]))),
            tensor_patch(mouth_patch(bgr_target)),
            torch.from_numpy(surface.copy()),
        )


class JointSingingFaceNet(nn.Module):
    """Shared audio/face encoders -> 12 surface motions + mouth frame.

    Geometry output is also fused into the mouth image decoder. It does not
    reconstruct a full 3D skull or generate the full 96x96 cheek/chin pixels.
    """
    def __init__(self):
        super().__init__()
        self.mouth = MaskedSingingMouthNet()
        self.motion_head = nn.Sequential(
            nn.Flatten(),
            nn.Linear(128 * 4 * 4, 192), nn.GELU(),
            nn.Linear(192, N_MOTION),
        )
        self.motion_feedback = nn.Linear(N_MOTION, 96 * 4 * 4)
        # Near-zero gated feedback at initialization to preserve optional v2
        # pretrained mouth decoder without immediately disrupting its output.
        self.motion_gain = nn.Parameter(torch.tensor(-3., dtype=torch.float32))

    def forward(self, reference: torch.Tensor, audio: torch.Tensor):
        if reference.ndim != 4 or reference.shape[1:] != (3, MOUTH_SIZE, MOUTH_SIZE):
            raise ValueError("Expected reference mouth frames [B,3,64,64]")
        if audio.ndim != 3 or audio.shape[1:] != (NUM_MELS, AUDIO_CONTEXT):
            raise ValueError("Expected vocal Mel windows [B,80,21]")
        if audio.shape[0] != reference.shape[0]:
            raise ValueError("Audio/image batch mismatch")
        visual = self.mouth.image_encoder(hide_reference_mouth(reference))
        acoustic = self.mouth.audio_encoder(audio).reshape(-1, 64, 4, 4)
        features = torch.cat((visual, acoustic), dim=1)
        motion = 2. * torch.tanh(self.motion_head(features))
        hidden = self.mouth.merge(features)
        correction = self.motion_feedback(motion).reshape(-1, 96, 4, 4)
        mouth = self.mouth.decoder(
            hidden + torch.sigmoid(self.motion_gain) * correction
        )
        return mouth, motion


def surface_loss(prediction: torch.Tensor, target: torch.Tensor) -> torch.Tensor:
    if prediction.ndim != 2 or prediction.shape != target.shape or prediction.shape[1] != N_MOTION:
        raise ValueError("Face-surface targets must be [B,12] normalized motion values")
    weights = FEATURE_WEIGHTS.to(prediction.device)
    return ((prediction - target).abs() * weights).sum(dim=-1).mean() / weights.sum()


def joint_loss(predicted_mouth, target_mouth, motion, surface):
    return masked_loss(predicted_mouth, target_mouth) + .32 * surface_loss(motion, surface)


def _validation(model: JointSingingFaceNet, loader, device) -> dict:
    model.eval()
    totals = dict(mouthMaskedMAE=0., copyMouthMAE=0.,
                  motionMAE=0., zeroMotionMAE=0.,
                  chinJawMAE=0., cheekMotionMAE=0.,
                  matchedVsShuffledMotionGain=0., audioMotionSensitivity=0.)
    count = 0
    with torch.no_grad():
        for reference, audio, target, motion_true in loader:
            reference, audio, target, motion_true = (
                reference.to(device), audio.to(device),
                target.to(device), motion_true.to(device),
            )
            predicted_mouth, predicted_motion = model(reference, audio)
            shifted_audio = torch.roll(audio, shifts=max(1, len(audio)//2), dims=0)
            _, mismatched_motion = model(reference, shifted_audio)
            n = len(audio)
            vals = {
                "mouthMaskedMAE": masked_mae(predicted_mouth, target),
                "copyMouthMAE": masked_mae(reference, target),
                "motionMAE": surface_loss(predicted_motion, motion_true),
                "zeroMotionMAE": surface_loss(torch.zeros_like(motion_true), motion_true),
                "chinJawMAE": (predicted_motion[:, [2, 3, 8]] -
                               motion_true[:, [2, 3, 8]]).abs().mean(),
                "cheekMotionMAE": (predicted_motion[:, [4, 5, 6, 7, 9, 10, 11]] -
                                   motion_true[:, [4, 5, 6, 7, 9, 10, 11]]).abs().mean(),
                "matchedVsShuffledMotionGain": (
                    surface_loss(mismatched_motion, motion_true) -
                    surface_loss(predicted_motion, motion_true)
                ),
                "audioMotionSensitivity": (predicted_motion - mismatched_motion).abs().mean(),
            }
            for key, value in vals.items():
                totals[key] += float(value.detach()) * n
            count += n
    if count == 0:
        raise ValueError("No validation samples")
    return {key: round(value / count, 7) for key, value in totals.items()}


def train_joint(dataset: Path, checkpoint: Path, epochs: int = 12, batch_size: int = 12,
                lr: float = .0003, device: str = "cpu", patience: int = 5,
                min_epochs: int = 6, seed: int = 42,
                init_checkpoint: Path | None = None) -> dict:
    if (not 1 <= epochs <= 50 or not 1 <= min_epochs <= epochs or
            not 2 <= batch_size <= 64 or not 0 <= patience <= 100 or
            not 1e-7 <= lr <= .01):
        raise ValueError("Invalid training and early-stop parameters")
    if checkpoint.exists():
        raise FileExistsError("Never overwrite an existing research checkpoint")
    if init_checkpoint is not None and checkpoint.resolve() == init_checkpoint.resolve():
        raise ValueError("Warm-start input cannot be the output checkpoint")
    if torch.device(device).type == "cuda" and not torch.cuda.is_available():
        raise ValueError("GPU requested but unavailable")
    torch.set_num_threads(min(torch.get_num_threads(), 2))
    torch.manual_seed(seed)
    np.random.seed(seed)
    clips = validate_prepared(dataset)
    train_samples = SurfaceLabeledFrames(dataset / "train")
    val_samples = SurfaceLabeledFrames(dataset / "val")
    train_loader = DataLoader(train_samples, shuffle=True, batch_size=batch_size, num_workers=0)
    val_loader = DataLoader(val_samples, shuffle=False, batch_size=batch_size, num_workers=0)
    model = JointSingingFaceNet().to(device)
    warm_start_sha256 = None
    if init_checkpoint is not None:
        if not init_checkpoint.is_file():
            raise FileNotFoundError("Owner-restored original research checkpoint required")
        warm_start_sha256 = hashlib.sha256(init_checkpoint.read_bytes()).hexdigest()
        # Only initialize the old mouth subnetwork. Fresh surface motion head
        # and optimizer state are initialized independently and transparently.
        model.mouth.load_state_dict(
            load_masked_model(init_checkpoint, device="cpu").state_dict(), strict=True
        )
    opt = torch.optim.AdamW(model.parameters(), lr=lr)
    history, best_score, best_significant = [], float("inf"), float("inf")
    stagnant = 0
    stopped = False
    for epoch in range(1, epochs + 1):
        model.train()
        accum, sample_count = 0., 0
        for reference, audio, target, motion_gt in train_loader:
            reference, audio, target, motion_gt = (
                reference.to(device), audio.to(device),
                target.to(device), motion_gt.to(device),
            )
            mouth, surface = model(reference, audio)
            loss = joint_loss(mouth, target, surface, motion_gt)
            opt.zero_grad(set_to_none=True)
            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(), 1.)
            opt.step()
            accum += float(loss.detach()) * len(audio)
            sample_count += len(audio)
        metrics = _validation(model, val_loader, device)
        metrics["epoch"] = epoch
        metrics["trainJointLoss"] = round(accum / sample_count, 7)
        history.append(metrics)
        print("SONG_JOINT_FACE_EPOCH=" + json.dumps(metrics, sort_keys=True), flush=True)
        selection_score = metrics["mouthMaskedMAE"] + .32 * metrics["motionMAE"]
        if selection_score < best_score:
            best_score = selection_score
            checkpoint.parent.mkdir(parents=True, exist_ok=True)
            torch.save({
                "modelVersion": JOINT_MODEL_VERSION,
                "stateDict": {k: v.detach().cpu() for k, v in model.state_dict().items()},
                "surfaceLabelVersion": LABEL_VERSION,
                "surfaceFeatureNames": FEATURE_NAMES,
                "epoch": epoch,
                "validationJointScore": best_score,
                "sourceCheckpointSha256": warm_start_sha256,
                "optimizerStateRestored": False,
                "commerciallyValidated": False,
                "status": "research_only_unvalidated_checkpoint",
            }, checkpoint)
        if selection_score < best_significant - .0002:
            best_significant = selection_score
            stagnant = 0
        else:
            stagnant += 1
        if epoch >= min_epochs and patience and stagnant >= patience:
            stopped = True
            break
    best = min(history, key=lambda x: x["mouthMaskedMAE"] + .32 * x["motionMAE"])
    flags = []
    if best["mouthMaskedMAE"] >= best["copyMouthMAE"]:
        flags.append("MOUTH_WORSE_THAN_COPY_REFERENCE")
    if best["motionMAE"] >= best["zeroMotionMAE"]:
        flags.append("FACE_MOTION_WORSE_THAN_STATIC_NEUTRAL")
    if best["matchedVsShuffledMotionGain"] <= .0001:
        flags.append("NO_POSITIVE_AUDIO_FACE_MOTION_ALIGNMENT")
    report = {
        "modelVersion": JOINT_MODEL_VERSION,
        "status": "research_only_not_lipsync_validated",
        "surfaceCoordinates": "2d_projected_478_surface_landmarks_not_bones",
        "anatomicalBoneMeasurementsAvailable": False,
        "trainClips": clips["train"], "valClips": clips["val"],
        "trainFrames": len(train_samples), "valFrames": len(val_samples),
        "requestedEpochs": epochs, "completedEpochs": len(history),
        "bestEpoch": best["epoch"], "bestMetrics": best,
        "earlyStopped": stopped, "history": history, "diagnosticFlags": flags,
        "surfaceLabelVersion": LABEL_VERSION,
        "surfaceFeatureNames": FEATURE_NAMES,
        "sourceCheckpointSha256": warm_start_sha256,
        "warmStartedFromPriorMouthWeights": bool(warm_start_sha256),
        "optimizerStateRestored": False,
        "commercialUseAllowed": False,
        "canAcceptPaidJobs": False,
        "limitations": [
            "Geometry labels are MediaPipe estimates of skin/face surface",
            "Cheek/zygomatic/jawbone interiors cannot be seen by RGB camera",
            "Existing 64x64 mouth decoder cannot generate full-cheek pixels",
            "No measured Korean viseme/lipsync or independent perceptual score",
        ],
        "checkpointSha256": hashlib.sha256(checkpoint.read_bytes()).hexdigest(),
    }
    checkpoint.with_suffix(".report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return report


def main():
    parser = argparse.ArgumentParser(description="Joint mouth+cheek+jaw surface research training")
    parser.add_argument("--dataset", type=Path, required=True)
    parser.add_argument("--checkpoint", type=Path, required=True)
    parser.add_argument("--init-checkpoint", type=Path)
    parser.add_argument("--epochs", type=int, default=12)
    parser.add_argument("--min-epochs", type=int, default=6)
    parser.add_argument("--patience", type=int, default=5)
    parser.add_argument("--batch-size", type=int, default=12)
    parser.add_argument("--lr", type=float, default=.0003)
    args = parser.parse_args()
    report = train_joint(args.dataset, args.checkpoint, args.epochs, args.batch_size,
                         args.lr, patience=args.patience, min_epochs=args.min_epochs,
                         init_checkpoint=args.init_checkpoint)
    print("SONG_JOINT_FACE_TRAIN_RESULT=" + json.dumps({
        "modelVersion": JOINT_MODEL_VERSION,
        "bestMetrics": report["bestMetrics"],
        "qualityFlags": report["diagnosticFlags"],
        "weightsEncryptedExternally": False,
        "canAcceptPaidJobs": False,
    }, sort_keys=True))


if __name__ == "__main__":
    main()
