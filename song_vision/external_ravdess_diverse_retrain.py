"""RAVDESS diverse-utterance research retrain, no commercial data reuse.

Expands the previous two-take same-utterance experiment to varied emotions,
two recorded song statements and repetitions, preserving recording-level splits.
All licensed media and trained weights remain temporary and are never exported.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import tempfile
import zipfile
from dataclasses import dataclass
from pathlib import Path

from .external_ravdess_research import (
    ARCHIVE_URL, ORIGINAL_MD5, RECORD_URL, download_public_archive,
)
from .masked_retrain import masked_retrain
from .research_checkpoint_vault import seal
from .real_training import prepare_manifest

EMOTIONS = ("02", "03", "04", "05", "06")  # calm, happy, sad, angry, fearful
STATEMENTS = ("01", "02")
REPETITIONS = ("01", "02")
MAX_CLIP_FILE_BYTES = 50 * 1024 * 1024


@dataclass(frozen=True)
class SelectedTake:
    path: Path
    emotion: str
    statement: str
    repetition: str

    @property
    def split(self):
        return "train" if self.repetition == "01" else "val"


def select_diverse_research_takes(archive: Path, folder: Path) -> list[SelectedTake]:
    """Only extract the 20 named audio-video SONG takes for Actor 01."""
    selected = []
    with zipfile.ZipFile(archive) as z:
        by_name = {}
        for name in z.namelist():
            by_name.setdefault(Path(name).name, []).append(name)
        for emotion in EMOTIONS:
            for statement in STATEMENTS:
                for repetition in REPETITIONS:
                    name = f"01-02-{emotion}-01-{statement}-{repetition}-01.mp4"
                    choices = by_name.get(name, [])
                    if len(choices) != 1:
                        raise ValueError(f"Expected one source RAVDESS song: {name}")
                    member = z.getinfo(choices[0])
                    if not 100_000 <= member.file_size <= MAX_CLIP_FILE_BYTES:
                        raise ValueError(f"Out-of-range recording size: {name}")
                    dest = folder / name
                    with z.open(member) as source, dest.open("wb") as output:
                        shutil.copyfileobj(source, output)
                    selected.append(SelectedTake(dest, emotion, statement, repetition))
    if len(selected) != 20 or len({x.path.name for x in selected}) != 20:
        raise AssertionError("Expected exactly twenty unique original takes")
    return selected


def prepare_diverse_assets(takes: list[SelectedTake], folder: Path) -> Path:
    consent = folder / "noncommercial-license-evidence.json"
    consent.write_text(json.dumps({
        "approved": True,
        "scope": "train_singing",
        "subjectId": "RAVDESS-Actor-01-research-dataset",
        "license": "CC-BY-NC-SA-4.0",
        "source": RECORD_URL,
        "commercialUseAllowed": False,
        "usage": "noncommercial_methodology_research_only",
        "humanSubjectApproval": "research_release_not_individual_commercial_training_consent",
    }), encoding="utf-8")
    clips = []
    for index, take in enumerate(takes):
        duration = float(subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", str(take.path)],
            capture_output=True, text=True, check=True).stdout.strip())
        if not 2 <= duration <= 15:
            raise ValueError("Unexpected singing recording length")
        vocals = folder / f"research-singing-{index:02d}.wav"
        subprocess.run(
            ["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
             "-i", str(take.path), "-vn", "-ac", "1", "-ar", "16000",
             "-c:a", "pcm_s16le", str(vocals)],
            check=True, capture_output=True)
        clips.append({
            "id": "ravdess-" + take.path.stem,
            "split": take.split,
            "video": take.path.name,
            "vocals": vocals.name,
            "consent": consent.name,
            "audioOffsetMs": 0,
            "maxSeconds": min(3.0, duration - .1),
        })
    manifest = folder / "research-diverse-manifest.json"
    manifest.write_text(json.dumps({"schemaVersion": 1, "clips": clips}, indent=2),
                        encoding="utf-8")
    return manifest


def run_research(epochs: int = 36, patience: int = 10, min_epochs: int = 20,
                 vault_public_key: Path | None = None,
                 vault_output_dir: Path | None = None):
    if not 1 <= epochs <= 40 or not 1 <= min_epochs <= epochs or not 0 <= patience <= epochs:
        raise ValueError("Invalid research-only epoch or early stopping limits")
    if vault_public_key is None or vault_output_dir is None:
        raise ValueError("A durable encrypted research checkpoint backup destination is required")
    if not vault_public_key.is_file():
        raise FileNotFoundError("Research-only public key is missing")
    with tempfile.TemporaryDirectory(prefix="song-vision-ravdess-diverse-cc-nc-") as td:
        folder = Path(td)
        archive = folder / "source.zip"
        md5 = download_public_archive(archive)
        if md5 != ORIGINAL_MD5:
            raise RuntimeError("Source MD5 mismatch")
        takes = select_diverse_research_takes(archive, folder)
        manifest = prepare_diverse_assets(takes, folder)
        data_root = folder / "research-only-train-val"
        summary = prepare_manifest(manifest, data_root)
        checkpoint = folder / "ephemeral-v2-masked-model.pt"
        report = masked_retrain(data_root, checkpoint, epochs=epochs, batch_size=12,
                                seed=42, patience=patience, min_epochs=min_epochs,
                                min_delta=.0002)
        metrics = report["bestMetrics"]
        # Save licensed research weights BEFORE temporary raw-media directory cleanup.
        # The private decryption key exists only with the owner, never on CI.
        run_id = os.environ.get("GITHUB_RUN_ID", "local-research")
        attempt = os.environ.get("GITHUB_RUN_ATTEMPT", "1")
        archive_name = f"song-ravdess-research-run-{run_id}-attempt-{attempt}.svault"
        encrypted_checkpoint = vault_output_dir / archive_name
        metadata = {
            "dataset": "RAVDESS-Actor-01",
            "license": "CC-BY-NC-SA-4.0",
            "commercialUseAllowed": False,
            "checkpointCategory": "research_only_not_lipsync_validated",
            "githubRunId": str(run_id) + "-attempt-" + str(attempt),
            "modelVersion": report["modelVersion"],
            "bestEpoch": int(report["bestEpoch"]),
            "completedEpochs": int(len(report["history"])),
            "trainFrameCount": int(report["trainFrames"]),
            "valFrameCount": int(report["valFrames"]),
            "sourceRecord": RECORD_URL,
        }
        sealed = seal(checkpoint, checkpoint.with_suffix(".report.json"),
                      vault_public_key, encrypted_checkpoint, metadata)
        vault_manifest = {
            "archive": archive_name,
            "encryptedFileSha256": sealed["encryptedFileSha256"],
            "modelVersion": sealed["modelVersion"],
            "license": sealed["license"],
            "commercialUseAllowed": False,
            "userOwnedPrivateKeyRequired": True,
            "source": RECORD_URL,
            "trainFrameCount": report["trainFrames"],
            "valFrameCount": report["valFrames"],
            "bestMetrics": metrics,
            "diagnosticFlags": report["diagnosticFlags"],
            "noRawFaceOrAudioFilesInArchive": True,
        }
        manifest_file = vault_output_dir / (archive_name + ".manifest.json")
        with manifest_file.open("x", encoding="utf-8") as handle:
            json.dump(vault_manifest, handle, ensure_ascii=False, indent=2)
        conclusion = {
            "experiment": "RAVDESS_20_takes_masked_audio_retrain",
            "licensedSource": RECORD_URL,
            "license": "CC-BY-NC-SA-4.0",
            "originalArchiveMd5Verified": True,
            "performerCount": 1,
            "uniqueRecordingCount": len(takes),
            "trainTakeCount": sum(x.split == "train" for x in takes),
            "valTakeCount": sum(x.split == "val" for x in takes),
            "trainFrames": report["trainFrames"],
            "valFrames": report["valFrames"],
            "trainingEpochsRequested": epochs,
            "trainingEpochsCompleted": len(report["history"]),
            "earlyStopped": report["earlyStopped"],
            "earlyStoppingPatience": patience,
            "earlyStoppingMinEpochs": min_epochs,
            "earlyStoppingMinDelta": .0002,
            "bestEpoch": report["bestEpoch"],
            "metrics": metrics,
            "diagnosticFlags": report["diagnosticFlags"],
            "generalizationLimitation": "same actor, two utterance texts, different repetitions; no new speaker test",
            "legacyV1MetricsDirectlyComparable": False,
            "commercialUsagePermitted": False,
            "weightsPublished": False,
            "facialMediaPublished": False,
            "renderingQualityValidated": False,
            "customerJobsEnabled": False,
            "temporaryRawMediaDisposedOnJobCompletion": True,
            "researchCheckpointEncryptedForPreservation": True,
            "researchCheckpointPublishedUnencrypted": False,
            "encryptedArchiveName": archive_name,
            "encryptedFileSha256": sealed["encryptedFileSha256"],
        }
        print("SONG_DIVERSE_RETRAIN_RESULT=" + json.dumps(conclusion, ensure_ascii=False, sort_keys=True), flush=True)
        return conclusion


def main():
    parser = argparse.ArgumentParser(description="20 authorized RAVDESS recordings, noncommercial research")
    parser.add_argument("--acknowledge-noncommercial-research", action="store_true")
    parser.add_argument("--epochs", type=int, default=36)
    parser.add_argument("--patience", type=int, default=10)
    parser.add_argument("--min-epochs", type=int, default=20)
    parser.add_argument("--vault-public-key", type=Path, required=True)
    parser.add_argument("--vault-output-dir", type=Path, required=True)
    args = parser.parse_args()
    if not args.acknowledge_noncommercial_research:
        parser.error("Noncommercial research acknowledgment required")
    run_research(epochs=args.epochs, patience=args.patience,
                 min_epochs=args.min_epochs,
                 vault_public_key=args.vault_public_key,
                 vault_output_dir=args.vault_output_dir)


if __name__ == "__main__":
    main()
