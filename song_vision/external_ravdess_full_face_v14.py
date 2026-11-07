"""One real singing-video research run: v13 facial motion + v14 FULL-FACE renderer.

Uses 120 matched original actor-sung RAVDESS A/V recordings. Actor 01/02
training; ACTOR 03 held out and never supplies gradients. After training,
same input vocal WAV generates full-face 96px images and a SIDE-BY-SIDE
comparison against the source's *same-time* frames. Audio stream is
bit-preserved as source PCM in an ephemeral private MKV; the preview and
source video/voice MUST NOT be uploaded to public GitHub/Artifacts.

Only encrypted model states and aggregate validation metrics are kept.
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
from .staged_face_v13 import train_staged, MODEL_VERSION as MOTION_VERSION
from .full_face_renderer_v14 import (
    train_full_face, MODEL_VERSION as RENDER_VERSION,
)
from .paired_face_audit_v14 import audit_same_audio_video

STUDY="song-v14-real-song-full-face-same-vocal-paired-comparison"


def run_v14(*, teacher: Path, public_key: Path, vault: Path,
            motion_stage_epochs=(1,1,1,1), render_epochs=1, audit_frames=30) -> dict:
    if not teacher.is_file() or not public_key.is_file():
        raise FileNotFoundError("Only local face teacher and existing owner public key allowed")
    if vault.exists() and any(vault.iterdir()):
        raise FileExistsError("Never overwrite previously archived research weights")
    if not 8 <= audit_frames <= 100 or not 1 <= render_epochs <= 12:
        raise ValueError("Unsupported research comparison settings")
    with tempfile.TemporaryDirectory(prefix="song-v14-private-raw-voice-face-") as temporary:
        root=Path(temporary)
        takes=[]
        checksums={}
        for actor in ACTORS:
            archive=root/f"RAVDESS-original-singer-{actor}.zip"
            checksums[actor]=download_official_actor_zip(actor,archive)
            takes.extend(select_condition_balanced_singing(archive,root,actor))
            archive.unlink()
        split=check_performer_and_strength_split(takes)
        manifest=make_v12_manifest(takes,root)
        prepared=root/"private-real-vocal-frame-pairs"
        prepare_manifest(manifest,prepared,save_acoustic_cues=True)
        coverage=annotate_face_surface_dataset(
            prepared,teacher,min_coverage=.80)
        motion_ckpt=root/"temporary-v13-research-geometry.pt"
        motion_report=train_staged(
            prepared,motion_ckpt,epochs_per_stage=motion_stage_epochs,
            batch_size=12,
        )
        face_ckpt=root/"temporary-v14-trained-fullface.pt"
        face_report=train_full_face(
            prepared,motion_ckpt,face_ckpt,
            epochs=render_epochs,batch_size=8,
        )
        clips=json.loads(manifest.read_text(encoding="utf-8"))["clips"]
        heldout=sorted((x for x in clips if x["split"]=="val"),
                       key=lambda x:x["id"])
        if not heldout:
            raise ValueError("Cannot audit without unseen face and original vocal")
        chosen=heldout[0]
        audit=audit_same_audio_video(
            prepared/"val"/chosen["id"],
            root/chosen["vocals"],
            motion_ckpt,face_ckpt,
            root/"NEVER_UPLOAD_ORIGINAL_PERSON_PRIVATE_AUDIT",
            max_frames=audit_frames,
        )
        run_id=os.getenv("GITHUB_RUN_ID","private-operator")
        attempt=os.getenv("GITHUB_RUN_ATTEMPT","1")
        m_name=f"song-v14-base-motion-run-{run_id}-a{attempt}.svault"
        r_name=f"song-v14-full-face-run-{run_id}-a{attempt}.svault"
        metadata_base={
            "dataset":DATASET_ID,
            "study":STUDY,
            "githubRunId":f"{run_id}-a{attempt}",
            "license":"CC-BY-NC-SA-4.0",
            "commercialUseAllowed":False,
            "checkpointCategory":"research_only_not_lipsync_validated",
            "trainActors":split["trainActors"],
            "holdoutActors":split["holdoutActors"],
            "officialMd5Checksums":checksums,
        }
        sealed_motion=seal(
            motion_ckpt,motion_ckpt.with_suffix(".report.json"),
            public_key,vault/m_name,
            {**metadata_base,"modelVersion":MOTION_VERSION})
        sealed_renderer=seal(
            face_ckpt,face_ckpt.with_suffix(".report.json"),
            public_key,vault/r_name,
            {**metadata_base,"modelVersion":RENDER_VERSION})
        summary={
            "study":STUDY,
            "source":RECORD_URL,
            "license":"CC-BY-NC-SA-4.0",
            "commercialUseAllowed":False,
            "trainHoldout":split,
            "frameLandmarkCoverage":coverage,
            "modelBaseMotionValidation":motion_report["finalValidation"],
            "fullFaceRendererValidation":face_report["bestValidation"],
            "fullFaceRendererDiagnosticFlags":face_report["diagnosticFlags"],
            "sameActualRecordedVocalAudit": {
                key:val for key,val in audit.items() if key!="heldoutClipId"
            },
            "audioCopiedUnchanged":audit["losslessMuxedAudioIdenticalToOriginalPrefix"],
            "privatePreviewDiscardedAfterAudit":True,
            "encryptedMotionCheckpoint":m_name,
            "encryptedMotionSha256":sealed_motion["encryptedFileSha256"],
            "encryptedFaceRendererCheckpoint":r_name,
            "encryptedRendererSha256":sealed_renderer["encryptedFileSha256"],
            "fullFacePhotoRealismValidated":False,
            "actualKoreanSingingTestPassed":False,
            "canAcceptPaidJobs":False,
        }
        (vault/(r_name+".manifest.json")).write_text(
            json.dumps(summary,ensure_ascii=False,indent=2,sort_keys=True),
            encoding="utf-8")
        print("SONG_V14_FULL_FACE_SAME_AUDIO_COMPARISON="+
              json.dumps(summary,ensure_ascii=False,sort_keys=True),flush=True)
        return summary


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--acknowledge-noncommercial-research",action="store_true")
    parser.add_argument("--landmarker-task",type=Path,required=True)
    parser.add_argument("--vault-public-key",type=Path,required=True)
    parser.add_argument("--vault-output-dir",type=Path,required=True)
    parser.add_argument("--render-epochs",type=int,default=1)
    parser.add_argument("--audit-frames",type=int,default=30)
    args=parser.parse_args()
    if not args.acknowledge_noncommercial_research:
        parser.error("RAVDESS CC BY-NC-SA 4.0 noncommercial study required")
    run_v14(
        teacher=args.landmarker_task,public_key=args.vault_public_key,
        vault=args.vault_output_dir,
        render_epochs=args.render_epochs,audit_frames=args.audit_frames,
    )


if __name__ == "__main__":
    main()
