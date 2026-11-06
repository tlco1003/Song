"""Research-only RAVDESS singer-held-out A/V lip-motion experiment.

Train: Actor 01 (male) + Actor 02 (female) singing.
Validation: unseen Actor 03 (male), ALL its takes held out.
This is a true performer-disjoint validation split (but only one held-out
performer, two English statements, and no natural full-length songs).

Source: https://zenodo.org/records/1188976  CC BY-NC-SA 4.0.
Always verify Zenodo-recorded MD5 per archive. Never publish raw media.
Produce only X25519-encrypted research checkpoints for the owner-held key.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
import zipfile
from dataclasses import dataclass
from pathlib import Path

from .external_ravdess_diverse_retrain import (
    EMOTIONS, STATEMENTS, REPETITIONS, MAX_CLIP_FILE_BYTES,
)
from .masked_retrain import masked_retrain
from .real_training import prepare_manifest
from .research_checkpoint_vault import seal

RECORD_URL = "https://zenodo.org/records/1188976"
ACTOR_MD5 = {
    "01": "0f7ba20f3a7278d5a662a7e30f44c942",
    "02": "8e426ef4134abe1dff4d2a8262abe8a9",
    "03": "2d686591f8760f8041d2dc75e8234828",
}
TRAIN_ACTORS = frozenset({"01", "02"})
HOLDOUT_ACTORS = frozenset({"03"})
DATASET_ID = "RAVDESS-Actors-01-02-03"
MAX_ARCHIVE_BYTES = 660 * 1024 * 1024
ARCHIVE_ATTEMPTS = 4


@dataclass(frozen=True)
class SingingTake:
    path: Path
    actor: str
    emotion: str
    statement: str
    repetition: str

    @property
    def split(self) -> str:
        return "val" if self.actor in HOLDOUT_ACTORS else "train"


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def download_official_actor_zip(actor: str, archive: Path) -> str:
    """Bounded retries for transient network/5xx failures, strict MD5 always."""
    if actor not in ACTOR_MD5:
        raise ValueError("Actor not in approved, officially hashed research set")
    url = f"{RECORD_URL}/files/Video_Song_Actor_{actor}.zip?download=1"
    req = urllib.request.Request(
        url, headers={"User-Agent": "SONG-Vision/2.0 (licensed research; no commercial use)"}
    )
    if archive.exists():
        raise FileExistsError("Refusing to overwrite an existing verified source")
    for attempt in range(ARCHIVE_ATTEMPTS):
        md5, size = hashlib.md5(), 0
        try:
            with urllib.request.urlopen(req, timeout=120) as response:
                with archive.open("xb") as output:
                    while True:
                        chunk = response.read(1024 * 1024)
                        if not chunk:
                            break
                        size += len(chunk)
                        if size > MAX_ARCHIVE_BYTES:
                            raise ValueError("Actor source archive exceeded allowed bytes")
                        md5.update(chunk)
                        output.write(chunk)
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as exc:
            archive.unlink(missing_ok=True)
            if isinstance(exc, urllib.error.HTTPError) and exc.code not in (429, 500, 502, 503, 504):
                raise
            if attempt == ARCHIVE_ATTEMPTS - 1:
                raise
            delay = (5, 15, 30)[attempt]
            print(json.dumps({"event": "zenodo_transient_retry", "actor": actor,
                              "attempt": attempt + 1, "backoffSec": delay}), flush=True)
            time.sleep(delay)
            continue
        except Exception:
            archive.unlink(missing_ok=True)
            raise
        checksum = md5.hexdigest()
        if checksum != ACTOR_MD5[actor]:
            archive.unlink(missing_ok=True)
            raise ValueError(f"Zenodo official source MD5 mismatch for actor {actor}")
        print(json.dumps({"event": "source_verified", "actor": actor,
                          "bytes": size, "md5": checksum}), flush=True)
        return checksum
    raise AssertionError("Unreachable retry exit")


def extract_research_takes(archive: Path, folder: Path, actor: str) -> list[SingingTake]:
    """Extract 20 named actor audiovisual singing files; prevent ZIP traversal."""
    if actor not in ACTOR_MD5:
        raise ValueError("Unknown actor")
    output = []
    with zipfile.ZipFile(archive) as zf:
        by_base = {}
        for name in zf.namelist():
            by_base.setdefault(Path(name).name, []).append(name)
        for emotion in EMOTIONS:
            for statement in STATEMENTS:
                for repetition in REPETITIONS:
                    expected = f"01-02-{emotion}-01-{statement}-{repetition}-{actor}.mp4"
                    found = by_base.get(expected, [])
                    if len(found) != 1:
                        raise ValueError(f"Exactly one authorized clip required: {expected}")
                    info = zf.getinfo(found[0])
                    if info.is_dir() or not 100_000 <= info.file_size <= MAX_CLIP_FILE_BYTES:
                        raise ValueError(f"Invalid source clip file size: {expected}")
                    dest = folder / expected
                    if dest.exists():
                        raise FileExistsError("Duplicate training clip extraction")
                    with zf.open(info) as stream, dest.open("xb") as target:
                        shutil.copyfileobj(stream, target, length=1024 * 1024)
                    output.append(SingingTake(dest, actor, emotion, statement, repetition))
    if len(output) != 20 or len({x.path.name for x in output}) != 20:
        raise ValueError(f"Expected 20 distinct recordings for actor {actor}")
    return output


def check_singer_disjoint(takes: list[SingingTake]) -> dict:
    if len(takes) != 60 or len({x.path.name for x in takes}) != 60:
        raise ValueError("60 individual recordings required for this experiment")
    train = {x.actor for x in takes if x.split == "train"}
    val = {x.actor for x in takes if x.split == "val"}
    if train != TRAIN_ACTORS or val != HOLDOUT_ACTORS or train.intersection(val):
        raise ValueError("True singer-disjoint train/holdout split is mandatory")
    return {"trainActors": sorted(train), "holdoutActors": sorted(val),
            "trainRecordings": sum(x.split == "train" for x in takes),
            "holdoutRecordings": sum(x.split == "val" for x in takes)}


def make_research_manifest(takes: list[SingingTake], folder: Path) -> Path:
    split_report = check_singer_disjoint(takes)
    clips = []
    for actor in sorted(ACTOR_MD5):
        consent = folder / f"research-licence-actor-{actor}.json"
        with consent.open("x", encoding="utf-8") as output:
            json.dump({
                "approved": True,
                "scope": "train_singing",
                "subjectId": f"RAVDESS-Actor-{actor}-research",
                "source": RECORD_URL,
                "license": "CC-BY-NC-SA-4.0",
                "usage": "NONCOMMERCIAL_RESEARCH_ONLY",
                "commercialUseAllowed": False,
                "note": "Research license, not commercial likeness/AI-model consent",
            }, output, indent=2)
    for i, take in enumerate(takes):
        proc = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", str(take.path)],
            capture_output=True, text=True, check=True,
        )
        duration = float(proc.stdout.strip())
        if not 2 <= duration <= 15:
            raise ValueError(f"Unexpected singer recording duration for {take.path.name}")
        vocal = folder / f"research-vocals-{i:03d}.wav"
        subprocess.run(
            ["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
             "-i", str(take.path), "-vn", "-ac", "1", "-ar", "16000",
             "-c:a", "pcm_s16le", str(vocal)],
            check=True, capture_output=True,
        )
        clips.append({
            "id": "ravdess-" + take.path.stem,
            "split": take.split,
            "video": take.path.name,
            "vocals": vocal.name,
            "consent": f"research-licence-actor-{take.actor}.json",
            "audioOffsetMs": 0,
            "maxSeconds": min(3., duration - .1),
        })
    manifest = folder / "research-multi-singer-manifest.json"
    with manifest.open("x", encoding="utf-8") as output:
        json.dump({"schemaVersion": 1, "clips": clips}, output, indent=2)
    print("SONG_PERFORMER_DISJOINT_SPLIT=" +
          json.dumps(split_report, sort_keys=True), flush=True)
    return manifest


def run_multi_singer_research(
    vault_public_key: Path,
    vault_output_dir: Path,
    epochs: int = 24,
    min_epochs: int = 12,
    patience: int = 7,
    seed: int = 42,
) -> dict:
    if not (8 <= epochs <= 40 and 1 <= min_epochs <= epochs and 0 <= patience <= 25):
        raise ValueError("Research epoch / early stopping limits violated")
    if not vault_public_key.is_file():
        raise FileNotFoundError("Only an owner-owned offline public encryption key may be used")
    if vault_output_dir.exists() and any(vault_output_dir.iterdir()):
        raise FileExistsError("Refusing to overwrite an existing study checkpoint collection")
    with tempfile.TemporaryDirectory(prefix="song-ravdess-3-actors-cc-nc-") as td:
        root = Path(td)
        takes, checksums = [], {}
        for actor in sorted(ACTOR_MD5):
            archive = root / f"Actor-{actor}-verified.zip"
            checksums[actor] = download_official_actor_zip(actor, archive)
            takes.extend(extract_research_takes(archive, root, actor))
            archive.unlink()  # Keep space for decoded face training frames.
        split = check_singer_disjoint(takes)
        manifest = make_research_manifest(takes, root)
        dataset = root / "data-research-only"
        prepared = prepare_manifest(manifest, dataset)
        checkpoint = root / "singer-disjoint-research-model.pt"
        report = masked_retrain(
            dataset, checkpoint, epochs=epochs, min_epochs=min_epochs,
            patience=patience, min_delta=.0002, batch_size=12, seed=seed, lr=.0003,
        )
        run_id = os.getenv("GITHUB_RUN_ID", "local-research")
        attempt = os.getenv("GITHUB_RUN_ATTEMPT", "1")
        name = f"song-ravdess-3actors-run-{run_id}-attempt-{attempt}.svault"
        metadata = {
            "dataset": DATASET_ID,
            "license": "CC-BY-NC-SA-4.0",
            "commercialUseAllowed": False,
            "checkpointCategory": "research_only_not_lipsync_validated",
            "githubRunId": f"{run_id}-attempt-{attempt}",
            "modelVersion": report["modelVersion"],
            "trainActors": split["trainActors"],
            "holdoutActors": split["holdoutActors"],
            "trainingFrames": report["trainFrames"],
            "holdoutFrames": report["valFrames"],
            "bestEpoch": report["bestEpoch"],
            "sourceMd5": checksums,
        }
        result = seal(
            checkpoint, checkpoint.with_suffix(".report.json"),
            vault_public_key, vault_output_dir / name, metadata,
        )
        manifest_file = vault_output_dir / (name + ".manifest.json")
        with manifest_file.open("x", encoding="utf-8") as output:
            json.dump({
                "archive": name, "encryptedFileSha256": result["encryptedFileSha256"],
                "license": "CC-BY-NC-SA-4.0", "commercialUseAllowed": False,
                "dataset": DATASET_ID,
                "trainActors": split["trainActors"],
                "holdoutActors": split["holdoutActors"],
                "trainingRecordings": split["trainRecordings"],
                "holdoutRecordings": split["holdoutRecordings"],
                "trainFrames": report["trainFrames"],
                "holdoutFrames": report["valFrames"],
                "bestMetrics": report["bestMetrics"],
                "diagnosticFlags": report["diagnosticFlags"],
                "researchUseOnly": True,
                "customerJobsEnabled": False,
                "rawMediaStoredInVault": False,
                "keyHeldOutsideGithub": True,
            }, output, indent=2, sort_keys=True)
        summary = {
            "dataset": DATASET_ID,
            "officialSource": RECORD_URL,
            "sourceMd5": checksums,
            "license": "CC-BY-NC-SA-4.0",
            "trainActors": split["trainActors"],
            "holdoutActors": split["holdoutActors"],
            "trainRecordings": split["trainRecordings"],
            "holdoutRecordings": split["holdoutRecordings"],
            "trainFrames": report["trainFrames"],
            "holdoutFrames": report["valFrames"],
            "requestedEpochs": epochs, "completedEpochs": report["completedEpochs"],
            "bestEpoch": report["bestEpoch"],
            "earlyStopped": report["earlyStopped"],
            "bestMetrics": report["bestMetrics"],
            "diagnosticFlags": report["diagnosticFlags"],
            "encryptedArchive": name,
            "encryptedFileSha256": result["encryptedFileSha256"],
            "modelQualityValidated": False,
            "commercialUseAllowed": False,
            "customerJobReady": False,
        }
        print("SONG_MULTI_SINGER_RESEARCH_RESULT=" +
              json.dumps(summary, ensure_ascii=False, sort_keys=True), flush=True)
        return summary


def main() -> None:
    parser = argparse.ArgumentParser(description="RAVDESS 3-actor singer-held-out study")
    parser.add_argument("--acknowledge-noncommercial-research", action="store_true")
    parser.add_argument("--vault-public-key", type=Path, required=True)
    parser.add_argument("--vault-output-dir", type=Path, required=True)
    parser.add_argument("--epochs", type=int, default=24)
    parser.add_argument("--min-epochs", type=int, default=12)
    parser.add_argument("--patience", type=int, default=7)
    args = parser.parse_args()
    if not args.acknowledge_noncommercial_research:
        parser.error("Explicitly accept RAVDESS CC BY-NC-SA research-only use first")
    run_multi_singer_research(
        args.vault_public_key, args.vault_output_dir,
        epochs=args.epochs, min_epochs=args.min_epochs, patience=args.patience,
    )


if __name__ == "__main__":
    main()
