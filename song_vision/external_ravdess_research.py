"""One-shot RAVDESS singing data research smoke-run.

Rights: RAVDESS is CC BY-NC-SA 4.0, NOT approved for commercial model training,
deployment or monetization. This script requires an explicit research-only flag,
never publishes frames, source video, derived weights or a demonstration video.
It is for validating the code/data path. Do not use the checkpoint in SONG.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import subprocess
import tempfile
import urllib.request
import zipfile
from pathlib import Path

from .real_training import prepare_manifest, train_validated

RECORD_URL = "https://zenodo.org/records/1188976"
ARCHIVE_URL = RECORD_URL + "/files/Video_Song_Actor_01.zip?download=1"
ORIGINAL_MD5 = "0f7ba20f3a7278d5a662a7e30f44c942"
FILE_NAMES = (
    "01-02-03-01-01-01-01.mp4",  # actor 01, song, happy, normal, 1st take
    "01-02-03-01-01-02-01.mp4",  # same singer, separate repetition
)
MAX_BYTES = 530 * 1024 * 1024


def command(*args):
    run = subprocess.run(args, check=True, capture_output=True, text=True)
    return run.stdout.strip()


def download_public_archive(dest: Path) -> str:
    request = urllib.request.Request(
        ARCHIVE_URL,
        headers={"User-Agent": "SONG-Vision-Research/1.0 (research validation only)"},
    )
    sha_md5 = hashlib.md5()
    size = 0
    with urllib.request.urlopen(request, timeout=90) as response, dest.open("wb") as stream:
        while True:
            chunk = response.read(1 << 20)
            if not chunk:
                break
            size += len(chunk)
            if size > MAX_BYTES:
                raise ValueError("Archive exceeded verified upstream size limit")
            sha_md5.update(chunk)
            stream.write(chunk)
    checksum = sha_md5.hexdigest()
    if checksum != ORIGINAL_MD5:
        raise ValueError("Zenodo archive MD5 did not match the original source")
    return checksum


def select_research_clips(archive_path: Path, destination: Path) -> list[Path]:
    extracted = []
    with zipfile.ZipFile(archive_path) as source:
        members = source.namelist()
        for i, expected in enumerate(FILE_NAMES):
            matching = [m for m in members if Path(m).name == expected]
            if len(matching) != 1:
                raise ValueError(f"Expected exactly one source song clip {expected}; found {len(matching)}")
            path = destination / f"ravdess-research-clip-{i + 1}.mp4"
            info = source.getinfo(matching[0])
            if info.file_size > 50 * 1024 * 1024:
                raise ValueError("Individual song clip size unexpectedly large")
            with source.open(info) as data, path.open("wb") as out:
                shutil.copyfileobj(data, out)
            if path.stat().st_size < 100_000:
                raise ValueError("Song video too small")
            extracted.append(path)
    return extracted


def prepare_external_research_assets(source_files: list[Path], root: Path) -> Path:
    consent = root / "research-licensing.json"
    consent.write_text(json.dumps({
        "approved": True,
        "scope": "train_singing",
        "subjectId": "ravdess-actor-01-research-dataset",
        "rightsEvidence": RECORD_URL,
        "license": "CC-BY-NC-SA-4.0",
        "usage": "noncommercial_research_only",
        "commercialPermissionVerified": False,
        "actorRecordingForResearch": True,
    }, indent=2), encoding="utf-8")
    clips = []
    for i, video in enumerate(source_files):
        duration = float(command(
            "ffprobe", "-v", "error", "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1", str(video)))
        if not 2.0 <= duration <= 15.0:
            raise ValueError(f"Unexpected song take duration {duration}s")
        vocals = root / f"research-vocals-{i + 1}.wav"
        # Same A/V file ensures audio and visual recording correspond to one performance.
        # RAVDESS solo-song stimulus has no separate pop music accompaniment stem.
        subprocess.run([
            "ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error",
            "-y", "-i", str(video), "-vn", "-ac", "1", "-ar", "16000",
            "-c:a", "pcm_s16le", str(vocals)
        ], check=True, capture_output=True)
        clips.append({
            "id": f"ravdess-actor-01-take-{i + 1}",
            "split": "train" if i == 0 else "val",
            "video": video.name,
            "vocals": vocals.name,
            "consent": consent.name,
            "audioOffsetMs": 0,
            "maxSeconds": min(3.0, duration - 0.1),
        })
    manifest = root / "research-manifest.json"
    manifest.write_text(json.dumps({"schemaVersion": 1, "clips": clips}, indent=2),
                        encoding="utf-8")
    return manifest


def research_run(checkpoint: Path | None = None, epochs: int = 1) -> dict:
    if epochs not in (1, 2, 3):
        raise ValueError("Research demo limited to 1-3 epochs")
    with tempfile.TemporaryDirectory(prefix="song-ravdess-cc-nc-research-") as td:
        root = Path(td)
        archive = root / "original-source.zip"
        md5 = download_public_archive(archive)
        sources = select_research_clips(archive, root)
        manifest = prepare_external_research_assets(sources, root)
        dataset = root / "private-derived-train-val"
        prepared = prepare_manifest(manifest, dataset)
        # Keep model weights and derived face crops on the ephemeral runner only.
        weights = root / "private-research-checkpoint.pt"
        fit = train_validated(dataset, weights, epochs=epochs, batch_size=8, lr=.0003)
        last = fit["history"][-1]
        output = {
            "source": "RAVDESS",
            "citation": "Livingstone & Russo, PLoS ONE 13(5):e0196391 (2018)",
            "zenodoRecord": RECORD_URL,
            "license": "CC-BY-NC-SA-4.0",
            "archiveMd5Verified": md5 == ORIGINAL_MD5,
            "sameSingerId": "01",
            "split": "distinct recordings of same actor / same sentence; NOT independent speakers",
            "trainFrames": fit["trainFrames"],
            "valFrames": fit["valFrames"],
            "valMAE": last["valMAE"],
            "copyReferenceMAE": last["copyReferenceMAE"],
            "audioSensitivity": last["audioSensitivity"],
            "diagnosticFlags": fit.get("diagnosticFlags", []),
            "checkpointPublished": False,
            "sourceMediaPublished": False,
            "qualityValidated": False,
            "commercialUseAllowed": False,
            "message": "Real licensed research data tested only; no claim of usable singing-lip synthesis.",
        }
        # No facial data, source media, person images, checkpoint or paths printed.
        print("SONG_RAVDESS_RESEARCH_RESULTS=" + json.dumps(output, ensure_ascii=False))
        return output


def main():
    parser = argparse.ArgumentParser(description="RAVDESS CC-NC research only, never a commercial training run")
    parser.add_argument("--acknowledge-noncommercial-research", action="store_true",
                        help="Required: no reuse of data-derived weights for paid SONG jobs")
    parser.add_argument("--epochs", type=int, default=1, choices=(1, 2, 3))
    args = parser.parse_args()
    if not args.acknowledge_noncommercial_research:
        parser.error("This sample is CC BY-NC-SA and can only be used for non-commercial research.")
    research_run(epochs=args.epochs)


if __name__ == "__main__":
    main()
