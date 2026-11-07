"""SONG-Vision v12: *matched normal vs strong expressions* for vocal->face.

Real RAVDESS singing recordings retain the same actor, statement, emotion,
and repetition while varying annotation "emotional intensity" 01/02.

Neither label is direct muscle EMG, vocal effort, laryngeal pressure nor
calibrated sound pressure. The 8 measured acoustic controls remain the
model's sound inputs. No deterministic rule 'strong => frown/open jaw'.

This study uses only authorized CC BY-NC-SA 4.0 data and encrypts results
with the already existing owner-held public research key.
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

import torch
from torch.utils.data import DataLoader, Subset

from .external_ravdess_multisinger import (
    ACTOR_MD5, TRAIN_ACTORS, HOLDOUT_ACTORS, RECORD_URL, DATASET_ID,
    download_official_actor_zip,
)
from .external_ravdess_diverse_retrain import (
    EMOTIONS, STATEMENTS, REPETITIONS, MAX_CLIP_FILE_BYTES,
)
from .face_surface_motion import annotate_face_surface_dataset
from .real_training import prepare_manifest
from .research_checkpoint_vault import seal
from .voice_to_face_v11 import (
    VoiceFaceFrames, VocalDrivenFaceNet, MODEL_VERSION as NETWORK_VERSION,
    train_voice_to_face, _evaluate,
)

STUDY = "song-vision-normal-vs-strong-phonetic-prosody-face-v12"
INTENSITY_CONDITIONS = ("01", "02")
ACTORS = ("01", "02", "03")
EXPECTED_TAKES_PER_ACTOR = (
    len(EMOTIONS) * len(INTENSITY_CONDITIONS) * len(STATEMENTS) * len(REPETITIONS)
)


@dataclass(frozen=True)
class ConditionTake:
    path: Path
    actor: str
    emotion: str
    condition: str
    statement: str
    repetition: str

    @property
    def split(self) -> str:
        return "val" if self.actor in HOLDOUT_ACTORS else "train"

    @property
    def match_key(self):
        """All factors held fixed except intensity."""
        return (self.actor, self.emotion, self.statement, self.repetition)


def select_condition_balanced_singing(archive: Path, folder: Path,
                                      actor: str) -> list[ConditionTake]:
    """Extract only 40 licensed full AV song clips, with matched intensity pairs."""
    if actor not in ACTOR_MD5:
        raise ValueError("Unknown original RAVDESS signer")
    extracted = []
    with zipfile.ZipFile(archive) as zf:
        lookup = {}
        for member in zf.namelist():
            lookup.setdefault(Path(member).name, []).append(member)
        for emotion in EMOTIONS:
            for condition in INTENSITY_CONDITIONS:
                for statement in STATEMENTS:
                    for repetition in REPETITIONS:
                        filename = (f"01-02-{emotion}-{condition}-{statement}-"
                                    f"{repetition}-{actor}.mp4")
                        matches = lookup.get(filename, [])
                        if len(matches) != 1:
                            raise ValueError(f"Missing/ambiguous matched RAVDESS take {filename}")
                        info = zf.getinfo(matches[0])
                        if not 100_000 <= info.file_size <= MAX_CLIP_FILE_BYTES:
                            raise ValueError(f"Unreasonable source media size {filename}")
                        path = folder / filename
                        if path.exists():
                            raise FileExistsError("No source video may be overwritten")
                        with zf.open(info) as original, path.open("xb") as target:
                            shutil.copyfileobj(original, target, length=1024 * 1024)
                        extracted.append(ConditionTake(
                            path, actor, emotion, condition, statement, repetition))
    if len(extracted) != EXPECTED_TAKES_PER_ACTOR:
        raise ValueError("Expected 40 normal + strong audiovisual actor recordings")
    # Pairing is real: the same recorded text by the same actor, emotion and
    # repetition has TWO independently filmed performances.
    pairs = {}
    for take in extracted:
        pairs.setdefault(take.match_key, set()).add(take.condition)
    if len(pairs) != EXPECTED_TAKES_PER_ACTOR // 2 or any(
        observed != set(INTENSITY_CONDITIONS) for observed in pairs.values()
    ):
        raise ValueError("Missing same-singer, same-text intensity comparison")
    return extracted


def check_performer_and_strength_split(takes: list[ConditionTake]) -> dict:
    if len(takes) != EXPECTED_TAKES_PER_ACTOR * len(ACTORS):
        raise ValueError("Expected 120 verified recordings from 3 signers")
    if len({x.path.name for x in takes}) != len(takes):
        raise ValueError("Duplicate singer performances")
    training = [x for x in takes if x.split == "train"]
    holdout = [x for x in takes if x.split == "val"]
    if ({x.actor for x in training} != TRAIN_ACTORS or
            {x.actor for x in holdout} != HOLDOUT_ACTORS):
        raise ValueError("The unseen singer must never appear in training")
    for signer in ACTORS:
        data = [x for x in takes if x.actor == signer]
        for intensity in INTENSITY_CONDITIONS:
            if sum(x.condition == intensity for x in data) != 20:
                raise ValueError("Every singer must have 20 clips per expressive intensity")
    return {
        "trainActors": sorted(TRAIN_ACTORS),
        "holdoutActors": sorted(HOLDOUT_ACTORS),
        "trainingClips": len(training),
        "validationClips": len(holdout),
        "matchedPairs": len(takes) // 2,
        "normalRecordings": sum(x.condition == "01" for x in takes),
        "strongExpressionRecordings": sum(x.condition == "02" for x in takes),
    }


def make_v12_manifest(takes: list[ConditionTake], folder: Path) -> Path:
    check_performer_and_strength_split(takes)
    for actor in ACTORS:
        consent = folder / f"research-license-actor-{actor}.json"
        with consent.open("x", encoding="utf-8") as output:
            json.dump({
                "approved": True,
                "scope": "train_singing",
                "subjectId": f"RAVDESS-Actor-{actor}-research",
                "source": RECORD_URL,
                "license": "CC-BY-NC-SA-4.0",
                "usage": "NONCOMMERCIAL_RESEARCH_ONLY",
                "commercialUseAllowed": False,
                "note": "Research license does not imply commercial likeness consent",
            }, output)
    clips = []
    for i, take in enumerate(takes):
        duration = float(subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", str(take.path)],
            capture_output=True, text=True, check=True,
        ).stdout.strip())
        if not 2 <= duration <= 15:
            raise ValueError("RAVDESS song clip duration is outside expected range")
        wav = folder / f"study-singer-vocal-{i:03d}.wav"
        subprocess.run(
            ["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
             "-i", str(take.path), "-vn", "-ac", "1", "-ar", "16000",
             "-c:a", "pcm_s16le", str(wav)],
            check=True, capture_output=True,
        )
        clips.append({
            "id": "ravdess-" + take.path.stem,
            "split": take.split,
            "video": take.path.name,
            "vocals": wav.name,
            "consent": f"research-license-actor-{take.actor}.json",
            "audioOffsetMs": 0,
            "maxSeconds": min(3.0, duration - .1),
            # source labels are documented but not passed as direct model
            # control; it must learn movement from paired measured audio.
            "sourceEmotionalIntensity": "normal" if take.condition == "01" else "strong",
        })
    path = folder / "balanced-voice-face-manifest.json"
    with path.open("x", encoding="utf-8") as output:
        json.dump({"schemaVersion": 1, "clips": clips}, output, indent=2)
    return path


def assess_intensity_holdout(dataset: Path, checkpoint: Path) -> dict:
    """Real unseen actor metrics stratified by independently filmed conditions."""
    data = VoiceFaceFrames(dataset / "val")
    groups = {"normal": [], "strongExpression": []}
    for i, record in enumerate(data.records):
        parts = record[0].name.split("-")
        if len(parts) != 8 or parts[0] != "ravdess":
            raise ValueError("Unexpected RAVDESS clip ID; cannot verify intensity split")
        if parts[-1] != "03":
            raise ValueError("Unseen actor must be 03 for stratified evaluation")
        condition = parts[4]
        if condition not in INTENSITY_CONDITIONS:
            raise ValueError("Condition not in original RAVDESS metadata")
        groups["normal" if condition == "01" else "strongExpression"].append(i)
    model = VocalDrivenFaceNet()
    checkpoint_obj = torch.load(checkpoint, map_location="cpu", weights_only=True)
    if checkpoint_obj.get("modelVersion") != NETWORK_VERSION:
        raise ValueError("Checkpoint model architecture not compatible with v11/v12 study")
    model.load_state_dict(checkpoint_obj["stateDict"], strict=True)
    model.eval()
    result = {}
    for condition, indexes in groups.items():
        if len(indexes) < 10:
            raise ValueError("Independent intensity validation lacks data")
        validation = DataLoader(Subset(data, indexes), batch_size=12, shuffle=False)
        result[condition] = {
            "frames": len(indexes),
            **_evaluate(model, validation, device="cpu"),
        }
    return result


def run_condition_research(face_task: Path, vault_public_key: Path,
                           vault_directory: Path, epochs: int = 8,
                           min_epochs: int = 4, patience: int = 4) -> dict:
    if not (1 <= epochs <= 40 and 1 <= min_epochs <= epochs and 0 <= patience <= 40):
        raise ValueError("Invalid v12 research epoch limits")
    if not face_task.is_file() or not vault_public_key.is_file():
        raise FileNotFoundError("Offline face teacher and owner-held public key required")
    if vault_directory.exists() and any(vault_directory.iterdir()):
        raise FileExistsError("Never clobber previous encrypted model")
    with tempfile.TemporaryDirectory(prefix="song-v12-intensity-research-") as temp:
        folder = Path(temp)
        takes, checksums = [], {}
        for actor in ACTORS:
            archive = folder / f"source-actor-{actor}.zip"
            checksums[actor] = download_official_actor_zip(actor, archive)
            takes.extend(select_condition_balanced_singing(archive, folder, actor))
            archive.unlink()
        split = check_performer_and_strength_split(takes)
        manifest = make_v12_manifest(takes, folder)
        dataset = folder / "private-singing-intensity-data"
        prepare_manifest(manifest, dataset, save_acoustic_cues=True)
        coverage = annotate_face_surface_dataset(dataset, face_task, min_coverage=.80)
        checkpoint = folder / "new-not-public-v12-weights.pt"
        report = train_voice_to_face(
            dataset, checkpoint, epochs=epochs, min_epochs=min_epochs,
            patience=patience, batch_size=12,
        )
        stratified = assess_intensity_holdout(dataset, checkpoint)
        run_id = os.getenv("GITHUB_RUN_ID", "local-research")
        attempt = os.getenv("GITHUB_RUN_ATTEMPT", "1")
        archive_name = f"song-v12-intensity-pairs-run-{run_id}-a{attempt}.svault"
        metadata = {
            "dataset": DATASET_ID,
            "study": STUDY,
            "githubRunId": f"{run_id}-a{attempt}",
            "modelVersion": report["modelVersion"],
            "license": "CC-BY-NC-SA-4.0",
            "commercialUseAllowed": False,
            "checkpointCategory": "research_only_not_lipsync_validated",
            "trainActors": split["trainActors"],
            "holdoutActors": split["holdoutActors"],
            "sourceChecksums": checksums,
            "conditionProtocol": "normal_and_strong_emotional_expression",
            "bestEpoch": report["bestEpoch"],
        }
        encrypted = seal(
            checkpoint, checkpoint.with_suffix(".report.json"),
            vault_public_key, vault_directory / archive_name, metadata,
        )
        summary = {
            "study": STUDY,
            "source": RECORD_URL,
            "officialMd5Verified": checksums,
            "dataCounts": split,
            "faceLabelCoverage": coverage,
            "modelVersion": report["modelVersion"],
            "epochsCompleted": report["epochsCompleted"],
            "bestEpoch": report["bestEpoch"],
            "bestMetrics": report["bestMetrics"],
            "unseenSingerNormalVsStrong": stratified,
            "diagnosticFlags": report["diagnosticFlags"],
            "weaknesses": [
                "RAVDESS intensity is acted emotional intensity, NOT directly measured muscle effort",
                "Different takes of the same lyric are not frame-level phoneme aligned",
                "No accurate phoneme labeling across languages",
                "Audio normalization, microphone gain and singing technique can confound loudness",
                "No production validated full face skin renderer",
            ],
            "encryptedCheckpoint": archive_name,
            "encryptedFileSha256": encrypted["encryptedFileSha256"],
            "singerRawMediaPreserved": False,
            "researchModelPreservedEncrypted": True,
            "commercialUseAllowed": False,
            "canAcceptPaidJobs": False,
        }
        vault_directory.joinpath(archive_name + ".manifest.json").write_text(
            json.dumps(summary, ensure_ascii=False, sort_keys=True, indent=2),
            encoding="utf-8",
        )
        print("SONG_V12_MATCHED_INTENSITY_RESULT=" +
              json.dumps(summary, ensure_ascii=False, sort_keys=True), flush=True)
        return summary


def main():
    parser = argparse.ArgumentParser(
        description="Study same singing sound and normal/strong facial expression")
    parser.add_argument("--acknowledge-noncommercial-research", action="store_true")
    parser.add_argument("--landmarker-task", type=Path, required=True)
    parser.add_argument("--vault-public-key", type=Path, required=True)
    parser.add_argument("--vault-output-dir", type=Path, required=True)
    parser.add_argument("--epochs", type=int, default=8)
    parser.add_argument("--min-epochs", type=int, default=4)
    parser.add_argument("--patience", type=int, default=4)
    args = parser.parse_args()
    if not args.acknowledge_noncommercial_research:
        parser.error("Licensed RAVDESS research only; acknowledge CC BY-NC-SA 4.0 first")
    run_condition_research(
        args.landmarker_task, args.vault_public_key, args.vault_output_dir,
        epochs=args.epochs, min_epochs=args.min_epochs, patience=args.patience,
    )


if __name__ == "__main__":
    main()
