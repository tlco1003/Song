"""SONG v10: real 3-singer A/V + eye/cheek/jaw/perioral articulation study.

Licensed short actor-sung phrases. Train actors 01, 02; no images or
audio of holdout actor 03 are used for gradient updates. Facial pseudo-labels
come from the pinned offline Face Landmarker. This is noncommercial research,
not an identity morphing or speech acoustics generation service.

The checkpoint and full metrics are encrypted with the owner-held public key
and saved immutably, not discarded. The private key is NEVER in this workflow.
"""
from __future__ import annotations

import argparse
import json
import os
import tempfile
from pathlib import Path

from .external_ravdess_multisinger import (
    ACTOR_MD5, DATASET_ID, RECORD_URL, check_singer_disjoint,
    download_official_actor_zip, extract_research_takes, make_research_manifest,
)
from .face_surface_motion import annotate_face_surface_dataset, EXPRESSION_EXTRAS
from .facial_articulation_v10 import train_articulation
from .real_training import prepare_manifest
from .research_checkpoint_vault import seal

RESEARCH_KIND = "multisignal_eyes_cheeks_jaw_perioral_temporal_voice_v10"


def run_v10(vault_public_key: Path, vault_output_dir: Path,
            face_task: Path, *, epochs: int = 8,
            min_epochs: int = 4, patience: int = 4,
            init_checkpoint: Path | None = None) -> dict:
    if not 1 <= epochs <= 30 or not 1 <= min_epochs <= epochs or not 0 <= patience <= 30:
        raise ValueError("Unsupported noncommercial research epoch configuration")
    if not vault_public_key.is_file() or not face_task.is_file():
        raise FileNotFoundError("Validated local face task + existing owner public key required")
    if init_checkpoint is not None and not init_checkpoint.is_file():
        raise FileNotFoundError("Restored v2 research weights must be private and local")
    if vault_output_dir.exists() and any(vault_output_dir.iterdir()):
        raise FileExistsError("Never overwrite a previous encrypted research model")
    with tempfile.TemporaryDirectory(prefix="song-v10-research-ravdess-") as tmp:
        root = Path(tmp)
        takes, checksums = [], {}
        for actor in sorted(ACTOR_MD5):
            archive = root / f"verified-singer-{actor}.zip"
            checksums[actor] = download_official_actor_zip(actor, archive)
            takes.extend(extract_research_takes(archive, root, actor))
            archive.unlink()
        split = check_singer_disjoint(takes)
        manifest = make_research_manifest(takes, root)
        prepared = root / "local-faces-and-audio"
        prepare_manifest(manifest, prepared)
        # Face labels use actual observed frames. Reject unreliable detections.
        coverage = annotate_face_surface_dataset(prepared, face_task, min_coverage=.80)
        checkpoint = root / "temporary-unencrypted-v10-research.pt"
        report = train_articulation(
            prepared, checkpoint, epochs=epochs,
            min_epochs=min_epochs, patience=patience,
            batch_size=12, init_checkpoint=init_checkpoint,
        )
        run_id = os.getenv("GITHUB_RUN_ID", "operator-study")
        attempt = os.getenv("GITHUB_RUN_ATTEMPT", "1")
        name = f"song-face-articulation-v10-run-{run_id}-a{attempt}.svault"
        metadata = {
            "dataset": DATASET_ID,
            "study": RESEARCH_KIND,
            "modelVersion": report["modelVersion"],
            "githubRunId": f"{run_id}-a{attempt}",
            "license": "CC-BY-NC-SA-4.0",
            "commercialUseAllowed": False,
            "checkpointCategory": "research_only_not_lipsync_validated",
            "trainActors": split["trainActors"],
            "holdoutActors": split["holdoutActors"],
            "verifiedOfficialSourceMd5": checksums,
            "faceExpressionNames": list(EXPRESSION_EXTRAS),
            "faceLabelCoverage": coverage,
            "bestEpoch": report["bestEpoch"],
            "warmStartPriorMouthV2": report["warmStartedFromOldMouth"],
            "facialFeatureKind": "Visible estimated surface geometry, NOT measured muscle activity",
        }
        encrypted = seal(checkpoint, checkpoint.with_suffix(".report.json"),
                         vault_public_key, vault_output_dir / name, metadata)
        summary = {
            "study": RESEARCH_KIND,
            "runId": str(run_id),
            "source": RECORD_URL,
            "sourceMd5Verified": checksums,
            "trainActors": split["trainActors"],
            "unseenValidationActors": split["holdoutActors"],
            "trainClips": split["trainRecordings"],
            "valClips": split["holdoutRecordings"],
            "featureCount": len(report["bestMetrics"]),
            "expressionCategoryCount": len(EXPRESSION_EXTRAS),
            "labelCounts": coverage,
            "trainSamples": report["trainFrames"],
            "valSamples": report["valFrames"],
            "epochsCompleted": report["completedEpochs"],
            "bestEpoch": report["bestEpoch"],
            "bestMetrics": report["bestMetrics"],
            "diagnosticFlags": report["diagnosticFlags"],
            "encryptedCheckpoint": name,
            "encryptedFileSha256": encrypted["encryptedFileSha256"],
            "encryptedResearchModelRetained": True,
            "privateKeyIncluded": False,
            "sourceSingerMediaIncluded": False,
            "commercialUseAllowed": False,
            "customerJobReady": False,
        }
        vault_output_dir.joinpath(name + ".manifest.json").write_text(
            json.dumps(summary, ensure_ascii=False, indent=2, sort_keys=True),
            encoding="utf-8",
        )
        print("SONG_V10_REAL_FACE_ARTICULATION_RESULT=" +
              json.dumps(summary, ensure_ascii=False, sort_keys=True), flush=True)
        return summary


def main():
    parser=argparse.ArgumentParser(description="Local v10 singing face and acoustics study")
    parser.add_argument("--acknowledge-noncommercial-research", action="store_true")
    parser.add_argument("--vault-public-key", type=Path, required=True)
    parser.add_argument("--vault-output-dir", type=Path, required=True)
    parser.add_argument("--landmarker-task", type=Path, required=True)
    parser.add_argument("--init-checkpoint", type=Path,
                        help="Optional private restored v2 mouth checkpoint; not CI default")
    parser.add_argument("--epochs", type=int, default=8)
    parser.add_argument("--min-epochs", type=int, default=4)
    parser.add_argument("--patience", type=int, default=4)
    args=parser.parse_args()
    if not args.acknowledge_noncommercial_research:
        parser.error("CC BY-NC-SA 4.0 RAVDESS training is noncommercial research only")
    run_v10(args.vault_public_key,args.vault_output_dir,args.landmarker_task,
            epochs=args.epochs,min_epochs=args.min_epochs,patience=args.patience,
            init_checkpoint=args.init_checkpoint)


if __name__=="__main__":
    main()
