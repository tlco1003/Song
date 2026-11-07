"""AM 6:30 owner's song + text-driven viseme staging.

Visual timing deliberately DOES NOT claim to be lyric-aligned; per-syllable
positions are a stage preview. Audio loudness changes blending strength, not
which vowel is selected. No phoneme GT is fabricated.
"""
from __future__ import annotations
import sys,json,subprocess
from pathlib import Path
import cv2,numpy as np
from PIL import Image,ImageDraw,ImageFont

ROOT=Path(__file__).resolve().parent
sys.path[:0]=[str(ROOT),str(ROOT.parent/'song_v28_work'),str(ROOT.parent/'song_v28_work'/'v26'/'code'),
              str(ROOT)]
from owner_v30_pose_lip_thickness import apply_apparent_vermilion_thickness
from render_v30_owner import face_library, STYLE, encode, am630_contract
from owner_v29_microexpression_skin_rig import render_owner_v29
from owner_v21_text_viseme import syllables

FPS=20;DURATION=6.0;OUT=ROOT/'results';OUT.mkdir(exist_ok=True)
FONT='/usr/share/fonts/truetype/nanum/NanumSquareR.ttf'
BOLD='/usr/share/fonts/truetype/nanum/NanumSquareB.ttf'


def audio_rms(mp3:Path):
    p=subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-nostdin',
        '-i',str(mp3),'-t',str(DURATION),'-ar','16000','-ac','1','-f','f32le','-'],
        check=True,capture_output=True)
    a=np.frombuffer(p.stdout,dtype='<f4')
    if not len(a):raise ValueError('AM630 returned no audio')
    samples_per_frame=round(16000/FPS)
    e=np.array([float(np.sqrt(np.mean(np.square(a[i:i+samples_per_frame]))))
                for i in range(0,len(a),samples_per_frame)])
    lo,hi=np.percentile(e,[10,90])
    return np.clip((e-lo)/(hi-lo+1e-6),0,1)


def make_preview():
    song=am630_contract();energy=audio_rms(song)
    atlas,jaw,micro=face_library()
    text='어두운 밤이 지나면';notes=syllables(text)
    cache={}
    for v in sorted(set(x.vowel for x in notes)):
        if v not in STYLE:
            # ㅕ is glide ㅣ→ㅓ; this simple still preview uses target shape only.
            mapped={'ㅕ':'ㅓ','ㅑ':'ㅏ','ㅛ':'ㅗ','ㅠ':'ㅜ','ㅖ':'ㅔ'}.get(v,'ㅡ')
        else:mapped=v
        face,old=render_owner_v29(atlas,jaw,micro,mapped)
        face,meta=apply_apparent_vermilion_thickness(face,*STYLE[mapped])
        cache[v]=(face,meta,mapped)
    idle=atlas.base
    raw=OUT/'_V30_AM630_SILENT.mp4'
    out=OUT/'AM630_V30_VISIBLE_LIP_THICKNESS_UNALIGNED.mp4'
    writer=cv2.VideoWriter(str(raw),cv2.VideoWriter_fourcc(*'mp4v'),FPS,(960,650))
    if not writer.isOpened():raise RuntimeError('video write failed')
    f=ImageFont.truetype(FONT,21);bold=ImageFont.truetype(BOLD,30);small=ImageFont.truetype(FONT,17)
    start=.65; syl_dur=.62
    for k in range(round(DURATION*FPS)):
        t=k/FPS
        idx=min(len(notes)-1,max(0,int((t-start)/syl_dur)))
        node=notes[idx];target,meta,mapped=cache[node.vowel]
        local=(t-start-idx*syl_dur)/syl_dur
        gate=min(1,max(0,local/.12),(1-local)/.12 if local>.88 else 1.)
        energy_at=float(energy[min(k,len(energy)-1)])
        # Emotion/Jaw remain separately defined in v29; amplitude only modifies
        # their display interpolation, not the vowel identity.
        mix=(.55+.45*energy_at)*max(.0,gate) if t>=start else .0
        frameface=cv2.addWeighted(idle,1-mix,target,mix,0)
        panel=Image.new('RGB',(960,650),(25,23,31));d=ImageDraw.Draw(panel)
        main=cv2.resize(frameface,(430,430))
        panel.paste(Image.fromarray(cv2.cvtColor(main,cv2.COLOR_BGR2RGB)),(20,85))
        mouth=cv2.resize(frameface[210:275,105:215],(430,260),interpolation=cv2.INTER_CUBIC)
        panel.paste(Image.fromarray(cv2.cvtColor(mouth,cv2.COLOR_BGR2RGB)),(505,150))
        d.text((20,14),'AM 6:30 · 가사 텍스트 + 윗/아랫입술 두께 실험',font=bold,fill=(234,223,233))
        d.text((507,95),f'현재 문자: {node.glyph}   모음: {node.vowel}',font=f,fill=(245,227,185))
        d.text((507,434),f'윗입술×{meta["upperRelativeScale"]:.2f} · 아랫입술×{meta["lowerRelativeScale"]:.2f}',font=f,fill=(235,217,230))
        d.text((507,467),f'원곡 RMS 보정 강도: {energy_at:.2f}',font=f,fill=(217,206,221))
        d.text((20,544),'어두운 밤이 지나면',font=bold,fill=(241,230,238))
        d.text((20,584),'음절 시각은 자동 배분한 미검증 연구 초안 · 노래 싱크 정답 아님',font=small,fill=(224,174,179))
        writer.write(cv2.cvtColor(np.asarray(panel),cv2.COLOR_RGB2BGR))
    writer.release();encode(raw,out,audio=song,duration=DURATION)
    return {'video':out.name,'seconds':DURATION,'fps':FPS,
            'song':'am630.mp3','lyrics':text,'syllableCount':len(notes),
            'sourceCues':'DRAFT_UNALIGNED', 'verifiedLyricsTiming':False,
            'lipThicknessScalesLearnedPerVowelFromHumanLabels':False,
            'musicRMSModulatesOnlyMotionStrength':True}

if __name__=='__main__':
    r=make_preview()
    (OUT/'AM630_V30_PREVIEW_STATUS.json').write_text(json.dumps(r,ensure_ascii=False,indent=2))
    print(json.dumps(r,ensure_ascii=False,indent=2))
