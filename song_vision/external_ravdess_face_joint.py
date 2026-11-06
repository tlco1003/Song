"""Research-only multi-performer training with visible cheek/chin/lip labels.

Uses original licensed RAVDESS A/V takes; pretrained Google MediaPipe is
ONLY a frozen teacher for *surface* landmark and expression targets.
SONG trains the joint audio -> surface-motion + mouth-image network.

No checkpoint or face crop is published unencrypted. Reuses existing owner
X25519 PUBLIC key; the PRIVATE key never enters GitHub Actions.
"""
from __future__ import annotations

import argparse
import json
import os
import tempfile
from pathlib import Path

from .external_ravdess_multisinger import (
    ACTOR_MD5, RECORD_URL, DATASET_ID, check_singer_disjoint,
    download_official_actor_zip, extract_research_takes, make_research_manifest,
)
from .face_surface_motion import annotate_face_surface_dataset
from .joint_face_training import train_joint
from .real_training import prepare_manifest
from .research_checkpoint_vault import seal

MODEL_STUDY = "RAVDESS-Actors-01-02-03"
STUDY_KIND = "visible_cheek_chin_lip_motion_joint_research_v9"


def run_surface_joint_research(vault_public_key: Path, vault_dir: Path,
                               landmarker_task: Path, epochs: int = 12,
                               min_epochs: int = 6, patience: int = 5,
                               init_checkpoint: Path | None = None):
    if not 6 <= epochs <= 40 or not 1 <= min_epochs <= epochs or not 0 <= patience <= epochs:
        raise ValueError("Invalid face research epochs and patience")
    if not vault_public_key.is_file() or not landmarker_task.is_file():
        raise FileNotFoundError("Existing owner public key and verified local face task required")
    if vault_dir.exists() and any(vault_dir.iterdir()):
        raise FileExistsError("Never overwrite a previous encrypted study")
    if init_checkpoint is not None and not init_checkpoint.is_file():
        raise FileNotFoundError("Warm-start must use privately restored owner research weights")
    with tempfile.TemporaryDirectory(prefix="song-research-joint-licensed-") as td:
        root = Path(td)
        takes, checksums = [], {}
        for actor in sorted(ACTOR_MD5):
            archive = root / f"original-{actor}.zip"
            checksums[actor] = download_official_actor_zip(actor, archive)
            takes.extend(extract_research_takes(archive, root, actor))
            archive.unlink()
        split = check_singer_disjoint(takes)
        manifest = make_research_manifest(takes, root)
        dataset = root / "private-face-surfaces"
        prepared = prepare_manifest(manifest, dataset)
        # Fail closed if the frozen surface detector cannot label each signer.
        label_counts = annotate_face_surface_dataset(
            dataset, landmarker_task, min_coverage=.80)
        checkpoint = root / "new-joint-surface-research.pt"
        report = train_joint(
            dataset, checkpoint, epochs=epochs, min_epochs=min_epochs,
            patience=patience, batch_size=12, init_checkpoint=init_checkpoint)
        run_id = os.getenv("GITHUB_RUN_ID", "operator-research")
        attempt = os.getenv("GITHUB_RUN_ATTEMPT", "1")
        encrypted_name = f"song-joint-face-run-{run_id}-attempt-{attempt}.svault"
        metadata = {
            "dataset": DATASET_ID,
            "study": STUDY_KIND,
            "modelVersion": report["modelVersion"],
            "githubRunId": f"{run_id}-attempt-{attempt}",
            "license": "CC-BY-NC-SA-4.0",
            "commercialUseAllowed": False,
            "checkpointCategory": "research_only_not_lipsync_validated",
            "trainActors": split["trainActors"],
            "holdoutActors": split["holdoutActors"],
            "frozenTeacher": "MediaPipe Face Landmarker estimated skin surface",
            "sourceMD5": checksums,
            "labelCoverage": label_counts,
            "bestEpoch": report["bestEpoch"],
            "warmStartedFromPriorMouthWeights": report["warmStartedFromPriorMouthWeights"],
        }
        sealed = seal(
            checkpoint, checkpoint.with_suffix(".report.json"),
            vault_public_key, vault_dir / encrypted_name, metadata,
        )
        manifest_path = vault_dir / (encrypted_name + ".manifest.json")
        manifest_path.write_text(json.dumps({
            "modelStudy": STUDY_KIND,
            "dataset": DATASET_ID,
            "license": "CC-BY-NC-SA-4.0",
            "commercialUseAllowed": False,
            "trainActors": split["trainActors"],
            "unseenValActors": split["holdoutActors"],
            "trainClips": split["trainRecordings"],
            "valClips": split["holdoutRecordings"],
            "labelCounts": label_counts,
            "trainFrames": report["trainFrames"],
            "valFrames": report["valFrames"],
            "epochsCompleted": report["completedEpochs"],
            "bestEpoch": report["bestEpoch"],
            "bestMetrics": report["bestMetrics"],
            "diagnosticFlags": report["diagnosticFlags"],
            "encryptedFilename": encrypted_name,
            "encryptedSha256": sealed["encryptedFileSha256"],
            "ownerHeldPrivateKeyRequired": True,
            "rawVideoAudioOrBiometricsIncluded": False,
            "qualityValidatedForCommercialUse": False,
        }, indent=2, sort_keys=True), encoding="utf-8")
        result = {
            "trainingResult": "finished_research_optimizer_run",
            "dataset": DATASET_ID,
            "trainActors": split["trainActors"],
            "unseenValidationActors": split["holdoutActors"],
            "sourceChecksumsVerified": checksums,
            "labelCoverage": label_counts,
            "bestEpoch": report["bestEpoch"],
            "completedEpochs": report["completedEpochs"],
            "bestMetrics": report["bestMetrics"],
            "qualityFlags": report["diagnosticFlags"],
            "warmStartedFromPriorWeights": report["warmStartedFromPriorMouthWeights"],
            "encryptedCheckpoint": encrypted_name,
            "encryptedSha256": sealed["encryptedFileSha256"],
            "bonelikeMeasurementsAvailable": False,
            "commercialModelReady": False,
            "rawMediaPreserved": False,
        }
        print("SONG_FACE_SURFACE_JOINT_RESULT=" +
              json.dumps(result, ensure_ascii=False, sort_keys=True), flush=True)
        return result


def main():
    parser = argparse.ArgumentParser(description="Joint lip+jaw+cheek research from real singer video")
    parser.add_argument("--acknowledge-noncommercial-research", action="store_true")
    parser.add_argument("--landmarker-task", type=Path, required=True)
    parser.add_argument("--vault-public-key", type=Path, required=True)
    parser.add_argument("--vault-output-dir", type=Path, required=True)
    parser.add_argument("--init-checkpoint", type=Path,
                        help="Optional owner-restored old mouth v2 model; not provided to CI")
    parser.add_argument("--epochs", type=int, default=12)
    parser.add_argument("--min-epochs", type=int, default=6)
    parser.add_argument("--patience", type=int, default=5)
    args = parser.parse_args()
    if not args.acknowledge_noncommercial_research:
        parser.error("RAVDESS research only; explicit CC BY-NC-SA acknowledgment required")
    run_surface_joint_research(
        vault_public_key=args.vault_public_key, vault_dir=args.vault_output_dir,
        landmarker_task=args.landmarker_task,
        epochs=args.epochs, min_epochs=args.min_epochs, patience=args.patience,
        init_checkpoint=args.init_checkpoint)


if __name__ == "__main__":
    main()
