"""SONG AI v39: measurable MP4 delivery, phoneme and face safety gates.

A music-driven generated lip signal cannot by itself prove real phoneme sync.
Record exact QA measurements and set 'not_measured' for absent human ground truth.
"""
from __future__ import annotations
import json
import math
import subprocess
from pathlib import Path
import cv2
import numpy as np


class VideoValidationError(RuntimeError):
    pass


def ffprobe(path: Path) -> dict:
    if not path.is_file() or path.stat().st_size<3000:
        raise VideoValidationError("Missing or tiny MP4")
    cmd=["ffprobe","-v","error","-show_streams","-show_format","-of","json",str(path)]
    p=subprocess.run(cmd,check=True,capture_output=True,text=True)
    return json.loads(p.stdout)


def measure_motion(path: Path, max_sampled_frames=160) -> dict:
    cap=cv2.VideoCapture(str(path))
    try:
        n=int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        if n<2:raise VideoValidationError("No video frame progression")
        stride=max(1,int(math.ceil(n/max_sampled_frames)))
        mouth=[]; upper=[];corner=[]
        previous=None
        samples=0
        for i in range(0,n,stride):
            cap.set(cv2.CAP_PROP_POS_FRAMES,i)
            ok,frame=cap.read()
            if not ok:continue
            if frame.ndim!=3:raise VideoValidationError("Unexpected video frame structure")
            h,w=frame.shape[:2]
            crop=cv2.cvtColor(frame,cv2.COLOR_BGR2GRAY)
            crop=cv2.resize(crop,(256,256),interpolation=cv2.INTER_AREA)
            if previous is not None:
                delta=np.abs(crop.astype(np.int16)-previous.astype(np.int16)).astype(float)
                # ROI is deliberately broad because the input photograph may be
                # reframed; it is a generic activity proxy not a mouth landmark.
                mouth.append(float(np.mean(delta[148:234,56:201])))
                upper.append(float(np.mean(delta[15:95,56:201])))
                corner.append(float(np.mean(delta[:45,:45])))
            previous=crop
            samples+=1
        if samples<2:raise VideoValidationError("Insufficient decodable MP4 frames")
        return {"sampledFrames":samples,"mouthRegionTemporalMAE255":round(float(np.mean(mouth)),5),
                "upperFaceTemporalMAE255":round(float(np.mean(upper)),5),
                "backgroundCornerTemporalMAE255":round(float(np.mean(corner)),5),
                "motionIsObserved":bool(np.mean(mouth)>.03),
                "mouthROIIsTrueLandmark":False}
    finally:
        cap.release()


def _ratio(stream:dict) -> float:
    raw=stream.get("avg_frame_rate","0/1")
    try:
        a,b=raw.split("/")
        return float(a)/float(b)
    except (ZeroDivisionError,ValueError):
        return 0.


def compare_reviewed_controls_to_annotations(control_trace:Path|None, annotations:Path|None) -> dict:
    """Compare a renderer's jaw/lip controls to independently annotated truth.

    Annotations are not automatically extracted from rendered video because
    that would be a circular validation. Jaw controls are a normalized proxy,
    and cannot be compared to true TMJ millimeters without calibration.
    """
    if annotations is None:
        return {"status":"not_measured","reason":"No independent human-reviewed ground truth for this exact song/performance"}
    if control_trace is None or not control_trace.exists():
        raise VideoValidationError("Annotations supplied but renderer control trace unavailable")
    obj=json.loads(annotations.read_text(encoding="utf-8"))
    if obj.get("schema")!="SONG_AI_OWNER_LIP_JAW_ANNOTATIONS_V39" or obj.get("source")!="human_reviewed":
        raise VideoValidationError("Annotations are not independently reviewed")
    units=obj.get("units")
    if units!="normalized_controller_proxy":
        raise VideoValidationError("Only comparable normalized controller-proxy ground truth is supported; not real TMJ angle")
    samples=obj.get("samples",[])
    if len(samples)<5:
        raise VideoValidationError("Too few independent labeled observations")
    trace=json.loads(control_trace.read_text(encoding="utf-8"))
    if len(trace)<3:raise VideoValidationError("Control trace is incomplete")
    stamps=np.array([float(r["second"]) for r in trace])
    jaws=np.array([float(r["jawProxyRad"]) for r in trace])
    opens=np.array([float(r["mouthOpening"]) for r in trace])
    tt=[];truejaw=[];trueopen=[]
    for row in samples:
        t=float(row["second"])
        if not stamps[0]<=t<=stamps[-1]:continue
        if not all(math.isfinite(float(row[k])) for k in ("second","jawProxyRad","mouthOpening")):
            raise VideoValidationError("Nonfinite manual annotation")
        tt.append(t);truejaw.append(float(row["jawProxyRad"]));trueopen.append(float(row["mouthOpening"]))
    if len(tt)<5:raise VideoValidationError("Few independent samples overlap rendered clip")
    predicted_jaw=np.interp(tt,stamps,jaws);predicted_open=np.interp(tt,stamps,opens)
    return {"status":"measured_normalized_proxy_only","n":len(tt),
            "jawControlMAE_radProxy":round(float(np.mean(np.abs(predicted_jaw-truejaw))),5),
            "mouthControlMAE_normalized":round(float(np.mean(np.abs(predicted_open-trueopen))),5),
            "realJawBoneAngleErrorMeasured":False,
            "personSpecificTongue3DValidated":False}


