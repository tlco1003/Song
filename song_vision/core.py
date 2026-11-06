"""SONG-Vision v1: trainable local audio-conditioned singing-mouth renderer.

This is original research code, not a downloaded pretrained video model.
A checkpoint is generated only after training. Customer-face mode is an
experimental 2D composite, NOT a learned identity-swap model.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import subprocess
import tempfile
from pathlib import Path

import cv2
import numpy as np
import torch
from torch import nn
from torch.utils.data import DataLoader, Dataset

SAMPLE_RATE = 16000
HOP = 160
NUM_MELS = 80
AUDIO_CONTEXT = 21
FACE_SIZE = 96
MOUTH_SIZE = 64
MODEL_VERSION = "song-vision-mouth-v1"


def decode_audio(path: str | Path) -> np.ndarray:
    """Decode audio locally using FFmpeg, preserving original track separately."""
    command = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", str(path),
               "-vn", "-f", "s16le", "-ac", "1", "-ar", str(SAMPLE_RATE), "-"]
    result = subprocess.run(command, capture_output=True, check=True)
    if not result.stdout:
        raise ValueError("Audio empty or undecodable")
    return np.frombuffer(result.stdout, dtype="<i2").astype(np.float32) / 32768.0


def mel_filterbank(n_fft: int = 512) -> torch.Tensor:
    """Build triangular Mel filters locally with no third-party checkpoints."""
    mel = lambda hz: 2595.0 * math.log10(1.0 + hz / 700.0)
    hz = lambda m: 700.0 * (10.0 ** (m / 2595.0) - 1.0)
    boundaries = [hz(m) for m in np.linspace(mel(0.0), mel(SAMPLE_RATE / 2), NUM_MELS + 2)]
    frequencies = torch.linspace(0, SAMPLE_RATE / 2, n_fft // 2 + 1)
    matrix = torch.zeros(NUM_MELS, len(frequencies))
    for i in range(NUM_MELS):
        left, center, right = boundaries[i:i + 3]
        rising = (frequencies - left) / max(center - left, 1e-6)
        falling = (right - frequencies) / max(right - center, 1e-6)
        matrix[i] = torch.maximum(torch.zeros_like(frequencies), torch.minimum(rising, falling))
        matrix[i] *= 2.0 / max(right - left, 1e-6)
    return matrix


def audio_features(waveform: np.ndarray) -> np.ndarray:
    """80-channel log-Mel spectrogram at 10 ms hop; no online inference."""
    wave = torch.from_numpy(np.asarray(waveform, dtype=np.float32).copy())
    spectrum = torch.stft(wave, n_fft=512, hop_length=HOP, win_length=400,
                          window=torch.hann_window(400), center=True, return_complex=True)
    mel = mel_filterbank() @ spectrum.abs().square()
    return torch.log1p(mel * 100.0).numpy().astype(np.float32)


def mel_window(mel: np.ndarray, seconds: float) -> np.ndarray:
    if mel.ndim != 2 or mel.shape[0] != NUM_MELS or mel.shape[1] == 0:
        raise ValueError("Expected nonempty mel array [80, time]")
    center = round(seconds * SAMPLE_RATE / HOP)
    indices = np.clip(np.arange(center - AUDIO_CONTEXT // 2,
                                center + AUDIO_CONTEXT // 2 + 1), 0, mel.shape[1] - 1)
    return mel[:, indices].astype(np.float32)


def face_cascade():
    detector = cv2.CascadeClassifier(
        cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
    if detector.empty():
        raise RuntimeError("OpenCV face detector unavailable")
    return detector


def detect_face(frame: np.ndarray, detector):
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    boxes = detector.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5,
                                      minSize=(40, 40))
    if len(boxes) == 0:
        return None
    return tuple(map(int, max(boxes, key=lambda b: int(b[2]) * int(b[3]))))


def crop_face(frame: np.ndarray, box) -> np.ndarray:
    x, y, w, h = box
    if w <= 0 or h <= 0 or x < 0 or y < 0 or x + w > frame.shape[1] or y + h > frame.shape[0]:
        raise ValueError("Face box out of bounds")
    return cv2.resize(frame[y:y + h, x:x + w], (FACE_SIZE, FACE_SIZE),
                      interpolation=cv2.INTER_AREA)


def mouth_bounds(size: int):
    return (int(size * .18), int(size * .52),
            int(size * .82), int(size * .92))


def mouth_patch(face: np.ndarray) -> np.ndarray:
    x1, y1, x2, y2 = mouth_bounds(face.shape[0])
    return cv2.resize(face[y1:y2, x1:x2], (MOUTH_SIZE, MOUTH_SIZE))


def blend_mouth(frame: np.ndarray, box, predicted_patch: np.ndarray) -> np.ndarray:
    """Feather a generated lower-face crop without changing body or background."""
    x, y, w, h = box
    fx1, fy1, fx2, fy2 = mouth_bounds(FACE_SIZE)
    x1, x2 = x + round(w * fx1 / FACE_SIZE), x + round(w * fx2 / FACE_SIZE)
    y1, y2 = y + round(h * fy1 / FACE_SIZE), y + round(h * fy2 / FACE_SIZE)
    if x1 < 0 or y1 < 0 or x2 > frame.shape[1] or y2 > frame.shape[0] or x2 <= x1 or y2 <= y1:
        raise ValueError("Mouth crop outside image")
    original = frame[y1:y2, x1:x2]
    patch = cv2.resize(predicted_patch, (x2 - x1, y2 - y1)).astype(np.float32)
    yy, xx = np.mgrid[0:y2 - y1, 0:x2 - x1]
    dx = np.minimum(xx, x2 - x1 - 1 - xx) / max(1., (x2 - x1) * .12)
    dy = np.minimum(yy, y2 - y1 - 1 - yy) / max(1., (y2 - y1) * .18)
    alpha = np.minimum(1, np.minimum(dx, dy)).astype(np.float32)[..., None]
    result = frame.copy()
    result[y1:y2, x1:x2] = np.clip(patch * alpha + original * (1 - alpha), 0, 255).astype(np.uint8)
    return result


class SingingMouthNet(nn.Module):
    """Original audio-conditioned image encoder + FiLM + image decoder.

    This is a deliberately small train-from-scratch baseline, not MuseTalk,
    diffusion, or a pretrained general-purpose face generator.
    """
    def __init__(self):
        super().__init__()
        self.image_encoder = nn.Sequential(
            nn.Conv2d(3, 32, 4, 2, 1), nn.GELU(),
            nn.Conv2d(32, 64, 4, 2, 1), nn.GELU(),
            nn.Conv2d(64, 128, 4, 2, 1), nn.GELU(),
            nn.Conv2d(128, 128, 4, 2, 1), nn.GELU())
        self.audio_encoder = nn.Sequential(
            nn.Conv1d(NUM_MELS, 128, 3, padding=1), nn.GELU(),
            nn.Conv1d(128, 128, 3, padding=1), nn.GELU(),
            nn.AdaptiveAvgPool1d(1), nn.Flatten())
        self.film = nn.Linear(128, 256)
        self.decoder = nn.Sequential(
            nn.ConvTranspose2d(128, 128, 4, 2, 1), nn.GELU(),
            nn.ConvTranspose2d(128, 64, 4, 2, 1), nn.GELU(),
            nn.ConvTranspose2d(64, 32, 4, 2, 1), nn.GELU(),
            nn.ConvTranspose2d(32, 3, 4, 2, 1), nn.Sigmoid())

    def forward(self, reference_mouth: torch.Tensor, vocal_mel: torch.Tensor):
        if reference_mouth.ndim != 4 or reference_mouth.shape[1:] != (3, MOUTH_SIZE, MOUTH_SIZE):
            raise ValueError("Expected mouth image [N,3,64,64]")
        if vocal_mel.ndim != 3 or vocal_mel.shape[1:] != (NUM_MELS, AUDIO_CONTEXT):
            raise ValueError("Expected audio feature [N,80,21]")
        image = self.image_encoder(reference_mouth)
        gamma, beta = self.film(self.audio_encoder(vocal_mel)).chunk(2, dim=1)
        return self.decoder(image * (1 + .1 * gamma[:, :, None, None]) +
                            .1 * beta[:, :, None, None])


def tensor_patch(bgr: np.ndarray) -> torch.Tensor:
    return torch.from_numpy(np.transpose(bgr.astype(np.float32) / 255.,
                                          (2, 0, 1)).copy())


def assert_consent(path: Path | None, scope: str = "face_swap_prototype"):
    if path is None:
        raise ValueError("Signed/recorded consent evidence is required")
    consent = json.loads(path.read_text(encoding="utf-8"))
    if consent.get("approved") is not True or consent.get("scope") != scope or not consent.get("subjectId"):
        raise ValueError("No approved subject-specific consent for operation")


class PairedSingingFrames(Dataset):
    """Pair vocal features with target frames and different same-identity reference frames."""
    def __init__(self, root: Path):
        self.examples = []
        for index_file in sorted(root.glob("*/index.json")):
            folder = index_file.parent
            records = json.loads(index_file.read_text(encoding="utf-8"))["frames"]
            if len(records) < 16:
                continue
            mel = np.load(folder / "mel.npy", allow_pickle=False)
            for i, target in enumerate(records):
                self.examples.append((folder, target, records[(i + 8) % len(records)], mel))
        if not self.examples:
            raise ValueError("No prepared singing footage: need >=16 face frames")

    def __len__(self):
        return len(self.examples)

    def __getitem__(self, i):
        folder, target, source, mel = self.examples[i]
        target_img = cv2.imread(str(folder / "frames" / target["file"]))
        source_img = cv2.imread(str(folder / "frames" / source["file"]))
        if target_img is None or source_img is None:
            raise FileNotFoundError("A prepared training frame is missing")
        return (tensor_patch(mouth_patch(source_img)),
                torch.from_numpy(mel_window(mel, float(target["seconds"]))),
                tensor_patch(mouth_patch(target_img)))


def prepare(video: Path, vocals: Path, dataset: Path, clip_id: str,
            seconds: float, consent_record: Path):
    """Extract consented training data; do not upload footage to GitHub."""
    assert_consent(consent_record, scope="train_singing")
    if not clip_id.isascii() or not clip_id.replace("-", "").replace("_", "").isalnum():
        raise ValueError("clip-id must use ASCII letters/numbers/-/_")
    if not 0 < seconds <= 300:
        raise ValueError("Require 0 < seconds <= 300")
    destination = dataset / clip_id
    if destination.exists():
        raise FileExistsError("Clip already prepared; refusing overwrite")
    cap = cv2.VideoCapture(str(video))
    fps = cap.get(cv2.CAP_PROP_FPS)
    if not cap.isOpened() or not math.isfinite(fps) or fps <= 0:
        raise ValueError("Video missing or FPS invalid")
    waveform = decode_audio(vocals)
    if len(waveform) / SAMPLE_RATE + .05 < min(seconds, cap.get(cv2.CAP_PROP_FRAME_COUNT) / fps):
        raise ValueError("Vocal and video duration mismatch")
    mel = audio_features(waveform)
    detector = face_cascade()
    frames = []
    destination.mkdir(parents=True)
    (destination / "frames").mkdir()
    source_index, next_time = 0, 0.
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        now = source_index / fps
        source_index += 1
        if now > seconds:
            break
        if now + 1e-6 < next_time:
            continue
        next_time += 1 / 25
        box = detect_face(frame, detector)
        if box is None:
            continue
        filename = f"{len(frames):06d}.png"
        if not cv2.imwrite(str(destination / "frames" / filename), crop_face(frame, box)):
            raise IOError("Unable to save prepared face frame")
        frames.append({"file": filename, "seconds": round(now, 5)})
    cap.release()
    if len(frames) < 16:
        raise ValueError("Too few frontal face frames; choose stable singing footage")
    np.save(destination / "mel.npy", mel, allow_pickle=False)
    (destination / "index.json").write_text(json.dumps({
        "version": 1, "clipId": clip_id, "fps": 25, "frames": frames,
        "sourceVideoStored": False, "vocalFileStored": False,
        "consentRecorded": True}, indent=2), encoding="utf-8")
    return len(frames)


def train(dataset: Path, checkpoint: Path, epochs: int, batch_size: int,
          learning_rate: float, device: str):
    if not 1 <= epochs <= 10000 or not 1 <= batch_size <= 512 or not 0 < learning_rate <= .01:
        raise ValueError("Training hyperparameters out of bounds")
    torch.manual_seed(42)
    samples = PairedSingingFrames(dataset)
    loader = DataLoader(samples, batch_size=batch_size, shuffle=True, num_workers=0)
    model = SingingMouthNet().to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=learning_rate)
    for epoch in range(epochs):
        model.train()
        total, count = 0., 0
        for source, vocal, target in loader:
            source, vocal, target = source.to(device), vocal.to(device), target.to(device)
            prediction = model(source, vocal)
            l1 = (prediction - target).abs().mean()
            dx = (prediction[:, :, :, 1:] - prediction[:, :, :, :-1]) - (target[:, :, :, 1:] - target[:, :, :, :-1])
            dy = (prediction[:, :, 1:, :] - prediction[:, :, :-1, :]) - (target[:, :, 1:, :] - target[:, :, :-1, :])
            loss = l1 + .08 * (dx.abs().mean() + dy.abs().mean())
            optimizer.zero_grad(set_to_none=True)
            loss.backward()
            optimizer.step()
            total += loss.item() * len(source)
            count += len(source)
        print(json.dumps({"epoch": epoch + 1, "trainLoss": round(total / count, 6), "frames": count}))
    checkpoint.parent.mkdir(parents=True, exist_ok=True)
    torch.save({"modelVersion": MODEL_VERSION, "stateDict": model.cpu().state_dict(),
                "trainingFrames": len(samples), "epochs": epochs,
                "trainingStatus": "unvalidated_research_checkpoint"}, checkpoint)
    return checkpoint


def load_model(checkpoint: Path, device: str) -> SingingMouthNet:
    weights = torch.load(checkpoint, map_location="cpu", weights_only=True)
    if weights.get("modelVersion") != MODEL_VERSION or weights.get("trainingFrames", 0) < 16:
        raise ValueError("No compatible trained checkpoint")
    model = SingingMouthNet()
    model.load_state_dict(weights["stateDict"], strict=True)
    return model.to(device).eval()


def experimental_identity_overlay(frame: np.ndarray, box, portrait_face: np.ndarray):
    """Static 2D OpenCV composite; explicitly NOT neural face replacement."""
    x, y, w, h = box
    source = cv2.resize(portrait_face, (w, h))
    mask = np.zeros((h, w), dtype=np.uint8)
    cv2.ellipse(mask, (w // 2, h // 2), (int(w * .41), int(h * .45)),
                0, 0, 360, 255, -1)
    return cv2.seamlessClone(source, frame, mask, (x + w // 2, y + h // 2),
                            cv2.NORMAL_CLONE)


def render(template: Path, vocals: Path, mix: Path, checkpoint: Path,
           output: Path, seconds: float, start: float, device: str,
           identity_photo: Path | None, consent_record: Path | None):
    if not 1 <= seconds <= 30 or start < 0:
        raise ValueError("Research output limited to 1-30 seconds")
    model = load_model(checkpoint, device)
    audio = decode_audio(vocals)
    if (start + seconds) * SAMPLE_RATE > len(audio) + 160:
        raise ValueError("Vocal stem does not cover the selected segment")
    mel = audio_features(audio)
    cap = cv2.VideoCapture(str(template))
    fps = cap.get(cv2.CAP_PROP_FPS)
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    if not cap.isOpened() or not math.isfinite(fps) or fps <= 0 or min(width, height) < 120:
        raise ValueError("Missing or invalid template video")
    detector = face_cascade()
    portrait_face = None
    if identity_photo is not None:
        assert_consent(consent_record)
        portrait = cv2.imread(str(identity_photo))
        box = detect_face(portrait, detector) if portrait is not None else None
        if box is None:
            raise ValueError("Customer portrait must contain one detectable frontal face")
        portrait_face = crop_face(portrait, box)
    output.parent.mkdir(parents=True, exist_ok=True)
    observed = detected = 0
    with tempfile.TemporaryDirectory(prefix="song-vision-") as folder:
        silent = Path(folder) / "silent.mp4"
        writer = cv2.VideoWriter(str(silent), cv2.VideoWriter_fourcc(*"mp4v"),
                                 25., (width, height))
        if not writer.isOpened():
            raise RuntimeError("OpenCV MP4 encoder unavailable")
        with torch.inference_mode():
            for i in range(math.ceil(seconds * 25)):
                # The original stage performance is reused; only the face ROI is resynthesized.
                template_length = max(1 / fps, cap.get(cv2.CAP_PROP_FRAME_COUNT) / fps)
                cap.set(cv2.CAP_PROP_POS_MSEC, (i / 25 % template_length) * 1000)
                ok, frame = cap.read()
                if not ok:
                    raise ValueError("Could not read requested template frame")
                observed += 1
                box = detect_face(frame, detector)
                if box is None:
                    writer.write(frame)
                    continue
                detected += 1
                if portrait_face is not None:
                    frame = experimental_identity_overlay(frame, box, portrait_face)
                reference = tensor_patch(mouth_patch(crop_face(frame, box)))[None].to(device)
                feature = torch.from_numpy(mel_window(mel, start + i / 25))[None].to(device)
                predicted = model(reference, feature)[0].cpu().numpy().transpose(1, 2, 0)
                frame = blend_mouth(frame, box,
                                    (np.clip(predicted, 0., 1.) * 255).astype(np.uint8))
                writer.write(frame)
        writer.release()
        cap.release()
        tracking_rate = detected / max(1, observed)
        if tracking_rate < .60:
            raise RuntimeError(f"Too many untracked frames ({tracking_rate:.1%}); reject output")
        subprocess.run([
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(silent),
            "-ss", str(start), "-t", str(seconds), "-i", str(mix),
            "-map", "0:v:0", "-map", "1:a:0", "-c:v", "libx264", "-crf", "20",
            "-preset", "medium", "-pix_fmt", "yuv420p", "-c:a", "aac",
            "-b:a", "192k", "-t", str(seconds), "-movflags", "+faststart",
            str(output)], check=True, capture_output=True)
    if not output.exists() or output.stat().st_size < 1000:
        raise IOError("Output video not created")
    report = {
        "modelVersion": MODEL_VERSION,
        "status": "research_only_not_commercially_validated",
        "faceTrackingRate": round(tracking_rate, 4),
        "identityReplacement": "experimental_2d_composite" if portrait_face is not None else "none",
        "checkpointSha256": hashlib.sha256(checkpoint.read_bytes()).hexdigest()}
    output.with_suffix(".quality.json").write_text(json.dumps(report, indent=2),
                                                     encoding="utf-8")
    return report


def main():
    parser = argparse.ArgumentParser(description="SONG-Vision self-hosted research CLI")
    commands = parser.add_subparsers(dest="command", required=True)
    p = commands.add_parser("prepare")
    p.add_argument("--video", type=Path, required=True)
    p.add_argument("--vocals", type=Path, required=True)
    p.add_argument("--dataset", type=Path, required=True)
    p.add_argument("--clip-id", required=True)
    p.add_argument("--seconds", type=float, default=30.)
    p.add_argument("--consent-record", type=Path, required=True)
    p = commands.add_parser("train")
    p.add_argument("--dataset", type=Path, required=True)
    p.add_argument("--checkpoint", type=Path, required=True)
    p.add_argument("--epochs", type=int, default=10)
    p.add_argument("--batch-size", type=int, default=16)
    p.add_argument("--learning-rate", type=float, default=.0003)
    p.add_argument("--device", default="cpu")
    p = commands.add_parser("render")
    p.add_argument("--template", type=Path, required=True)
    p.add_argument("--vocals", type=Path, required=True)
    p.add_argument("--mix", type=Path, required=True)
    p.add_argument("--checkpoint", type=Path, required=True)
    p.add_argument("--output", type=Path, required=True)
    p.add_argument("--seconds", type=float, default=10.)
    p.add_argument("--start", type=float, default=0.)
    p.add_argument("--device", default="cpu")
    p.add_argument("--identity-photo", type=Path)
    p.add_argument("--consent-record", type=Path)
    args = parser.parse_args()
    if args.command == "prepare":
        print(json.dumps({"preparedFrames": prepare(args.video, args.vocals, args.dataset,
                                                     args.clip_id, args.seconds, args.consent_record)}))
    elif args.command == "train":
        print(json.dumps({"checkpoint": str(train(args.dataset, args.checkpoint, args.epochs,
                                                   args.batch_size, args.learning_rate, args.device))}))
    else:
        print(json.dumps(render(args.template, args.vocals, args.mix, args.checkpoint,
                                args.output, args.seconds, args.start, args.device,
                                args.identity_photo, args.consent_record)))


if __name__ == "__main__":
    main()
