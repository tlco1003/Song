"""SONG-Vision masked-reference singing-mouth research retraining, v2.

Purpose: address 2026-11-06 RAVDESS failure where unmasked reference mouth
allowed a lip-copy shortcut and audio sensitivity was ~1e-5. This is a
TRAIN-FROM-SCRATCH local PyTorch experiment and is NOT a validated lip-sync model.
No external model-generation APIs or pretrained singer weights are used.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
import torch
from torch import nn
from torch.utils.data import DataLoader

from .core import AUDIO_CONTEXT, MOUTH_SIZE, NUM_MELS, PairedSingingFrames
from .real_training import validate_prepared

MASKED_MODEL_VERSION = "song-vision-masked-audio-v2"
# Broad central mask: conceal upper/lower lips and most of the open mouth.
MASK_TOP, MASK_BOTTOM = 10, 55
MASK_LEFT, MASK_RIGHT = 7, 57


def reveal_mask(device=None):
    """1.0 inside central occluded mouth area, 0.0 in preserved context."""
    mask = torch.zeros(1, 1, MOUTH_SIZE, MOUTH_SIZE, device=device)
    mask[:, :, MASK_TOP:MASK_BOTTOM, MASK_LEFT:MASK_RIGHT] = 1.
    return mask


def hide_reference_mouth(reference: torch.Tensor) -> torch.Tensor:
    if reference.ndim != 4 or reference.shape[1:] != (3, MOUTH_SIZE, MOUTH_SIZE):
        raise ValueError("Expected reference mouth images [N,3,64,64]")
    mask = reveal_mask(reference.device)
    return reference * (1. - mask) + .5 * mask


class MaskedSingingMouthNet(nn.Module):
    """Contextual mouth inpainting conditioned on mel; audio owns latent pathway.

    Unlike v1, the model never receives unmasked central lips. A spatially
    explicit audio embedding is fused at a 4x4 bottleneck. This does NOT imply
    it has learned phonemes without sufficient data.
    """
    def __init__(self):
        super().__init__()
        self.image_encoder = nn.Sequential(
            nn.Conv2d(3, 24, 4, 2, 1), nn.GELU(),
            nn.Conv2d(24, 48, 4, 2, 1), nn.GELU(),
            nn.Conv2d(48, 64, 4, 2, 1), nn.GELU(),
            nn.Conv2d(64, 64, 4, 2, 1), nn.GELU(),
        )
        self.audio_encoder = nn.Sequential(
            nn.Conv1d(NUM_MELS, 64, 3, padding=1), nn.GELU(),
            nn.Conv1d(64, 96, 3, padding=1), nn.GELU(),
            nn.AdaptiveAvgPool1d(4), nn.Flatten(),
            nn.Linear(96 * 4, 256), nn.GELU(),
            nn.Linear(256, 64 * 4 * 4), nn.Tanh(),
        )
        self.merge = nn.Sequential(
            nn.Conv2d(128, 128, 3, padding=1), nn.GELU(),
            nn.Conv2d(128, 96, 3, padding=1), nn.GELU(),
        )
        self.decoder = nn.Sequential(
            nn.ConvTranspose2d(96, 96, 4, 2, 1), nn.GELU(),
            nn.ConvTranspose2d(96, 64, 4, 2, 1), nn.GELU(),
            nn.ConvTranspose2d(64, 32, 4, 2, 1), nn.GELU(),
            nn.ConvTranspose2d(32, 3, 4, 2, 1), nn.Sigmoid(),
        )

    def forward(self, reference: torch.Tensor, audio: torch.Tensor):
        if audio.ndim != 3 or audio.shape[1:] != (NUM_MELS, AUDIO_CONTEXT):
            raise ValueError("Expected audio mel features [N,80,21]")
        if audio.shape[0] != reference.shape[0]:
            raise ValueError("Batch mismatch")
        frame_context = self.image_encoder(hide_reference_mouth(reference))
        audio_context = self.audio_encoder(audio).view(reference.shape[0], 64, 4, 4)
        return self.decoder(self.merge(torch.cat((frame_context, audio_context), dim=1)))


def masked_mae(predicted: torch.Tensor, target: torch.Tensor) -> torch.Tensor:
    if predicted.shape != target.shape:
        raise ValueError("Image target shape mismatch")
    mask = reveal_mask(predicted.device)
    error = (predicted - target).abs() * mask
    return error.sum() / (predicted.shape[0] * 3 * mask.sum())


def masked_loss(predicted: torch.Tensor, target: torch.Tensor) -> torch.Tensor:
    mask = reveal_mask(predicted.device)
    l1 = masked_mae(predicted, target)
    horizontal = ((predicted[:, :, :, 1:] - predicted[:, :, :, :-1])
                  - (target[:, :, :, 1:] - target[:, :, :, :-1])).abs()
    vertical = ((predicted[:, :, 1:, :] - predicted[:, :, :-1, :])
                - (target[:, :, 1:, :] - target[:, :, :-1, :])).abs()
    edge_horizontal = mask[:, :, :, 1:] * mask[:, :, :, :-1]
    edge_vertical = mask[:, :, 1:, :] * mask[:, :, :-1, :]
    edge_loss = ((horizontal * edge_horizontal).sum() /
                 (predicted.shape[0] * 3 * edge_horizontal.sum())
                 + (vertical * edge_vertical).sum() /
                 (predicted.shape[0] * 3 * edge_vertical.sum()))
    return l1 + .06 * edge_loss


def _val_metrics(model, loader, device):
    model.eval()
    totals = dict(valMaskedMAE=0., copyReferenceMaskedMAE=0.,
                  maskedInputMAE=0., shuffledAudioMaskedMAE=0., audioSensitivity=0.)
    count = 0
    with torch.no_grad():
        for reference, audio, target in loader:
            reference, audio, target = reference.to(device), audio.to(device), target.to(device)
            n = len(reference)
            prediction = model(reference, audio)
            # Shift audio against image: tests whether the true audio improves
            # reconstruction, not whether random audio can cause random motion.
            shuffled = torch.roll(audio, shifts=max(1, n // 2), dims=0)
            changed = model(reference, shuffled)
            totals["valMaskedMAE"] += float(masked_mae(prediction, target)) * n
            totals["copyReferenceMaskedMAE"] += float(masked_mae(reference, target)) * n
            totals["maskedInputMAE"] += float(masked_mae(hide_reference_mouth(reference), target)) * n
            totals["shuffledAudioMaskedMAE"] += float(masked_mae(changed, target)) * n
            totals["audioSensitivity"] += float(((prediction - changed).abs() * reveal_mask(device)).sum()
                                                / (3 * reveal_mask(device).sum()))  # weighted sum over batch
            count += n
    if count == 0:
        raise ValueError("Validation split must be non-empty")
    metrics = {k: round(v / count, 7) for k, v in totals.items()}
    metrics["correctVsShuffledMAEGain"] = round(
        metrics["shuffledAudioMaskedMAE"] - metrics["valMaskedMAE"], 7)
    return metrics


def masked_retrain(dataset: Path, checkpoint: Path, epochs: int = 36,
                   batch_size: int = 8, lr: float = .0003, device: str = "cpu",
                   seed: int = 42, patience: int = 10,
                   min_epochs: int = 20, min_delta: float = .0002) -> dict:
    if (not 1 <= epochs <= 50 or not 2 <= batch_size <= 64 or not 1e-7 <= lr <= 1e-2
            or not 0 <= patience <= epochs or not 1 <= min_epochs <= epochs
            or not 0 <= min_delta <= .1):
        raise ValueError("Invalid research training / early-stop parameters")
    if torch.device(device).type == "cuda" and not torch.cuda.is_available():
        raise ValueError("Requested CUDA but no GPU is available")
    torch.set_num_threads(min(torch.get_num_threads(), 2))
    torch.manual_seed(seed)
    np.random.seed(seed)
    clips = validate_prepared(dataset)
    train_data = PairedSingingFrames(dataset / "train")
    val_data = PairedSingingFrames(dataset / "val")
    if len(val_data) < 2:
        raise ValueError("Audio counterfactual needs >=2 validation frames")
    training = DataLoader(train_data, batch_size=batch_size, shuffle=True, num_workers=0)
    validation = DataLoader(val_data, batch_size=batch_size, shuffle=False, num_workers=0)
    model = MaskedSingingMouthNet().to(device)
    opt = torch.optim.AdamW(model.parameters(), lr=lr)
    history, best = [], float("inf")
    significant_best, no_improvement = float("inf"), 0
    early_stopped = False
    for epoch in range(epochs):
        model.train()
        loss_total, processed = 0., 0
        for reference, audio, target in training:
            reference, audio, target = reference.to(device), audio.to(device), target.to(device)
            prediction = model(reference, audio)
            loss = masked_loss(prediction, target)
            opt.zero_grad(set_to_none=True)
            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            opt.step()
            processed += len(reference)
            loss_total += float(loss.detach()) * len(reference)
        metrics = _val_metrics(model, validation, device)
        record = {"epoch": epoch + 1, "trainLoss": round(loss_total / processed, 7), **metrics}
        history.append(record)
        print("SONG_MASKED_TRAIN_EPOCH=" + json.dumps(record), flush=True)
        if metrics["valMaskedMAE"] < best:
            best = metrics["valMaskedMAE"]
            checkpoint.parent.mkdir(parents=True, exist_ok=True)
            torch.save({
                "modelVersion": MASKED_MODEL_VERSION,
                "stateDict": {key: val.detach().cpu() for key, val in model.state_dict().items()},
                "trainingFrames": len(train_data), "validationFrames": len(val_data),
                "epoch": epoch + 1, "bestValMaskedMAE": best,
                "commerciallyValidated": False,
                "status": "research_only_unvalidated_checkpoint",
            }, checkpoint)
        if metrics["valMaskedMAE"] < significant_best - min_delta:
            significant_best = metrics["valMaskedMAE"]
            no_improvement = 0
        else:
            no_improvement += 1
        if patience > 0 and epoch + 1 >= min_epochs and no_improvement >= patience:
            early_stopped = True
            print("SONG_MASKED_EARLY_STOP=" + json.dumps({
                "epoch": epoch + 1,
                "patience": patience,
                "minEpochs": min_epochs,
                "minDelta": min_delta,
                "bestValidationMAE": best,
            }), flush=True)
            break
    final = min(history, key=lambda item: item["valMaskedMAE"])
    diagnostics = []
    if final["valMaskedMAE"] >= final["copyReferenceMaskedMAE"]:
        diagnostics.append("WORSE_THAN_COPY_REFERENCE")
    if final["audioSensitivity"] <= .0001:
        diagnostics.append("LOW_AUDIO_SENSITIVITY")
    if final["correctVsShuffledMAEGain"] <= .0001:
        diagnostics.append("NO_POSITIVE_AUDIO_ALIGNMENT_GAIN")
    if final["valMaskedMAE"] >= final["maskedInputMAE"]:
        diagnostics.append("WORSE_THAN_MASKED_INPUT")
    report = {
        "modelVersion": MASKED_MODEL_VERSION,
        "status": "research_only_not_lipsync_validated",
        "datasetSplit": "disjoint_recordings_not_independent_singers",
        "trainClips": clips["train"], "valClips": clips["val"],
        "trainFrames": len(train_data), "valFrames": len(val_data),
        "bestEpoch": final["epoch"], "bestMetrics": final,
        "requestedEpochs": epochs, "completedEpochs": len(history),
        "earlyStopped": early_stopped,
        "earlyStoppingPatience": patience,
        "earlyStoppingMinEpochs": min_epochs,
        "earlyStoppingMinDelta": min_delta,
        "history": history, "diagnosticFlags": diagnostics,
        "canAcceptPaidJobs": False,
        "checkpointSha256": hashlib.sha256(checkpoint.read_bytes()).hexdigest(),
        "limitations": [
            "No speaker-independent validation",
            "No direct phoneme or viseme scoring",
            "Audio sensitivity alone does not prove correct synchronization",
            "Research-only RAVDESS model weights may not be commercialized",
        ],
    }
    checkpoint.with_suffix(".report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return report


def load_masked_model(path: Path, device: str = "cpu") -> MaskedSingingMouthNet:
    # Only load trusted operator-generated weights. No arbitrary customer uploads.
    payload = torch.load(path, map_location="cpu", weights_only=True)
    if payload.get("modelVersion") != MASKED_MODEL_VERSION:
        raise ValueError("Expected masked-v2 model checkpoint; v1 weights are not compatible")
    model = MaskedSingingMouthNet()
    model.load_state_dict(payload["stateDict"], strict=True)
    return model.to(device).eval()


def main():
    parser = argparse.ArgumentParser(description="Local masked-reference audio-mouth retrain")
    parser.add_argument("--dataset", type=Path, required=True)
    parser.add_argument("--checkpoint", type=Path, required=True)
    parser.add_argument("--epochs", type=int, default=36)
    parser.add_argument("--patience", type=int, default=10)
    parser.add_argument("--min-epochs", type=int, default=20)
    parser.add_argument("--min-delta", type=float, default=.0002)
    parser.add_argument("--batch-size", type=int, default=8)
    parser.add_argument("--lr", type=float, default=.0003)
    parser.add_argument("--device", default="cpu")
    args = parser.parse_args()
    report = masked_retrain(args.dataset, args.checkpoint, args.epochs,
                            args.batch_size, args.lr, args.device,
                            patience=args.patience, min_epochs=args.min_epochs,
                            min_delta=args.min_delta)
    print("SONG_MASKED_TRAIN_RESULT=" + json.dumps({
        "modelVersion": MASKED_MODEL_VERSION,
        "bestMetrics": report["bestMetrics"],
        "diagnosticFlags": report["diagnosticFlags"],
        "canAcceptPaidJobs": False,
    }))


if __name__ == "__main__":
    main()
