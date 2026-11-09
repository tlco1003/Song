"""SONG AI v39 unified offline/private train → phone align → 3D render → QA.

This is a real executable orchestration of existing v37 learning, v38 native
MP4 render and v35 3D tongue/jaw. No synthetic fallback for private weights;
no automatic promotion of MFA sung-phone guesses to gold truth.
"""
from __future__ import annotations
import argparse
import json
import shutil
import subprocess
import sys
from datetime import datetime,timezone
from pathlib import Path

from song_v39_alignment import (AlignmentError, validate_phone_alignment,
        read_mfa_json,mfa_to_preview_timeline,verified_to_v38_syllables,write_json)
from song_v39_validator import validate_render


class PipelineError(RuntimeError):
    pass


def audio_duration(audio:Path)->float:
    p=subprocess.run(["ffprobe","-v","error","-show_entries","format=duration","-of","default=noprint_wrappers=1:nokey=1",str(audio)],capture_output=True,text=True,check=True)
    duration=float(p.stdout.strip())
    if not 1<duration<1800:raise PipelineError("Unexpected audio duration")
    return duration


def execute_mfa(audio:Path,lyrics:Path,out:Path,*,dictionary:str,model:str,
                isolated_vocals:Path|None=None)->Path:
    """Run a real installed MFA aligner on text and solo vocal stem.

    Music stems with accompaniment harm alignment; require isolated vocals.
    Korean MFA acoustic model availability must be explicitly configured.
    """
    if shutil.which("mfa") is None:
        raise PipelineError("MFA binary missing: install Korean Montreal Forced Aligner and model explicitly")
    if isolated_vocals is None or not isolated_vocals.exists():
        raise PipelineError("MFA sung-music mode requires an explicit isolated-vocal stem, not full instrumental mix")
    corpus=out/"mfa_corpus";corpus.mkdir(parents=True,exist_ok=True)
    # Need exact transcription, not arbitrary labels or a fabricated ASR result.
    shutil.copy2(isolated_vocals,corpus/"song.wav") if isolated_vocals.suffix.lower()==".wav" else _to_wav(isolated_vocals,corpus/"song.wav")
    (corpus/"song.txt").write_text(lyrics.read_text(encoding="utf-8-sig"),encoding="utf-8")
    export=out/"mfa_output";export.mkdir(parents=True,exist_ok=True)
    command=["mfa","align", "--output_format","json",str(corpus),dictionary,model,str(export),"--clean"]
    subprocess.run(command,check=True,timeout=3600)
    candidates=list(export.rglob("song.json"))
    if len(candidates)!=1:raise PipelineError("MFA did not produce exactly one aligned phone JSON output")
    return candidates[0]


def _to_wav(source:Path,dest:Path):
    subprocess.run(["ffmpeg","-nostdin","-y","-hide_banner","-loglevel","error","-i",str(source),
                    "-ac","1","-ar","16000",str(dest)],check=True)


