"""Reproducible owner-only v30 2D lip thickness and pose review renderer.

The visible band scaling is a research design control (not person-specific
phoneme target or anatomical lip tissue depth). All frames from owner videos.
"""
from __future__ import annotations
import sys, subprocess, json, math, zipfile
from pathlib import Path
import cv2,numpy as np
from PIL import Image,ImageDraw,ImageFont

ROOT=Path(__file__).resolve().parent
sys.path[:0]=[str(ROOT),str(ROOT.parent/'song_v28_work'),str(ROOT.parent/'song_v28_work'/'v26'/'code')]
from owner_mouth_library_v26 import OwnerMouthAtlas
from owner_v27_jaw_oral_rig import import_profile
from owner_v29_microexpression_skin_rig import infer_microexpression_profiles,render_owner_v29
from owner_v30_pose_lip_thickness import (apply_apparent_vermilion_thickness,
         build_owner_thickness_atlas,make_pose_samples,render_thickness_debug_samples)

OUT=ROOT/'results';OUT.mkdir(exist_ok=True)
FONT='/usr/share/fonts/truetype/nanum/NanumSquareR.ttf'
BOLD='/usr/share/fonts/truetype/nanum/NanumSquareB.ttf'
FPS=20
# These scales are artistic *test inputs*, not measured Korean speaker norms.
STYLE={'ㅣ':(.94,.96),'ㅔ':(.80,.89),'ㅗ':(1.12,1.10),'ㅜ':(1.04,1.02),
       'ㅏ':(1.05,1.11),'ㅡ':(.88,.92),'ㅓ':(.97,1.05),'ㅐ':(.81,.90)}


def annotated(face1,face2,label,meta,progress,brief='RESEARCH PREVIEW'):
    H,W=704,1120
    panel=Image.new('RGB',(W,H),(22,23,31));d=ImageDraw.Draw(panel)
    f1=ImageFont.truetype(BOLD,29);f2=ImageFont.truetype(FONT,21);f3=ImageFont.truetype(FONT,17)
    panel.paste(Image.fromarray(cv2.cvtColor(cv2.resize(face1,(408,408)),cv2.COLOR_BGR2RGB)),(35,96))
    panel.paste(Image.fromarray(cv2.cvtColor(cv2.resize(face2,(408,408)),cv2.COLOR_BGR2RGB)),(674,96))
    d.text((37,23),'v29 · 입술·턱·피부 움직임',font=f1,fill=(229,220,226))
    d.text((674,23),'v30 · 윗입술 / 아랫입술 독립 두께',font=f1,fill=(213,237,220))
    d.text((35,538),f'실험 모음 {label} — 형태 확인용',font=f2,fill=(250,230,198))
    d.text((674,538),f'upper factor {meta["upperRelativeScale"]:.2f}  lower factor {meta["lowerRelativeScale"]:.2f}',font=f2,fill=(240,224,232))
    d.text((35,581),'입술 두께 = 보이는 붉은 부분 세로 높이 (2D 픽셀)',font=f3,fill=(215,208,218))
    d.text((35,611),'의학적 앞뒤 두께 mm 또는 입안 3D 구조는 측정하지 않았음',font=f3,fill=(214,174,187))
    d.text((35,639),f'이 영상의 모음별 두께 목표는 설계 초안이며 음소 정답 학습이 아님  |  {brief}',font=f3,fill=(213,181,193))
    d.rectangle((35,676,1084,685),fill=(70,67,74))
    d.rectangle((35,676,35+round(progress*1049),685),fill=(217,180,190))
    return cv2.cvtColor(np.array(panel),cv2.COLOR_RGB2BGR)


def encode(silent,out,audio=None,duration=None):
    cmd=['ffmpeg','-y','-hide_banner','-loglevel','error','-nostdin','-i',str(silent)]
    if audio is not None:
        cmd+=['-i',str(audio),'-map','0:v:0','-map','1:a:0','-c:a','aac','-b:a','128k']
    cmd+=['-c:v','libx264','-preset','veryfast','-crf','24','-pix_fmt','yuv420p',
           '-movflags','+faststart']
    if duration:cmd+=['-t',str(duration)]
    cmd+=[str(out)]
    subprocess.run(cmd,check=True)
    silent.unlink(missing_ok=True)


