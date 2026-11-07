"""Official noncommercial 120-video RAVDESS v13 4-stage research runner.

Research-only. Actor 01/02 train, Actor 03 held out. Balanced normal and
strong *portrayed emotions*, not measured muscle force or controlled SPL.
No unreviewed Hangul timestamps are fabricated for these English takes:
13-consonant/5-vowel classification heads are in place but explicitly
UNSUPERVISED until operator supplies aligned reviewed phones.

The study model is always encrypted with the existing owner-held public key
before temporary decrypted weights and source videos are disposed. Run IDs
ensure no previous research weights are overwritten.
"""
from __future__ import annotations

import argparse
import json
import os
import tempfile
from pathlib import Path

from .external_ravdess_intensity_v12 import (
    ACTORS, check_performer_and_strength_split,
    make_v12_manifest, select_condition_balanced_singing,
)
from .external_ravdess_multisinger import (
    ACTOR_MD5, DATASET_ID, RECORD_URL, download_official_actor_zip,
)
from .face_surface_motion import annotate_face_surface_dataset
from .real_training import prepare_manifest
from .research_checkpoint_vault import seal
from .staged_face_v13 import MODEL_VERSION, STAGES, train_staged

STUDY = "song-v13-four-branch-phonemes-prosody-emotion-motion-fusion"


def run_v13_research(*, local_face_task: Path, public_key: Path, vault_dir: Path,
                     epochs_per_stage: tuple[int, int, int, int] = (1, 1, 1, 1),
                     init_v11_checkpoint: Path | None = None) -> dict:
    if not local_face_task.is_file() or not public_key.is_file():
        raise FileNotFoundError("Offline face landmarker + owner-owned public key required")
    if len(epochs_per_stage) != 4 or any(not 1 <= e <= 30 for e in epochs_per_stage):
        raise ValueError("Invalid v13 research stage epochs")
    if vault_dir.exists() and any(vault_dir.iterdir()):
        raise FileExistsError("Never overwrite encrypted research model archive")
    with tempfile.TemporaryDirectory(prefix="song-v13-only-noncommercial-") as tmp:
        folder = Path(tmp)
        takes, md5s = [], {}
        for actor in ACTORS:
            source_zip = folder / f"verified-actor-{actor}.zip"
            md5s[actor] = download_official_actor_zip(actor, source_zip)
            takes.extend(select_condition_balanced_singing(source_zip, folder, actor))
            source_zip.unlink()
        source = check_performer_and_strength_split(takes)
        manifest = make_v12_manifest(takes, folder)
        prepared = folder / "actual-singer-video-and-voice-private"
        prepare_manifest(manifest, prepared, save_acoustic_cues=True)
        coverage = annotate_face_surface_dataset(
            prepared, local_face_task, min_coverage=.80)
        checkpoint = folder / "temporary-trained-v13-weights.pt"
        report = train_staged(
            prepared, checkpoint, epochs_per_stage=epochs_per_stage,
            batch_size=12, init_v11_checkpoint=init_v11_checkpoint,
        )
        run_id = os.environ.get("GITHUB_RUN_ID", "private-operator")
        attempt = os.environ.get("GITHUB_RUN_ATTEMPT", "1")
        filename = f"song-v13-four-branch-run-{run_id}-attempt-{attempt}.svault"
        vault_metadata = {
            "dataset": DATASET_ID,
            "study": STUDY,
            "modelVersion": MODEL_VERSION,
            "githubRunId": f"{run_id}-a{attempt}",
            "license": "CC-BY-NC-SA-4.0",
            "commercialUseAllowed": False,
            "checkpointCategory": "research_only_not_lipsync_validated",
            "trainActors": source["trainActors"],
            "holdoutActors": source["holdoutActors"],
            "sourceMd5": md5s,
            "trainingStages": STAGES,
            "epochsPerStage": epochs_per_stage,
            "fullySupervisedKoreanPhonemes": bool(
                report["trainReviewedConsonantSamples"] and
                report["trainReviewedVowelSamples"]),
        }
        sealed = seal(
            checkpoint, checkpoint.with_suffix(".report.json"),
            public_key, vault_dir / filename, vault_metadata)
        summary = {
            "dataset": DATASET_ID,
            "source": RECORD_URL,
            "license": "CC-BY-NC-SA-4.0",
            "commercialUseAllowed": False,
            "study": STUDY,
            "sourceOfficialMd5Verified": md5s,
            "trainHoldoutSplit": source,
            "faceSurfaceCoverage": coverage,
            "trainingStages": list(STAGES),
            "epochsPerStage": list(epochs_per_stage),
            "trainFrames": report["trainFrames"],
            "holdoutFrames": report["valFrames"],
            "trainedHumanReviewedConsonantFrames": report["trainReviewedConsonantSamples"],
            "trainedHumanReviewedVowelFrames": report["trainReviewedVowelSamples"],
            "humanReviewedPhoneSupervisionAvailable": bool(
                report["trainReviewedConsonantSamples"] and
                report["trainReviewedVowelSamples"]),
            "note": (
                "This official English acting dataset has no Korean phoneme "
                "timestamps; audio-to-face surface geometry is trained, but "
                "13/5 Korean phone classification is not claimed as trained."
            ),
            "stageBestMetrics": report["bestStageMetrics"],
            "finalValidation": report["finalValidation"],
            "diagnosticFlags": report["diagnosticFlags"],
            "encryptedCheckpoint": filename,
            "encryptedFileSha256": sealed["encryptedFileSha256"],
            "sourceRawVideoAndVocalsIncluded": False,
            "ownerPrivateKeyIncluded": False,
            "canAcceptPaidJobs": False,
            "generatesAudio": False,
            "fullFaceRendererReady": False,
        }
        with (vault_dir / (filename + ".manifest.json")).open("x", encoding="utf-8") as f:
            json.dump(summary, f, ensure_ascii=False, sort_keys=True, indent=2)
        print("SONG_V13_ACTUAL_FOUR_STAGE_RESEARCH=" +
              json.dumps(summary, ensure_ascii=False, sort_keys=True), flush=True)
        return summary


def main():
    parser = argparse.ArgumentParser(
        description="RAVDESS official singer footage four-stage face research; never audio synthesis")
    parser.add_argument("--acknowledge-noncommercial-research", action="store_true")
    parser.add_argument("--landmarker-task", type=Path, required=True)
    parser.add_argument("--vault-public-key", type=Path, required=True)
    parser.add_argument("--vault-output-dir", type=Path, required=True)
    parser.add_argument("--art-epochs", type=int, default=1)
    parser.add_argument("--prosody-epochs", type=int, default=1)
    parser.add_argument("--emotion-epochs", type=int, default=1)
    parser.add_argument("--fusion-epochs", type=int, default=1)
    parser.add_argument("--init-v11-checkpoint", type=Path)
    args = parser.parse_args()
    if not args.acknowledge_noncommercial_research:
        parser.error("RAVDESS CC BY-NC-SA 4.0 study explicitly required")
    run_v13_research(
        local_face_task=args.landmarker_task,
        public_key=args.vault_public_key,
        vault_dir=args.vault_output_dir,
        epochs_per_stage=(args.art_epochs, args.prosody_epochs,
                          args.emotion_epochs, args.fusion_epochs),
        init_v11_checkpoint=args.init_v11_checkpoint,
    )


if __name__ == "__main__":
    main()