def run_pipeline(args, *, render_callable=None, trainer_callable=None, validator_callable=validate_render)->dict:
    """Single auditable command to train optionally, align, render and validate.

    Dependencies are injectable only for CI fixture testing, not for production
    inference; passing injected functions marks the report `fixture_execution`.
    """
    from pathlib import Path
    out=Path(args.workdir).resolve()
    out.mkdir(parents=True,exist_ok=True)
    preview=bool(args.preview)
    transcript=Path(args.lyrics).read_text(encoding="utf-8-sig")
    duration=audio_duration(Path(args.audio))
    run={"schema":"SONG_AI_V39_RUN","startedUtc":datetime.now(timezone.utc).isoformat(),
         "stages":{},"researchPreview":preview,"realOwnerTongue3DLearned":False,
         "actualBoneAngle3DMeasured":False,"privateInputsRemainPrivate":True,
         "injectedFixtureFunctions":bool(render_callable is not None or trainer_callable is not None)}
    def log_stage(stage, data):
        run["stages"][stage]=data
        write_json(out/"SONG_V39_RUN_MANIFEST.json",run)
    log_stage("inputs",{"lyrics":Path(args.lyrics).name,"audio":Path(args.audio).name,
                        "durationSec":duration,"portrait":Path(args.portrait).name,
                        "sourceFilesVerified":all(Path(x).is_file() for x in (args.lyrics,args.audio,args.portrait))})
    # Optional actual new training on owner-authorized speaking video.
    if args.train_video:
        private_dir=out/"owner_private_training"
        if trainer_callable is not None:
            report=trainer_callable(Path(args.train_video),private_dir)
        else:
            from owner_v37_train_real_av import train
            report=train(Path(args.train_video),private_dir)
        if not report.get("trainedFromUserVoiceAndVideo"):
            raise PipelineError("Owner training did not produce actual observed AV model")
        weights=private_dir/"OWNER_V37_AV_MODEL_PRIVATE.npz"
        mapping=private_dir/"OWNER_V37_RIG_MAPPING.json"
        training_report=private_dir/"OWNER_V37_TRAINING_REPORT.json"
        log_stage("owner_training",{"status":"real_user_audio_video_trained",
               "featureRows":report.get("featureRows"),"verifiedPhoneLabels":report.get("verifiedPhoneLabels",0),
               "modelPath":"owner_private_training/OWNER_V37_AV_MODEL_PRIVATE.npz",
               "ownerSpecific3DTongue":False})
    else:
        weights=Path(args.weights) if args.weights else None
        mapping=Path(args.mapping) if args.mapping else None
        training_report=Path(args.training_report) if args.training_report else None
        log_stage("owner_training",{"status":"loaded_existing_real_v37_weights_if_valid",
               "retrainingPerformed":False})
    if weights is None or mapping is None or training_report is None or any(not p.is_file() for p in (weights,mapping,training_report)):
        raise PipelineError("Actual v37 owner checkpoint/mapping/training report missing; no demo model fallback")

    phone_alignment=None;phone_report=None;verified_syllable_path=None
    if args.reviewed_phones:
        phone_alignment=json.loads(Path(args.reviewed_phones).read_text(encoding="utf-8"))
        phone_report=validate_phone_alignment(phone_alignment,transcript,duration,require_verified=True)
        verified=verified_to_v38_syllables(phone_alignment,transcript,duration)
        verified_syllable_path=out/"SONG_V39_VERIFIED_SYLLABLES.json"
        write_json(verified_syllable_path,verified)
        log_stage("alignment",{"status":"human_verified_phone_intervals","details":phone_report})
    elif args.mfa_json or args.run_mfa:
        mfa_path=Path(args.mfa_json) if args.mfa_json else execute_mfa(Path(args.audio),Path(args.lyrics),out,
                  dictionary=args.mfa_dictionary,model=args.mfa_model,
                  isolated_vocals=Path(args.vocals_stem) if args.vocals_stem else None)
        candidate=read_mfa_json(mfa_path,duration=duration)
        write_json(out/"SONG_V39_MFA_RAW_PHONE_CANDIDATES.json",candidate)
        try:
            phone_alignment=mfa_to_preview_timeline(candidate,transcript,duration)
            phone_report=validate_phone_alignment(phone_alignment,transcript,duration)
            write_json(out/"SONG_V39_MFA_PROJECTED_REVIEW_REQUIRED.json",phone_alignment)
            log_stage("alignment",{"status":"mfa_candidate_not_verified","details":phone_report})
        except AlignmentError as e:
            log_stage("alignment",{"status":"mfa_candidate_not_mappable_to_exact_lyrics",
                                   "error":str(e),"reviewRequired":True})
        if not preview:
            raise PipelineError("MFA acoustic candidates require phoneme/word review before non-preview rendering")
    else:
        log_stage("alignment",{"status":"no_phone_alignment_draft_only",
                                "requiresHumanReview":True})
        if not preview:
            raise PipelineError("No reviewed phone timeline: production is blocked")
    if not preview and not phone_report.get("humanVerifiedPhonemeTiming",False):
        raise PipelineError("Non-preview run requires human-reviewed phone labels")

    output=Path(args.output).resolve()
    output.parent.mkdir(parents=True,exist_ok=True)
    if render_callable is None:
        from render_nara_v38 import create_mp4
        renderer=create_mp4
    else:renderer=render_callable
    # Pass real phoneme start/end to v38: important: no uniform syllable fallback
    # is permitted for human-verified pipeline. Candidate mode remains preview.
    kwargs={"audio_path":Path(args.audio),"lyrics_path":Path(args.lyrics),"image_path":Path(args.portrait),
            "weights_path":weights,"mapping_path":mapping,"training_report":training_report,
            "output":output,"start":float(args.start),"seconds":float(args.seconds),
            "fps":int(args.fps),"width":int(args.width),"height":int(args.height),
            "alignment_path":verified_syllable_path,"draft_preview":preview,
            "phone_alignment_path":out/"SONG_V39_MFA_PROJECTED_REVIEW_REQUIRED.json" if phone_alignment and not phone_report.get("humanVerifiedPhonemeTiming") else Path(args.reviewed_phones) if args.reviewed_phones else None}
    meta=renderer(**kwargs)
    if meta.get("mp4CreatedBySongEngine") is not True:
        raise PipelineError("Renderer did not report its actual MP4 output")
    log_stage("render",{"status":"mp4_created_by_song_v38_native_renderer",
                         "path":str(output),"metadata":meta})
    trace=output.with_suffix(".controls.json")
    report=validator_callable(output,meta,phone_report=phone_report,
                              control_trace=trace if trace.exists() else None,
                              reference_annotations=Path(args.reference_annotations) if args.reference_annotations else None)
    write_json(output.with_suffix(".qa.json"),report)
    log_stage("validation",report)
    run["status"]="completed_research_preview" if preview else "completed_with_human_phone_labels_requires_visual_review"
    run["phonemeAccuracyClaimAllowed"]=False
    run["realOwner3DTongueAccuracyMeasured"]=False
    write_json(out/"SONG_V39_RUN_MANIFEST.json",run)
    return run