def face_library():
    atlas=OwnerMouthAtlas.from_user_videos(Path('/mnt/data'))
    jaw=import_profile(ROOT.parent/'song_v28_work'/'results'/'OWNER_V27_LEARNED_JAW_PROFILE.json')
    micro=infer_microexpression_profiles(atlas)
    return atlas,jaw,micro


def render_study(atlas,jaw,micro):
    vowels=['ㅣ','ㅔ','ㅗ','ㅜ','ㅏ','ㅡ']
    comparison=[]
    cache=[]
    for vowel in vowels:
        base,prev=render_owner_v29(atlas,jaw,micro,vowel)
        transformed,meta=apply_apparent_vermilion_thickness(base,*STYLE[vowel])
        cache.append((vowel,base,transformed,meta))
        mouth=base[214:267,118:202];moved=transformed[214:267,118:202]
        comparison.append({'vowel':vowel,'upperScale':STYLE[vowel][0], 'lowerScale':STYLE[vowel][1],
                           'mouthRegionMeanPixelChange255':round(float(np.abs(mouth.astype(float)-moved.astype(float)).mean()),5),
                           'sourceFrameState':prev['observedShapeState'],
                           'verifiedVowelLabel':False})
    frames_per=int(.95*FPS)
    total=frames_per*len(cache)
    raw=OUT/'_V30_SILENT.mp4'
    writer=cv2.VideoWriter(str(raw),cv2.VideoWriter_fourcc(*'mp4v'),FPS,(1120,704))
    if not writer.isOpened():raise RuntimeError('failed to open silent video writer')
    frames=[]
    for i in range(total):
        j=min(len(cache)-1,i//frames_per)
        alpha=(i%frames_per)/frames_per
        vowel,base,dest,meta=cache[j]
        if j and alpha<.22:
            t=np.clip(alpha/.22,0,1);t=t*t*(3-2*t)
            old=cache[j-1]
            base=cv2.addWeighted(old[1],1-t,base,t,0)
            dest=cv2.addWeighted(old[2],1-t,dest,t,0)
        frame=annotated(base,dest,vowel,meta,(i+1)/total)
        writer.write(frame)
        if i%frames_per==frames_per//2:frames.append(frame)
    writer.release()
    final=OUT/'SONG_V30_VISIBLE_UPPER_LOWER_LIP_THICKNESS.mp4'
    encode(raw,final)
    big=Image.new('RGB',(640,len(frames)*225),(18,20,24))
    for i,frame in enumerate(frames):
        cut=cv2.cvtColor(cv2.resize(frame,(640,402)),cv2.COLOR_BGR2RGB)
        # Zoom to before/after mouth with label strip in 640x225.
        left=frame[270:410,170:380];right=frame[270:410,800:1010]
        cutnew=np.hstack([cv2.resize(left,(320,206)),cv2.resize(right,(320,206))])
        tile=Image.fromarray(cv2.cvtColor(cutnew,cv2.COLOR_BGR2RGB))
        big.paste(tile,(0,i*225+19))
        ImageDraw.Draw(big).text((10,i*225+2),vowels[i],fill=(245,238,235))
    big.save(OUT/'SONG_V30_LIP_THICKNESS_CLOSEUP.jpg',quality=91)
    return comparison, final


def render_pose_movie():
    # Source has visible turning at ~9--13s and ~16--18s; show actual original frames.
    path=Path('/mnt/data/IMG_0853.mp4');v=cv2.VideoCapture(str(path))
    fps=20;start=8.0;dur=6.0
    raw=OUT/'_POSES_SILENT.mp4'
    writer=cv2.VideoWriter(str(raw),cv2.VideoWriter_fourcc(*'mp4v'),fps,(1080,680))
    if not writer.isOpened():raise RuntimeError('pose writer error')
    font=ImageFont.truetype(FONT,23);small=ImageFont.truetype(FONT,17)
    for i in range(round(dur*fps)):
        t=start+i/fps;v.set(cv2.CAP_PROP_POS_MSEC,t*1000);ok,im=v.read()
        if not ok:break
        cropped=cv2.resize(im,(370,656),interpolation=cv2.INTER_AREA)
        frame=Image.new('RGB',(1080,680),(24,23,31))
        frame.paste(Image.fromarray(cv2.cvtColor(cropped,cv2.COLOR_BGR2RGB)),(35,12))
        d=ImageDraw.Draw(frame)
        d.text((440,90),'실제 사용자 Speaking 원본',font=font,fill=(237,230,238))
        d.text((440,140),f'IMG_0853.mp4 · {t:.2f} s',font=font,fill=(239,205,217))
        for y,line in enumerate(['이 구간은 정면에서 얼굴이 돌아가는 실제 영상이야.',
              '학습용 포즈 후보 수집은 가능하지만 실제 yaw 각도는 미측정.',
              '측면 영상을 정면 2D 입모양에 억지로 변형 적용하지 않아.',
              '다음 단계: 검수된 측면 랜드마크와 정면/측면 별도 리그.']):
             d.text((440,212+y*42),line,font=small,fill=(210,205,215))
        writer.write(cv2.cvtColor(np.array(frame),cv2.COLOR_RGB2BGR))
    writer.release();v.release()
    final=OUT/'SONG_V30_OWNER_SPEAKING_TURNED_POSE_OBSERVATION.mp4'
    encode(raw,final)
    return final


def am630_contract():
    src=ROOT/'am630.mp3'
    if not src.exists():
        with zipfile.ZipFile(ROOT.parent/'am630_original_song.zip') as z:
            with z.open('am630.mp3') as i,open(src,'wb') as o:o.write(i.read())
    lyric='어두운 밤이 지나면'
    chars=[c for c in lyric if c.strip()]
    template={'sourceSong':'am630.mp3','excerpt':lyric,'status':'NO_VERIFIED_SYLLABLE_TIMECODES',
              'manualReviewRequired':True,
              'cues':[{'syllable':c,'startSec':None,'endSec':None,'vowelVerified':False,'reviewer':None} for c in chars],
              'doNotTrainForcedAlignmentFromThisTemplate':True}
    (OUT/'AM630_V30_HUMAN_ALIGNMENT_PENDING.json').write_text(json.dumps(template,ensure_ascii=False,indent=2))
    return src


def run():
    OUT.mkdir(exist_ok=True)
    atlas,jaw,micro=face_library()
    compare,video=render_study(atlas,jaw,micro)
    turned=render_pose_movie()
    song=am630_contract()
    report={'version':'SONG_v30',
            'userSourceVideos':['IMG_0853.mp4','IMG_0854.mp4'],
            'newFeatures':['2D visible upper/lower vermilion height proxies',
                           'separate upper and lower lip region remap',
                           'actual speaking turned face candidate capture',
                           'song alignment human verification gate'],
            'vowels':compare,
            'audibleAM630SongAvailable':True,
            'verifiedPhonemeTimes':False,
            'humanReviewed3DThickness':False,
            'actualMandibleRotationAngleMeasured':False,
            'automaticInnerOralSegmentationClinicallyValidated':False,
            'vowelThicknessTargetsAreLearnedFromVerifiedVowelLabels':False,
            'results':[video.name,turned.name,'SONG_V30_LIP_THICKNESS_CLOSEUP.jpg',
                'V30_OWNER_VISIBLE_VERMILION_MEASUREMENT.jpg','V30_OWNER_TURNED_POSE_CANDIDATES.jpg'],
            'notice':'2D pixels are not 3D tissue thickness; vowel-specific thickness scale is a research artist-control prior'}
    (OUT/'SONG_V30_VALIDATION_REPORT.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
    print(json.dumps({'video':str(video),'turned':str(turned),
                      'mouthDifference':compare,'cueCount':8},ensure_ascii=False,indent=2))

if __name__=='__main__':run()
