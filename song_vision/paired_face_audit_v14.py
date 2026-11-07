"""Real paired source video vs generated facial video, with THE SAME vocal audio.

No audio is generated. A 16kHz mono singer WAV from the same genuine recorded
performance is copied bit-for-bit as an audit sidecar. A Matroska .mkv
presentation uses -c:a copy; extracted decoded samples must match the source
prefix. Video and singer WAV/identity are only in TEMPORARY consented research
storage and NEVER sent to public Github artifacts or branches.

Per-frame comparisons use exactly the source WAV's timestamps. The generated
frame only gets source static reference + same time-aligned vocal features,
not the ground truth current video frame. Compare exact audio and time-shifted
audio (320 ms) versus recorded face on HELD-OUT performer 03.
"""
from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
from pathlib import Path

import cv2
import numpy as np
import torch

from .core import FACE_SIZE, audio_features, decode_audio, mel_window
from .vocal_acoustics import analyze_vocal_cues, cue_window
from .staged_face_v13 import StagedSingingFaceNet, MODEL_VERSION as MOTION_VERSION
from .full_face_renderer_v14 import (
    FullFaceVocalRenderer, MODEL_VERSION as RENDER_VERSION,
    dynamic_region_masks, region_mae,
)


def _read_source_checkpoint(path, expected_version):
    if not Path(path).is_file():
        raise FileNotFoundError("Operator/private study weights required")
    checkpoint=torch.load(path,map_location="cpu",weights_only=True)
    if (checkpoint.get("modelVersion")!=expected_version or
            checkpoint.get("commerciallyValidated") is not False):
        raise ValueError("Only verified research-only same-architecture weights accepted")
    return checkpoint


