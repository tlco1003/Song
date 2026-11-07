"""Check whether GitHub music-video assets are genuine matched singing-face truth.

Audio-track similarity and visible human faces do NOT prove that the pictured
person performed the sound. Such a claim requires reviewed performer identity,
consent, phonetic time alignment and camera/audio sync.
"""
from __future__ import annotations
import json
import math
import shutil
import subprocess
from pathlib import Path

import cv2
import numpy as np


def probe(file: Path):
    result=subprocess.run(['ffprobe','-v','error','-show_entries',
        'format=duration:stream=codec_type','-of','json',str(file)],
        capture_output=True,text=True,check=True)
    data=json.loads(result.stdout)
    return {'durationSeconds':float(data['format']['duration']),
            'streams':[x['codec_type'] for x in data.get('streams',[])]}


def pcm(file: Path,seconds=30,sr=8000):
    result=subprocess.run(['ffmpeg','-hide_banner','-loglevel','error',
        '-nostdin','-t',str(seconds),'-i',str(file),
        '-vn','-ar',str(sr),'-ac','1','-f','f32le','-'],
        capture_output=True,check=True)
    samples=np.frombuffer(result.stdout,dtype='<f4').copy()
    if not len(samples) or not np.isfinite(samples).all():
        raise ValueError('Invalid media soundtrack')
    return samples


def best_audio_similarity(a,b):
    """Peak normalized fixed-window lag correlation; indicative, not proof."""
    if min(len(a),len(b))<16000:
        return {'confidence':'INSUFFICIENT_AUDIO', 'maxAbsCorrelation':None}
    # FFT cross-correlation on the first <=30s; normalized by global RMS.
    n=1<<(len(a)+len(b)-2).bit_length()
    cc=np.fft.irfft(np.fft.rfft(a,n)*np.conj(np.fft.rfft(b,n)),n)
    # Restrict to <=10 seconds local drift. A musical cut/remix can lower fit.
    lag=10*8000
    # Positive index corresponds to a being later; negative wrapped indices.
    allowed=np.concatenate((cc[:min(lag+1,len(a))],
                            cc[-min(lag,len(b)-1):]))
    peak=float(np.max(np.abs(allowed)))
    scale=float(np.linalg.norm(a)*np.linalg.norm(b))
    score=peak/scale if scale>1e-8 else 0.
    return {'maxAbsCorrelation':round(float(np.clip(score,0,1)),5),
            'hasStrongMatchingAudioEvidence':bool(score>=.90),
            'interpretation':'Waveform evidence only; not singer lip timing or consent'}


def face_samples(file: Path):
    cascade=cv2.CascadeClassifier(cv2.data.haarcascades+'haarcascade_frontalface_default.xml')
    if cascade.empty():raise RuntimeError('Local face detector missing')
    cap=cv2.VideoCapture(str(file))
    if not cap.isOpened():raise OSError('Cannot read the source video')
    fps=cap.get(cv2.CAP_PROP_FPS)
    if not math.isfinite(fps) or fps<=0:raise ValueError('Unknown video frame rate')
    total=int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    positions=range(0,min(total,int(45*fps)),max(1,int(round(fps))))
    checked=found=0
    try:
        for position in positions:
            cap.set(cv2.CAP_PROP_POS_FRAMES,position)
            ok,frame=cap.read()
            if not ok:continue
            checked+=1
            h,w=frame.shape[:2]
            ratio=min(1.,640/max(w,h))
            frame=cv2.resize(frame,(round(w*ratio),round(h*ratio)))
            gray=cv2.cvtColor(frame,cv2.COLOR_BGR2GRAY)
            regions=cascade.detectMultiScale(gray,scaleFactor=1.1,minNeighbors=5,
                                               minSize=(45,45))
            if len(regions):found+=1
    finally:cap.release()
    return {'sampledFrames':checked,'framesWithFaceDetection':found,
            'facialPerformanceGroundTruth':False,
            'note':'Face detector cannot identify singer or determine lip sync accuracy'}


def main():
    root=Path('docs/media')
    cases=[
        ('mother-song.mp4','mother-song.mp3'),
        ('Papa.mp4',None),
        (None,'nara.mp3')
    ]
    rows=[]
    for video,audio in cases:
        files=[root/x for x in (video,audio) if x]
        if any(not x.exists() for x in files):
            raise FileNotFoundError(f'GitHub song asset missing: {files}')
        item={'video':video,'audio':audio,
              'exactSameSongSingingFacePairVerified':False}
        if video:
            item['videoProbe']=probe(root/video)
            item['faceDetector']=face_samples(root/video)
        if audio: item['audioProbe']=probe(root/audio)
        if video and audio and 'audio' in item['videoProbe']['streams']:
            item['soundtrackSimilarity']=best_audio_similarity(pcm(root/video),pcm(root/audio))
        else:
            item['soundtrackSimilarity']=None
        rows.append(item)
    report={'study':'SONG_GITHUB_SOURCE_MEDIA_AUDIT',
            'cases':rows,'confirmedOriginalSingerLipTruthPairs':0,
            'reason':'No per-frame verified identity, consent and reviewed word/phone timings',
            'canTrainSupervisedKoreanSingerLipSyncFromGitHubAssetsAlone':False}
    out=Path('song-vision-source-audit-result.json')
    out.write_text(json.dumps(report,ensure_ascii=False,indent=2))
    print('SONG_MEDIA_AUDIT='+json.dumps(report,ensure_ascii=False),flush=True)


if __name__=='__main__':main()