def validate_render(output:Path, expected:dict, *, phone_report:dict|None=None,
                    control_trace:Path|None=None, reference_annotations:Path|None=None) -> dict:
    m=ffprobe(output)
    streams=m.get("streams",[])
    kinds={s.get("codec_type") for s in streams}
    if kinds!={"video","audio"} and not {"video","audio"}.issubset(kinds):
        raise VideoValidationError("Encoded MP4 must have video and real audio")
    v=next(s for s in streams if s.get("codec_type")=="video")
    a=next(s for s in streams if s.get("codec_type")=="audio")
    expected_duration=float(expected["seconds"])
    container_duration=float(m.get("format",{}).get("duration",0))
    if abs(container_duration-expected_duration)>.32:
        raise VideoValidationError("Output AV duration outside 320ms tolerance")
    expected_fps=float(expected["fps"])
    if abs(_ratio(v)-expected_fps)>.3:
        raise VideoValidationError("Output FPS differs from engine contract")
    if int(v.get("width",0))!=int(expected["videoWidth"]) or int(v.get("height",0))!=int(expected["videoHeight"]):
        raise VideoValidationError("Unexpected video frame dimensions")
    if v.get("codec_name")!="h264":
        raise VideoValidationError("Expected H264 MP4 video")
    if a.get("codec_name") not in ("aac", "mp3"):
        raise VideoValidationError("Unexpected delivered audio codec")
    n=int(v.get("nb_frames",expected["frameCount"]))
    if abs(n-int(expected["frameCount"]))>2:
        raise VideoValidationError("Encoded frame count disagrees with renderer")
    motion=measure_motion(output)
    if not motion["motionIsObserved"]:
        raise VideoValidationError("Output face appears motionless")
    if expected.get("ownerRealAudioToVisibleFaceWeightsUsed") is not True:
        raise VideoValidationError("Owner trained model provenance missing")
    if expected.get("hidden3DTongueMeshEvaluatedEveryFrame") is not True:
        raise VideoValidationError("3D tongue mesh provenance missing")
    reviewed=bool(phone_report and phone_report.get("humanVerifiedPhonemeTiming"))
    independent=compare_reviewed_controls_to_annotations(control_trace,reference_annotations)
    # No claim of phoneme accuracy from checking one's own synthesized animation.
    return {"schema":"SONG_AI_V39_AUDIT","passEncoding":True,
            "hasVideoAndAudio":True,"durationSec":round(container_duration,4),
            "fps":_ratio(v),"frames":n,
            "videoCodec":v.get("codec_name"),"audioCodec":a.get("codec_name"),
            "motionMetrics":motion,
            "phoneTimingSource":phone_report.get("source") if phone_report else "draft_unaligned",
            "phoneTimingHumanReviewed":reviewed,
            "generatedVideoLipSyncAccuracy":{"status":"not_measured", "why":"Cannot infer true lip sync correctness from a self-driven audio-conditioned renderer"},
            "externalOwnerReferenceAccuracy":independent,
            "actualTongueMotionAccuracy":"not_measured_no_owner_3D_ground_truth",
            "actualTMJRotationAccuracy":"not_measured_no_bone_imaging",
            "commercialQualityGate":"NOT_APPROVED" if (not reviewed or independent.get("status")!="measured_normalized_proxy_only") else "HUMAN_VISUAL_REVIEW_REQUIRED",
            "result":"research_preview_generated_and_verified"}