def audit_same_audio_video(prepared_clip: Path, raw_vocal_file: Path,
                           motion_checkpoint: Path, renderer_checkpoint: Path,
                           private_output_dir: Path, *,max_frames=70) -> dict:
    """Evaluate one actual heldout singer clip, preview only in PRIVATE directory."""
    if private_output_dir.exists():
        raise FileExistsError("Never overwrite previous private comparison")
    if not 8 <= max_frames <= 150:
        raise ValueError("Invalid preview frame count")
    index=json.loads((prepared_clip/"index.json").read_text(encoding="utf-8"))
    if index.get("split")!="val" or len(index.get("frames",[]))<16:
        raise ValueError("Only heldout real singer videos can be compared")
    if hashlib.sha256(raw_vocal_file.read_bytes()).hexdigest()!=index["sourceVocalsSha256"]:
        raise ValueError("The audio cannot differ from the real original video vocal source")
    audio=decode_audio(raw_vocal_file)
    mel=audio_features(audio)
    acoustic=analyze_vocal_cues(audio)
    if mel.shape[1]!=acoustic.shape[1]:
        raise ValueError("Auditory feature and real vocal dynamics frame clock mismatch")
    prepared_mel=np.load(prepared_clip/"mel.npy",allow_pickle=False)
    if prepared_mel.shape!=mel.shape or not np.allclose(prepared_mel,mel,rtol=1e-5,atol=1e-5):
        raise ValueError("Original singer track differs from the face-training audio")
    face_model=StagedSingingFaceNet()
    face_model.load_state_dict(
        _read_source_checkpoint(motion_checkpoint,MOTION_VERSION)["stateDict"],strict=True)
    renderer=FullFaceVocalRenderer()
    renderer.load_state_dict(
        _read_source_checkpoint(renderer_checkpoint,RENDER_VERSION)["stateDict"],strict=True)
    face_model.eval()
    renderer.eval()
    frames=index["frames"][:max_frames]
    reference=cv2.imread(str(prepared_clip/"frames"/frames[0]["file"]))
    if reference is None or reference.shape!=(FACE_SIZE,FACE_SIZE,3):
        raise FileNotFoundError("Actual recorded reference face is absent")
    src=torch.from_numpy(
        reference.transpose(2,0,1).copy()
    ).float().unsqueeze(0)/255.
    region,zones=dynamic_region_masks()
    # 0 is an identity/reference frame, excluded from all fit metrics.
    numbers={"frameCount":0,"actualAudioROIMAE":0.,"shiftedAudioROIMAE":0.,
             "staticReferenceROIMAE":0.,"lipMAE":0.,"cheeksMAE":0.,
             "eyesBrowMAE":0.,"sameVocalVisualSensitivity":0.}
    images=[]
    with torch.no_grad():
        for i,row in enumerate(frames):
            time=float(row["seconds"])
            target=cv2.imread(str(prepared_clip/"frames"/row["file"]))
            if target is None or target.shape!=(FACE_SIZE,FACE_SIZE,3):
                raise FileNotFoundError("Heldout source video frame missing")
            true=torch.from_numpy(
                target.transpose(2,0,1).copy()
            ).float().unsqueeze(0)/255.
            am=torch.from_numpy(mel_window(mel,time)).unsqueeze(0)
            ac=torch.from_numpy(cue_window(acoustic,time)).unsqueeze(0)
            # Same source track, intentionally wrong time (+320ms)
            mismatch_time=(time+.320) % (len(audio)/16000.)
            wm=torch.from_numpy(mel_window(mel,mismatch_time)).unsqueeze(0)
            wc=torch.from_numpy(cue_window(acoustic,mismatch_time)).unsqueeze(0)
            fit=face_model(src,am,ac,stage="fusion")
            generated=renderer(src,am,ac,fit["motion"],fit["projectedIrisMotion"])
            wrong_fit=face_model(src,wm,wc,stage="fusion")
            wrong=renderer(src,wm,wc,wrong_fit["motion"],
                           wrong_fit["projectedIrisMotion"])
            if i>0:
                n=1
                numbers["frameCount"]+=n
                numbers["actualAudioROIMAE"]+=float(region_mae(generated,true,region))
                numbers["shiftedAudioROIMAE"]+=float(region_mae(wrong,true,region))
                numbers["staticReferenceROIMAE"]+=float(region_mae(src,true,region))
                numbers["lipMAE"]+=float(region_mae(generated,true,zones[2:3]))
                numbers["cheeksMAE"]+=float(region_mae(generated,true,zones[1:2]))
                numbers["eyesBrowMAE"]+=float(region_mae(generated,true,zones[0:1]))
                numbers["sameVocalVisualSensitivity"]+=float(region_mae(generated,wrong,region))
            # Private visual review side-by-side, never uploaded to public GitHub
            full=(generated[0].permute(1,2,0).clamp(0,1).numpy()*255).astype(np.uint8)
            gen_bgr=full  # SONG tensor_patch and trained decoder use BGR channel order
            pair=np.concatenate((target,gen_bgr),axis=1)
            pair=cv2.resize(pair,(384,192),interpolation=cv2.INTER_NEAREST)
            cv2.putText(pair,"RECORDED",(5,19),cv2.FONT_HERSHEY_SIMPLEX,
                        .48,(255,255,255),1,cv2.LINE_AA)
            cv2.putText(pair,"SONG V14",(202,19),cv2.FONT_HERSHEY_SIMPLEX,
                        .48,(255,255,255),1,cv2.LINE_AA)
            images.append(pair)
    if numbers["frameCount"]<7:
        raise ValueError("Cannot score too few source/generation frames")
    count=numbers["frameCount"]
    stats={k:round(v/count,7) if k!="frameCount" else v for k,v in numbers.items()}
    stats["correctMinusWrongAlignmentGain"]=round(
        stats["shiftedAudioROIMAE"]-stats["actualAudioROIMAE"],7)
    stats["copyReferenceImprovement"]=round(
        stats["staticReferenceROIMAE"]-stats["actualAudioROIMAE"],7)
    private_output_dir.mkdir(parents=True)
    silent=private_output_dir/"visual-compare-silent.mp4"
    codec=cv2.VideoWriter_fourcc(*"mp4v")
    writer=cv2.VideoWriter(str(silent),codec,25,(384,192))
    if not writer.isOpened():
        raise OSError("Could not create comparison preview")
    for frame in images:
        writer.write(frame)
    writer.release()
    # Unmodified raw original singer WAV retained as exact companion file.
    audio_copy=private_output_dir/"source-vocals-original.wav"
    shutil.copyfile(raw_vocal_file,audio_copy)
    if hashlib.sha256(audio_copy.read_bytes()).digest()!=hashlib.sha256(
            raw_vocal_file.read_bytes()).digest():
        raise ValueError("Original recorded voice samples changed during comparison")
    # Mux with STREAM COPY of same source's PCM; no synthesis/voice alteration.
    mux=private_output_dir/"side-by-side-with-original-vocal.mkv"
    subprocess.run(
        ["ffmpeg","-nostdin","-hide_banner","-loglevel","error","-y",
         "-i",str(silent),"-i",str(raw_vocal_file),
         "-map","0:v:0","-map","1:a:0","-c:v","copy","-c:a","copy",
         "-shortest",str(mux)],
        capture_output=True,check=True,
    )
    extracted=subprocess.run(
        ["ffmpeg","-nostdin","-hide_banner","-loglevel","error",
         "-i",str(mux),"-vn","-ac","1","-ar","16000",
         "-f","s16le","-"],
        capture_output=True,check=True,
    ).stdout
    original_pcm=(audio.clip(-1,1)*32768).round().astype("<i2").tobytes()
    # decode_audio WAV uses 16-bit normalization, so this is exact integer PCM.
    sound_exact=(len(extracted)>0 and len(extracted)<=len(original_pcm) and
                 original_pcm[:len(extracted)]==extracted)
    if not sound_exact:
        raise ValueError("Audio in visual comparison no longer matches source")
    report={
        "status":"actual_heldout_same_original_sound_vs_video_audit",
        "sourceVocalSha256":index["sourceVocalsSha256"],
        "sourceAudioIdenticalByteForByteInSidecar":True,
        "losslessMuxedAudioIdenticalToOriginalPrefix":sound_exact,
        "audioSamplesCopiedToVideo":len(extracted)//2,
        "sourceDurationSeconds":len(audio)/16000.,
        "videoComparedFrames":len(images),
        "recordedAndGeneratedSameTimeSeconds":True,
        "heldoutClipId":index["clipId"],
        "metrics":stats,
        "passedVsStaticCopy":stats["copyReferenceImprovement"]>0.,
        "passedCorrectVsTimeShifted":stats["correctMinusWrongAlignmentGain"]>.0001,
        "photorealisticVideoValidated":False,
        "sourceMediaOrPreviewPublished":False,
        "commercialUseAllowed":False,
    }
    (private_output_dir/"research-compare.report.json").write_text(
        json.dumps(report,ensure_ascii=False,indent=2),encoding="utf-8")
    print("SONG_V14_SAME_ORIGINAL_AUDIO_FACE_AUDIT="+json.dumps({
        k:v for k,v in report.items() if k not in ("heldoutClipId",)
    },ensure_ascii=False,sort_keys=True),flush=True)
    return report
