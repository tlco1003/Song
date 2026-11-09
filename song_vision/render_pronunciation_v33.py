"""Review clips from real owner pronunciation footage (no synthetic lip fill)."""
from __future__ import annotations
import argparse,json,math,subprocess,sys
from pathlib import Path
import cv2,numpy as np,soundfile as sf
from PIL import Image,ImageDraw,ImageFont
from train_pronunciation_v33 import mouth_face_crop,extract_mouth

FONT='/usr/share/fonts/truetype/nanum/NanumSquareR.ttf'
BOLD='/usr/share/fonts/truetype/nanum/NanumSquareB.ttf'
FPS=24;W=1420;H=680


def render_segments(video:Path, report_path:Path, ids:list[int], out:Path, segment_label: str):
    out.parent.mkdir(parents=True,exist_ok=True)
    src=json.loads(report_path.read_text(encoding='utf-8'))['segments']
    audio,sr=sf.read(report_path.parent/'pronunciation_audio_16k.wav')
    cap=cv2.VideoCapture(str(video));fc=cv2.CascadeClassifier(cv2.data.haarcascades+'haarcascade_frontalface_default.xml')
    silent=out.with_name('_'+out.stem+'_silent.mp4');wave=out.with_name('_'+out.stem+'_audio.wav')
    wr=cv2.VideoWriter(str(silent),cv2.VideoWriter_fourcc(*'mp4v'),FPS,(W,H))
    if not wr.isOpened():raise RuntimeError('Cannot create preview video')
    title_font=ImageFont.truetype(BOLD,35);lead_font=ImageFont.truetype(BOLD,30)
    body_font=ImageFont.truetype(FONT,19);small_font=ImageFont.truetype(FONT,16)
    audio_parts=[];total_time=0;last_box=None
    for rank,idx in enumerate(ids):
        item=src[idx];a=item['startSec'];b=item['endSec'];start=max(0,a-.12);end=min(len(audio)/sr,b+.12)
        nframes=max(1,int(np.ceil((end-start)*FPS)))
        voice=audio[int(start*sr):int(end*sr)]
        target=int(nframes*sr/FPS)
        if len(voice)<target:voice=np.pad(voice,(0,target-len(voice)))
        else:voice=voice[:target]
        audio_parts.append(voice)
        for j in range(nframes):
            t=start+j/FPS
            cap.set(cv2.CAP_PROP_POS_MSEC,t*1000);ok,frame=cap.read()
            if not ok:continue
            face,last_box=mouth_face_crop(frame,fc,prev=last_box)
            _,m,mouth,mask=extract_mouth(face)
            mouthbig=cv2.resize(mouth,(435,310),interpolation=cv2.INTER_CUBIC)
            over=mouth.copy()
            # outline only where automatic mask found, explicitly not GT inner lip
            ct,_=cv2.findContours(mask,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE)
            cv2.drawContours(over,ct,-1,(15,220,245),1)
            overlay=cv2.resize(over,(435,310),interpolation=cv2.INTER_CUBIC)
            bg=Image.new('RGB',(W,H),(23,23,33));d=ImageDraw.Draw(bg)
            label=item.get('syllable') or f'그룹 {item["group"]+1} / {item["positionInGroup"]+1}번 (미검증)'
            d.text((34,22),f'SONG AI v33 · {segment_label}',font=title_font,fill=(241,235,238))
            d.text((35,78),f'{label}   원본 음성 {a:.2f}–{b:.2f}초',font=lead_font,fill=(249,221,198))
            origin=Image.fromarray(cv2.cvtColor(cv2.resize(frame,(398,398)),cv2.COLOR_BGR2RGB))
            bg.paste(origin,(35,138))
            # Right panel: real mouth and mask line candidate
            right=Image.fromarray(cv2.cvtColor(mouthbig,cv2.COLOR_BGR2RGB))
            bg.paste(right,(482,163))
            overlayim=Image.fromarray(cv2.cvtColor(overlay,cv2.COLOR_BGR2RGB))
            bg.paste(overlayim,(940,163)); # cropped by image edge, still okay
            d.text((483,133),'실제 입술·치아·혀 픽셀',font=body_font,fill=(224,239,231))
            d.text((942,133),'경계 후보',font=body_font,fill=(249,204,202))
            d.text((483,516),f'입안 어두운 후보 {m["oralDarkCandidateAreaPx"]:.0f}px²',font=body_font,fill=(235,225,240))
            d.text((483,544),f'너비 {m["lipRedCandidateWidthPx"]}px · 입안 높이 후보 {m["oralCandidateHeightPx"]:.0f}px',font=body_font,fill=(235,225,240))
            d.text((35,600),'실제 영상/음성 타임코드로 추출 · 자동 윤곽은 의학적 정답 아님 · 사용자 제공 발음 순서 기반 임시 라벨',font=small_font,fill=(217,192,204))
            d.rectangle((35,642,1375,652),fill=(80,77,87))
            d.rectangle((35,642,35+int(1340*(rank+j/max(nframes,1))/len(ids)),652),fill=(229,168,187))
            wr.write(cv2.cvtColor(np.asarray(bg),cv2.COLOR_RGB2BGR))
        audio_parts.append(np.zeros(int(.13*sr),np.float32))
        # appended silence must also have video frames
        for k in range(int(.13*FPS)):
            wr.write(cv2.cvtColor(np.asarray(bg),cv2.COLOR_RGB2BGR))
    cap.release();wr.release()
    waveform=np.concatenate(audio_parts).astype(np.float32)
    sf.write(wave,waveform,sr,subtype='PCM_16')
    subprocess.run(['ffmpeg','-y','-hide_banner','-loglevel','error','-nostdin','-i',str(silent),'-i',str(wave),'-map','0:v','-map','1:a','-c:v','libx264','-preset','veryfast','-crf','24','-pix_fmt','yuv420p','-c:a','aac','-b:a','96k','-shortest','-movflags','+faststart',str(out)],check=True)
    silent.unlink();wave.unlink()
    return out

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--video',type=Path,required=True);p.add_argument('--segments',type=Path,required=True);p.add_argument('--output',type=Path,required=True);p.add_argument('--indices',type=int,nargs='+',required=True);p.add_argument('--title',default='가사 발음 검토')
    a=p.parse_args();print(render_segments(a.video,a.segments,a.indices,a.output,a.title))