def cli(argv=None):
    parser=argparse.ArgumentParser(description="SONG AI v39 real training → phone alignment → 3D render → AV validation")
    for name in ("lyrics","audio","portrait","output","workdir"):
        parser.add_argument("--"+name,required=True,type=Path)
    for name in ("weights","mapping","training-report","train-video","reviewed-phones","mfa-json",
                 "vocals-stem","reference-annotations"):
        parser.add_argument("--"+name,type=Path)
    parser.add_argument("--run-mfa",action="store_true")
    parser.add_argument("--mfa-dictionary",default="korean_mfa")
    parser.add_argument("--mfa-model",default="korean_mfa")
    parser.add_argument("--preview",action="store_true",help="Research-only; unverified timings never promoted to labels")
    parser.add_argument("--start",type=float,default=0.)
    parser.add_argument("--seconds",type=float,default=8.)
    parser.add_argument("--fps",type=int,default=24)
    parser.add_argument("--width",type=int,default=512)
    parser.add_argument("--height",type=int,default=512)
    a=parser.parse_args(argv)
    try:
        result=run_pipeline(a)
    except Exception as exc:
        wd=a.workdir;wd.mkdir(parents=True,exist_ok=True)
        write_json(wd/"SONG_V39_FAILURE.json",{"schema":"SONG_AI_V39_FAILURE","type":type(exc).__name__,
                "message":str(exc),"finishedUtc":datetime.now(timezone.utc).isoformat(),
                "mp4SuccessNotClaimed":True})
        raise
    print(json.dumps(result,ensure_ascii=False,indent=2))

if __name__=="__main__":cli()
