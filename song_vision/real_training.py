"""Consent-backed synchronized video/vocal training for SONG-Vision.

Run locally. Neither this module nor the base model calls a hosted AI API.
This is a research pipeline, not a commercially validated singing model.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np
import torch
from torch import nn
from torch.utils.data import DataLoader

from .core import (
    MODEL_VERSION, PairedSingingFrames, SingingMouthNet, assert_consent,
    audio_features, crop_face, decode_audio, detect_face, face_cascade,
    mel_window, tensor_patch,
)

FPS = 25
MIN_FRAMES = 16
VALID_SPLITS = frozenset({"train", "val"})


@dataclass(frozen=True)
class Clip:
    clip_id: str
    split: str
    video: Path
    vocals: Path
    consent: Path
    audio_offset_ms: int = 0
    face_box: tuple[int, int, int, int] | None = None
    max_seconds: float = 30.0


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def read_manifest(path: Path) -> list[Clip]:
    """Manifest paths are relative to the manifest directory, not the repo."""
    data = json.loads(path.read_text(encoding="utf-8"))
    if data.get("schemaVersion") != 1 or not isinstance(data.get("clips"), list):
        raise ValueError("Manifest needs schemaVersion=1 and a clips array")
    clips = []
    ids = set()
    for spec in data["clips"]:
        clip_id = spec.get("id")
        if not isinstance(clip_id, str) or re.fullmatch(r"[A-Za-z0-9_-]{1,64}", clip_id) is None:
            raise ValueError("Invalid clip ID")
        if clip_id in ids:
            raise ValueError("Repeated clip IDs would leak between train and val")
        ids.add(clip_id)
        split = spec.get("split")
        if split not in VALID_SPLITS:
            raise ValueError("Every clip requires train or val split")

        def private_file(key: str) -> Path:
            value = spec.get(key)
            if not isinstance(value, str) or not value.strip():
                raise ValueError(f"Missing {key} for {clip_id}")
            file = (path.parent / value).resolve()
            if not file.is_file():
                raise FileNotFoundError(f"Missing {key} for {clip_id}: {file}")
            return file

        consent = private_file("consent")
        assert_consent(consent, scope="train_singing")
        offset = spec.get("audioOffsetMs", 0)
        if type(offset) is not int or not -30000 <= offset <= 30000:
            raise ValueError("audioOffsetMs must be an integer within ±30000ms")
        box = spec.get("faceBox")
        if box is not None:
            if not isinstance(box, list) or len(box) != 4 or any(type(v) is not int for v in box):
                raise ValueError("faceBox must be [x,y,width,height] in original video pixels")
            if any(v < 0 for v in box[:2]) or any(v < 40 for v in box[2:]):
                raise ValueError("Invalid faceBox position or size")
            box = tuple(box)
        maximum = spec.get("maxSeconds", 30)
        if not isinstance(maximum, (float, int)) or not math.isfinite(maximum) or not 0.64 <= maximum <= 300:
            raise ValueError("maxSeconds must be 0.64..300")
        clips.append(Clip(clip_id, split, private_file("video"),
                          private_file("vocals"), consent, offset, box, float(maximum)))
    if {c.split for c in clips} != VALID_SPLITS:
        raise ValueError("Require at least one separate train clip and one val clip")
    return clips


def check_alignment(vocal_duration: float, video_duration: float,
                    audio_offset_ms: int, clip_id: str) -> None:
    """Positive offset means vocal timeline is ahead of the video timeline."""
    start_audio_time = audio_offset_ms / 1000.0
    end_audio_time = video_duration + start_audio_time
    # ±40ms tolerance from frame boundary / resampling.
    # When audio starts after video (negative offset), skip unvoiced lead-in.
    valid_video_start = max(0., -start_audio_time)
    if video_duration - valid_video_start < MIN_FRAMES / FPS or end_audio_time > vocal_duration + 0.04:
        raise ValueError(f"{clip_id}: vocal timeline does not cover sufficient video after offset")


def prepare_clip(clip: Clip, dataset: Path) -> dict:
    """CFR normalization, verified local timing, detected or operator-supplied ROI."""
    assert_consent(clip.consent, scope="train_singing")
    out_dir = dataset / clip.split / clip.clip_id
    if out_dir.exists():
        raise FileExistsError(f"Refusing to overwrite private dataset {out_dir}")
    waveform = decode_audio(clip.vocals)
    mel = audio_features(waveform)
    vocal_duration = len(waveform) / 16000.0
    with tempfile.TemporaryDirectory(prefix="song-vision-cfr-") as tmp:
        cfr_path = Path(tmp) / "cfr.mp4"
        subprocess.run([
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
            "-i", str(clip.video), "-vf", f"fps={FPS}", "-an", "-vsync", "cfr",
            "-c:v", "mpeg4", "-q:v", "2", str(cfr_path),
        ], check=True, capture_output=True)
        capture = cv2.VideoCapture(str(cfr_path))
        frame_count = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
        if not capture.isOpened() or frame_count < MIN_FRAMES:
            raise ValueError(f"{clip.clip_id}: video cannot provide >=16 frames")
        limit_frames = min(frame_count, int(clip.max_seconds * FPS))
        if limit_frames < MIN_FRAMES:
            raise ValueError("Insufficient frames in selected clip")
        check_alignment(vocal_duration, limit_frames / FPS, clip.audio_offset_ms, clip.clip_id)
        detector = face_cascade() if clip.face_box is None else None
        collected = []
        output_frames = []
        eligible_frames = 0
        # Collect in memory to avoid leaving a half-written dataset on failure.
        for index in range(limit_frames):
            ok, frame = capture.read()
            if not ok:
                raise ValueError(f"{clip.clip_id}: video decoder stopped unexpectedly")
            video_time = index / FPS
            audio_time = video_time + clip.audio_offset_ms / 1000
            if audio_time < 0:
                continue  # video preroll before the vocal stem begins
            eligible_frames += 1
            box = clip.face_box if clip.face_box is not None else detect_face(frame, detector)
            if box is None:
                continue
            try:
                face = crop_face(frame, box)
            except ValueError:
                raise ValueError(f"{clip.clip_id}: invalid face crop at frame {index}") from None
            if audio_time > vocal_duration + 0.04:
                raise ValueError("Unexpected vocal time outside input")
            filename = f"{len(collected):06d}.png"
            # Existing PairedSingingFrames uses 'seconds' as the vocal timestamp.
            collected.append({"file": filename, "seconds": round(audio_time, 6),
                              "videoSeconds": round(video_time, 6)})
            output_frames.append(face)
        capture.release()
        coverage = len(collected) / max(eligible_frames, 1)
        if len(collected) < MIN_FRAMES or coverage < .80:
            raise ValueError(f"{clip.clip_id}: face coverage {coverage:.1%}, require >=80%")
    frames_dir = out_dir / "frames"
    frames_dir.mkdir(parents=True)
    for entry, frame in zip(collected, output_frames):
        if not cv2.imwrite(str(frames_dir / entry["file"]), frame):
            raise OSError("Failed saving consented face crop")
    np.save(out_dir / "mel.npy", mel, allow_pickle=False)
    consent_data = json.loads(clip.consent.read_text(encoding="utf-8"))
    meta = {
        "schemaVersion": 2, "clipId": clip.clip_id, "split": clip.split,
        "fps": FPS, "audioOffsetMs": clip.audio_offset_ms,
        "frames": collected, "trackingCoverage": round(coverage, 6),
        "sourceVideoSha256": sha256(clip.video),
        "sourceVocalsSha256": sha256(clip.vocals),
        "consentEvidenceSha256": sha256(clip.consent),
        "consentSubjectId": consent_data["subjectId"],
        "trainingPermissionVerifiedByOperator": False,
        "note": "Consent JSON is a guard only; operator must verify legal consent before training",
    }
    (out_dir / "index.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"clipId": clip.clip_id, "split": clip.split, "frames": len(collected),
            "trackingCoverage": round(coverage, 6), "audioOffsetMs": clip.audio_offset_ms}


def prepare_manifest(manifest: Path, dataset: Path) -> list[dict]:
    clips = read_manifest(manifest)
    return [prepare_clip(clip, dataset) for clip in clips]


def validate_prepared(root: Path) -> dict:
    counts = {split: [] for split in VALID_SPLITS}
    all_ids = set()
    for split in sorted(VALID_SPLITS):
        for index in sorted((root / split).glob("*/index.json")):
            data = json.loads(index.read_text(encoding="utf-8"))
            if data.get("schemaVersion") != 2 or data.get("split") != split:
                raise ValueError("Dataset format or declared split mismatch")
            if data.get("clipId") in all_ids:
                raise ValueError("Duplicate ID across training/validation data")
            all_ids.add(data["clipId"])
            if not data.get("consentEvidenceSha256") or not data.get("consentSubjectId"):
                raise ValueError("Dataset missing consent provenance")
            if len(data.get("frames", [])) < MIN_FRAMES:
                raise ValueError("Insufficient frames")
            counts[split].append(data["clipId"])
        if not counts[split]:
            raise ValueError("Missing prepared train and val clips")
    return counts


def model_loss(predicted: torch.Tensor, target: torch.Tensor) -> torch.Tensor:
    pixel = (predicted - target).abs().mean()
    dx = (predicted[:, :, :, 1:] - predicted[:, :, :, :-1]) - (target[:, :, :, 1:] - target[:, :, :, :-1])
    dy = (predicted[:, :, 1:, :] - predicted[:, :, :-1, :]) - (target[:, :, 1:, :] - target[:, :, :-1, :])
    return pixel + 0.08 * (dx.abs().mean() + dy.abs().mean())


def train_validated(dataset: Path, checkpoint: Path, epochs: int = 10,
                    batch_size: int = 8, lr: float = 3e-4, device: str = "cpu",
                    seed: int = 42) -> dict:
    if not 1 <= epochs <= 500 or not 1 <= batch_size <= 128 or not 1e-7 <= lr <= .01:
        raise ValueError("Invalid training parameters")
    splits = validate_prepared(dataset)
    torch.manual_seed(seed)
    np.random.seed(seed)
    train_data = PairedSingingFrames(dataset / "train")
    val_data = PairedSingingFrames(dataset / "val")
    train_loader = DataLoader(train_data, batch_size=batch_size, shuffle=True, num_workers=0)
    val_loader = DataLoader(val_data, batch_size=batch_size, shuffle=False, num_workers=0)
    model = SingingMouthNet().to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=lr)
    best_val = float("inf")
    history = []
    for epoch in range(epochs):
        model.train()
        loss_sum, count = 0., 0
        for source, audio, target in train_loader:
            source, audio, target = source.to(device), audio.to(device), target.to(device)
            prediction = model(source, audio)
            loss = model_loss(prediction, target)
            optimizer.zero_grad(set_to_none=True)
            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()
            loss_sum += float(loss.detach()) * len(source)
            count += len(source)
        model.eval()
        val_error, baseline_error, val_count, audio_sensitivity = 0., 0., 0, 0.
        with torch.no_grad():
            for source, audio, target in val_loader:
                source, audio, target = source.to(device), audio.to(device), target.to(device)
                predicted = model(source, audio)
                val_error += float((predicted - target).abs().mean()) * len(source)
                baseline_error += float((source - target).abs().mean()) * len(source)
                # Counterfactual probe: does changing the vocal influence the result?
                swapped = model(source, torch.roll(audio, shifts=1, dims=0))
                audio_sensitivity += float((predicted - swapped).abs().mean()) * len(source)
                val_count += len(source)
        stats = {"epoch": epoch + 1, "trainLoss": round(loss_sum / count, 6),
                 "valMAE": round(val_error / val_count, 6),
                 "copyReferenceMAE": round(baseline_error / val_count, 6),
                 "audioSensitivity": round(audio_sensitivity / val_count, 8)}
        history.append(stats)
        print(json.dumps(stats), flush=True)
        if val_error / val_count < best_val:
            best_val = val_error / val_count
            checkpoint.parent.mkdir(parents=True, exist_ok=True)
            torch.save({"modelVersion": MODEL_VERSION,
                        "stateDict": {k: v.detach().cpu() for k, v in model.state_dict().items()},
                        "trainingFrames": len(train_data), "validationFrames": len(val_data),
                        "epochs": epoch + 1, "validationMAE": best_val,
                        "trainingStatus": "unvalidated_research_checkpoint"}, checkpoint)
    diagnostic_flags = []
    if history[-1]["valMAE"] >= history[-1]["copyReferenceMAE"]:
        diagnostic_flags.append("WORSE_THAN_COPY_REFERENCE")
    if history[-1]["audioSensitivity"] <= 0.0001:
        diagnostic_flags.append("LOW_AUDIO_SENSITIVITY")
    report = {"status": "research_only_not_lipsync_validated", "modelVersion": MODEL_VERSION,
              "trainClips": splits["train"], "valClips": splits["val"],
              "splitType": "disjoint_clips_not_necessarily_disjoint_performers",
              "trainFrames": len(train_data), "valFrames": len(val_data),
              "bestValMAE": round(best_val, 6), "checkpoint": str(checkpoint),
              "checkpointSha256": sha256(checkpoint), "history": history,
              "diagnosticFlags": diagnostic_flags,
              "limitations": ["No independent human lip-sync rating", "No proof of singer identity preservation",
                              "Audio sensitivity is only a diagnostic, not lip-sync accuracy"]}
    checkpoint.with_suffix(".training-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return report


def main():
    parser = argparse.ArgumentParser(description="Self-hosted synchronized singing video training")
    commands = parser.add_subparsers(dest="cmd", required=True)
    p = commands.add_parser("prepare", help="CFR face frames + aligned vocal mel train/val")
    p.add_argument("--manifest", required=True, type=Path)
    p.add_argument("--dataset", required=True, type=Path)
    p = commands.add_parser("train", help="train with disjoint clip validation")
    p.add_argument("--dataset", required=True, type=Path)
    p.add_argument("--checkpoint", required=True, type=Path)
    p.add_argument("--epochs", type=int, default=10)
    p.add_argument("--batch-size", type=int, default=8)
    p.add_argument("--lr", type=float, default=.0003)
    p.add_argument("--device", default="cpu")
    p.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()
    if args.cmd == "prepare":
        print(json.dumps(prepare_manifest(args.manifest, args.dataset), ensure_ascii=False))
    else:
        print(json.dumps(train_validated(args.dataset, args.checkpoint, args.epochs,
                                         args.batch_size, args.lr, args.device, args.seed), ensure_ascii=False))


if __name__ == "__main__":
    main()
