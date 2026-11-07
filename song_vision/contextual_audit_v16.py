"""Paired v16 video on the identical recorded sound; no target frames as inputs."""
from __future__ import annotations
import hashlib
import json
import shutil
import subprocess
from pathlib import Path
import cv2
import numpy as np
import torch
from torch.utils.data import Subset, DataLoader
from .core import decode_audio,audio_features
from .contextual_training_v16 import ContextualFaceSequences,collate_sequences,forward_batch,load_contextual


def audit_contextual(dataset: Path,clip_id: str,vocal_file: Path,checkpoint: Path,output: Path):
    if output.exists(): raise FileExistsError('Never overwrite previous comparisons')
    ds=ContextualFaceSequences(dataset/'val')
    matches=[i for i,c in enumerate(ds.clips) if c['index']['clipId']==clip_id]
    if len(matches)!=1: raise ValueError('One heldout clip required')
    ci=matches[0]; clip=ds.clips[ci]
    sha=hashlib.sha256(vocal_file.read_bytes()).hexdigest()
    if sha!=clip['index']['sourceVocalsSha256']: raise ValueError('Audit needs the identical source sound')
    audio=decode_audio(vocal_file); measured=audio_features(audio)
    if measured.shape!=clip['mel'].shape or not np.allclose(measured,clip['mel'],rtol=1e-5,atol=1e-5):
        raise ValueError('Audit source sound differs from training input')
    chosen=[i for i,(c,_) in enumerate(ds.records) if c==ci]
    if not chosen: raise ValueError('No heldout comparison windows')
    # Avoid closing gaps by packing surviving frames into a constant-fps video.
    ids=[j for i in chosen for j in ds.records[i][1]]
    times=[clip['times'][j] for j in ids]
    if not np.allclose(np.diff(times),.04,atol=.002):
        raise ValueError('Audit requires consecutive 25fps source frames')
    model,_=load_contextual(checkpoint)
    output.mkdir(parents=True)
    silent=output/'recorded-contextual-no-lyrics.mp4'
    writer=cv2.VideoWriter(str(silent),cv2.VideoWriter_fourcc(*'mp4v'),25,(576,192))
    if not writer.isOpened(): raise OSError('Could not create private comparison')
    frame_count=0
    try:
        with torch.no_grad():
            for i in chosen:
                batch=collate_sequences([ds[i]])
                predicted=forward_batch(model,batch)['frames'][0]
                ablated=forward_batch(model,batch,disable_lyrics=True)['frames'][0]
                for target,full,without in zip(batch['target'][0],predicted,ablated):
                    panels=[]
                    for image,label in ((target,'RECORDED'),(full,'CONTEXT V16'),(without,'NO LYRICS')):
                        panel=(image.permute(1,2,0).clamp(0,1).numpy()*255).astype(np.uint8)
                        panel=cv2.resize(panel,(192,192))
                        cv2.putText(panel,label,(4,17),cv2.FONT_HERSHEY_SIMPLEX,.43,(255,255,255),1,cv2.LINE_AA)
                        panels.append(panel)
                    writer.write(np.concatenate(panels,axis=1)); frame_count+=1
    finally: writer.release()
    shutil.copyfile(vocal_file,output/'source-vocals-original.wav')
    # Source video begins at times[0], usually .04s. Trim PCM at the same sample.
    # Re-encoding to PCM is lossless at the integer sample level and checked below.
    first=int(round(times[0]*16000)); samples=frame_count*640
    mux=output/'paired-same-source-audio.mkv'
    subprocess.run(['ffmpeg','-nostdin','-hide_banner','-loglevel','error','-i',str(silent),
                    '-i',str(vocal_file),'-map','0:v:0','-map','1:a:0',
                    '-af',f'atrim=start_sample={first}:end_sample={first+samples},asetpts=PTS-STARTPTS',
                    '-c:v','copy','-c:a','pcm_s16le','-shortest',str(mux)],check=True,capture_output=True)
    extracted=subprocess.run(['ffmpeg','-nostdin','-hide_banner','-loglevel','error','-i',str(mux),
                              '-vn','-ac','1','-ar','16000','-f','s16le','-'],check=True,capture_output=True).stdout
    original=(audio.clip(-1,1)*32768).round().astype('<i2').tobytes()
    expected=original[first*2:(first+samples)*2]
    if extracted!=expected: raise ValueError('Comparison audio sample identity check failed')
    report=dict(status='heldout_paired_contextual_face_audit',sourceVocalSha256=sha,
                frames=frame_count,startSeconds=times[0],fps=25,sequenceLength=ds.sequence_length,
                modelStateResetsBetweenWindows=True,sourceSamplesIdentical=True,audioStartSample=first,
                sourceSamplesCompared=len(extracted)//2,recordedFramesOnlyUsedAsTargets=True,
                photorealismValidated=False,semanticUnderstandingValidated=False,mediaPublished=False)
    (output/'paired.report.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
    return report
