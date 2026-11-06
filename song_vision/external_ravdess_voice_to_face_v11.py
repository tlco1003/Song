"""Full real-actor AUDIO -> FACE v11 research runner (NOT sound generation).

Uses synchronized official RAVDESS singing A/V short takes with noncommercial
license. Takes from actors 01/02 are train, actor 03 completely held out.
Weights are AES-GCM encrypted for the existing owner-held private key and
written to a separate study folder; no raw face/voice enters public GitHub.

Do not call this phoneme-recognition validation: there are no phoneme labels.
"""
from __future__ import annotations

import argparse
import json
import os
import tempfile
from pathlib import Path

from .external_ravdess_multisinger import (
    ACTOR_MD5, DATASET_ID, RECORD_URL,
    check_singer_disjoint, download_official_actor_zip,
    extract_research_takes, make_research_manifest,
)
from .face_surface_motion import annotate_face_surface_dataset
from .real_training import prepare_manifest
from .research_checkpoint_vault import seal
from .voice_to_face_v11 import train_voice_to_face
from .vocal_acoustics import CUE_NAMES, CUE_VERSION

RESEARCH_KIND = "song-pronunciation-intensity-to-visible-face-v11"


def run_v11(*, face_task: Path, vault_public_key: Path, vault_output_dir: Path,
            epochs: int = 8, min_epochs: int = 4, patience: int = 4,
            prior_mouth_checkpoint: Path | None = None) -> dict:
    if not (1 <= epochs <= 40 and 1 <= min_epochs <= epochs and 0 <= patience <= 40):
        raise ValueError("Invalid vocal-to-face study epochs")
    if not face_task.is_file() or not vault_public_key.is_file():
        raise FileNotFoundError("Official local face teacher + owner vault public key required")
    if prior_mouth_checkpoint is not None and not prior_mouth_checkpoint.is_file():
        raise FileNotFoundError("Existing owner-restored research weights required")
    if vault_output_dir.exists() and any(vault_output_dir.iterdir()):
        raise FileExistsError("Do not overwrite an existing encrypted model")
    with tempfile.TemporaryDirectory(prefix="song-voice-to-face-v11-private-") as temp:
        root = Path(temp)
        checksums, takes = {}, []
        for actor in sorted(ACTOR_MD5):
            archive = root / f"official-singer-{actor}.zip"
            checksums[actor] = download_official_actor_zip(actor, archive)
            takes.extend(extract_research_takes(archive, root, actor))
            archive.unlink()
        split = check_singer_disjoint(takes)
        manifest = make_research_manifest(takes, root)
        prepared = root / "frame-singer-audio-dynamics-private"
        prepare_manifest(manifest, prepared, save_acoustic_cues=True)
        coverage = annotate_face_surface_dataset(
            prepared, face_task, min_coverage=.80,
        )
        checkpoint = root / "temporary-v11-research-only.pt"
        report = train_voice_to_face(
            prepared, checkpoint, epochs=epochs, min_epochs=min_epochs,
            patience=patience, batch_size=12,
            init_checkpoint=prior_mouth_checkpoint,
        )
        run_id = os.environ.get("GITHUB_RUN_ID", "local-study")
        attempt = os.environ.get("GITHUB_RUN_ATTEMPT", "1")
        archive_name = f"song-voice-to-face-v11-run-{run_id}-attempt-{attempt}.svault"
        metadata = {
            "dataset": DATASET_ID,
            "study": RESEARCH_KIND,
            "modelVersion": report["modelVersion"],
            "githubRunId": f"{run_id}-a{attempt}",
            "license": "CC-BY-NC-SA-4.0",
            "commercialUseAllowed": False,
            "checkpointCategory": "research_only_not_lipsync_validated",
            "trainActors": split["trainActors"],
            "unseenActors": split["holdoutActors"],
            "bestEpoch": report["bestEpoch"],
            "sourceMd5": checksums,
            "acousticCueNames": list(CUE_NAMES),
            "acousticCueSchema": CUE_VERSION,
            "faceLabels": coverage,
            "voiceGeneration": False,
        }
        encrypted = seal(
            checkpoint, checkpoint.with_suffix(".report.json"),
            vault_public_key, vault_output_dir / archive_name, metadata,
        )
        summary = {
            "study": RESEARCH_KIND,
            "source": RECORD_URL,
            "sourceMd5Verified": checksums,
            "trainActors": split["trainActors"],
            "unseenValidationActors": split["holdoutActors"],
            "trainRecordings": split["trainRecordings"],
            "validationRecordings": split["holdoutRecordings"],
            "preparedFaceLabels": coverage,
            "trainAudioFaceSamples": report["trainFrames"],
            "validationAudioFaceSamples": report["valFrames"],
            "acousticCueNames": list(CUE_NAMES),
            "epochsCompleted": report["epochsCompleted"],
            "bestEpoch": report["bestEpoch"],
            "bestMetrics": report["bestMetrics"],
            "diagnosticFlags": report["diagnosticFlags"],
            "generatesAudio": False,
            "lipSyncQualityValidated": False,
            "encryptedFilename": archive_name,
            "encryptedSha256": encrypted["encryptedFileSha256"],
            "rawSingerVideoVocalNotPublic": True,
            "license": "CC-BY-NC-SA-4.0",
            "commercialUseAllowed": False,
            "canAcceptPaidJobs": False,
        }
        (vault_output_dir / (archive_name + ".manifest.json")).write_text(
            json.dumps(summary, ensure_ascii=False, indent=2, sort_keys=True),
            encoding="utf-8",
        )
        print("SONG_V11_REAL_VOICE_TO_FACE_RESULT=" +
              json.dumps(summary, ensure_ascii=False, sort_keys=True), flush=True)
        return summary


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Research: recorded singing pronunciation/prosody -> face, never generate speech")
    parser.add_argument("--acknowledge-noncommercial-research", action="store_true")
    parser.add_argument("--landmarker-task", type=Path, required=True)
    parser.add_argument("--vault-public-key", type=Path, required=True)
    parser.add_argument("--vault-output-dir", type=Path, required=True)
    parser.add_argument("--epochs", type=int, default=8)
    parser.add_argument("--min-epochs", type=int, default=4)
    parser.add_argument("--patience", type=int, default=4)
    parser.add_argument("--init-checkpoint", type=Path)
    args = parser.parse_args()
    if not args.acknowledge_noncommercial_research:
        parser.error("RAVDESS CC BY-NC-SA noncommercial research acknowledgement required")
    run_v11(
        face_task=args.landmarker_task,
        vault_public_key=args.vault_public_key,
        vault_output_dir=args.vault_output_dir,
        epochs=args.epochs, min_epochs=args.min_epochs,
        patience=args.patience,
        prior_mouth_checkpoint=args.init_checkpoint,
    )
