from __future__ import annotations
from dataclasses import dataclass, asdict
from pathlib import Path
import json, math, subprocess
import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

OUT=Path('/mnt/data/song_v31_work/results')
OUT.mkdir(parents=True, exist_ok=True)
FONT='/usr/share/fonts/truetype/nanum/NanumSquareR.ttf'
BOLD='/usr/share/fonts/truetype/nanum/NanumSquareB.ttf'
FPS=20

@dataclass
class MouthGeom:
    cx: float
    seam_y: float
    x0: int
    x1: int
    width: int
    upper_band: int
    lower_band: int
    philtrum_lock_y: int
    jaw_start_y: int


def load_face(video_path:str, sec:float, out_size:int=320)->np.ndarray:
    cap=cv2.VideoCapture(video_path)
    cap.set(cv2.CAP_PROP_POS_MSEC, sec*1000)
    ok, frame=cap.read(); cap.release()
    if not ok: raise RuntimeError(f'cannot read {video_path}@{sec}')
    fc=cv2.CascadeClassifier(cv2.data.haarcascades+'haarcascade_frontalface_default.xml')
    faces=fc.detectMultiScale(cv2.cvtColor(frame,cv2.COLOR_BGR2GRAY),1.1,4,minSize=(80,80))
    if len(faces)==0: raise RuntimeError('no face detected')
    faces=sorted(faces,key=lambda b:b[2]*b[3], reverse=True)
    x,y,w,h=faces[0]
    cx=x+w/2; cy=y+h/2+0.11*h; side=max(w,h)*1.72
    x0=max(0,int(cx-side/2)); y0=max(0,int(cy-side/2)); x1=min(frame.shape[1],int(cx+side/2)); y1=min(frame.shape[0],int(cy+side/2))
    face=frame[y0:y1,x0:x1]
    return cv2.resize(face,(out_size,out_size),interpolation=cv2.INTER_AREA)


def detect_mouth_geometry(face:np.ndarray)->MouthGeom:
    H,W=face.shape[:2]
    xA,xB=0.36,0.64
    yA,yB=0.50,0.72
    roi=face[int(yA*H):int(yB*H), int(xA*W):int(xB*W)]
    lab=cv2.cvtColor(roi,cv2.COLOR_BGR2LAB)
    L=lab[...,0].astype(np.float32)
    a=lab[...,1].astype(np.float32)
    # Search only the central lower face to avoid sweater / hair shadows.
    score=(255-L)+0.36*np.maximum(a-128,0)
    score=cv2.GaussianBlur(score,(0,0),1.0)
    row_scores=np.median(score,axis=1)
    seam_row=int(np.argmax(row_scores))
    line=score[seam_row]
    baseline=np.percentile(line,55)
    high=np.percentile(line,70)
    mask=(line>=high)
    segs=[]; start=None
    for i,v in enumerate(mask):
        if v and start is None: start=i
        if start is not None and ((not v) or i==len(mask)-1):
            end=i if not v else i+1
            segs.append((start,end)); start=None
    center=len(mask)/2
    best=(0, int(.35*roi.shape[1]), int(.65*roi.shape[1]))
    for s,e in segs:
        ln=e-s; mid=(s+e)/2
        sc=ln - 0.60*abs(mid-center)
        if sc>best[0] and ln>=6: best=(sc,s,e)
    _,s,e=best
    while s>1 and line[s-1]>=baseline: s-=1
    while e<line.shape[0]-2 and line[e+1]>=baseline: e+=1
    x0=int(xA*W)+s; x1=int(xA*W)+e
    seam_y=int(yA*H)+seam_row
    width=max(24,x1-x0)
    upper_band=max(8, int(0.30*width))
    lower_band=max(10, int(0.38*width))
    philtrum_lock_y=seam_y-upper_band-10
    jaw_start_y=seam_y+4
    return MouthGeom((x0+x1)/2, seam_y, x0, x1, width, upper_band, lower_band, philtrum_lock_y, jaw_start_y)


def _smooth01(x):
    x=np.clip(x,0,1)
    return x*x*(3-2*x)


def _gauss2(h,w,cx,cy,sx,sy):
    yy,xx=np.mgrid[:h,:w].astype(np.float32)
    return np.exp(-0.5*(((xx-cx)/sx)**2+((yy-cy)/sy)**2)).astype(np.float32)


def apply_v31_transform(face:np.ndarray, geom:MouthGeom, spec:dict):
    h,w=face.shape[:2]
    yy,xx=np.mgrid[:h,:w].astype(np.float32)
    dx=np.zeros((h,w),np.float32)
    dy=np.zeros((h,w),np.float32)
    c=geom.cx; s=geom.seam_y; width=geom.width
    # 1) lip width / rounding. scale<1 means inward movement, >1 outward.
    lip_mask=_gauss2(h,w,c,s,width*.55,geom.lower_band*1.35)
    round_scale=float(spec.get('width_scale',1.0))
    dx += (1-round_scale)*(xx-c)*lip_mask
    # 2) upper/lower visible thickness around seam. <1 thinner toward seam.
    upper_scale=float(spec.get('upper_scale',1.0)); lower_scale=float(spec.get('lower_scale',1.0))
    upper_mask=_gauss2(h,w,c,s-geom.upper_band*0.55,width*.42,geom.upper_band*.75)
    lower_mask=_gauss2(h,w,c,s+geom.lower_band*0.45,width*.46,geom.lower_band*.80)
    dy += (1-upper_scale)*7.5*upper_mask  # thinner => downward toward seam
    dy += -(1-lower_scale)*8.5*lower_mask # thinner => upward toward seam
    # 3) lower jaw movement. Only lower face moves; philtrum/nose locked.
    jaw_drop=float(spec.get('jaw_drop',0.0))
    lower_gate=_smooth01((yy-geom.jaw_start_y)/(h-geom.jaw_start_y+1))
    oval=np.clip((1-(((xx-c)/(width*1.8))**2 + ((yy-(s+50))/(width*2.5))**2)),0,1)
    jaw_mask=lower_gate*oval
    dy += jaw_drop*jaw_mask
    # slight jaw widening for ㅏ type open vowels
    jaw_spread=float(spec.get('jaw_spread',0.0))
    dx += jaw_spread*(xx-c)/(max(width,1))*jaw_mask*2.0
    # Hard lock the region above philtrum. No nose/upper-lip lengthening.
    dx[yy<geom.philtrum_lock_y]=0
    dy[yy<geom.philtrum_lock_y]=0
    # remap
    mapx=(xx-dx).astype(np.float32)
    mapy=(yy-dy).astype(np.float32)
    warped=cv2.remap(face,mapx,mapy,interpolation=cv2.INTER_LINEAR,borderMode=cv2.BORDER_REFLECT_101)
    out=warped.copy()
    # 4) reinforce seam and mouth aperture using the user's rule: darkest line is lip boundary.
    aperture_h=float(spec.get('aperture_h',0.0))
    aperture_w=float(spec.get('aperture_w',1.0))*width*0.52
    mask=np.zeros((h,w),np.uint8)
    if aperture_h>1.5:
        center=(int(c), int(s+0.7+spec.get('aperture_y_shift',0)))
        axes=(max(3,int(aperture_w/2)), max(1,int(aperture_h/2)))
        cv2.ellipse(mask, center, axes, 0, 0, 360, 255, -1)
        mask=cv2.GaussianBlur(mask,(0,0),1.5)
        # darken cavity
        dark=np.clip(out.astype(np.float32)*0.42,0,255).astype(np.uint8)
        alpha=(mask/255.0*0.88)[...,None]
        out=(out.astype(np.float32)*(1-alpha)+dark.astype(np.float32)*alpha).astype(np.uint8)
    # seam line kept visible for all states
    seam_strength=float(spec.get('seam_strength',0.82))
    seam_mask=np.zeros((h,w),np.uint8)
    cv2.line(seam_mask,(geom.x0,int(s)),(geom.x1,int(s)),255,thickness=max(1,int(width*0.04)))
    seam_mask=cv2.GaussianBlur(seam_mask,(0,0),1.1)
    alpha=(seam_mask/255.0*seam_strength)[...,None]
    darker=np.clip(out.astype(np.float32)*0.58,0,255).astype(np.uint8)
    out=(out.astype(np.float32)*(1-alpha)+darker.astype(np.float32)*alpha).astype(np.uint8)
    # subtle corner crease for rounded vowels
    if spec.get('corner_dim',0)>0:
        for sign in (-1,1):
            cx=int(c+sign*width*0.42); cy=int(s)
            corner=np.zeros((h,w),np.uint8)
            cv2.ellipse(corner,(cx,cy),(3,3),0,0,360,255,-1)
            corner=cv2.GaussianBlur(corner,(0,0),1.2)
            a=(corner/255.0*spec['corner_dim'])[...,None]
            out=(out.astype(np.float32)*(1-a)+np.clip(out.astype(np.float32)*0.7,0,255)*a).astype(np.uint8)
    # preserve top region from original to avoid any accidental stretch
    out[:geom.philtrum_lock_y,:,:]=face[:geom.philtrum_lock_y,:,:]
    return out, {
        'philtrumLockY': geom.philtrum_lock_y,
        'jawStartY': geom.jaw_start_y,
        'seamY': geom.seam_y,
        'closedWidthPx': geom.width,
        'spec': spec,
    }


def draw_guides(face:np.ndarray, geom:MouthGeom, title:str=''):
    img=face.copy()
    cv2.line(img,(geom.x0,geom.seam_y),(geom.x1,geom.seam_y),(20,20,220),2)
    cv2.line(img,(0,geom.philtrum_lock_y),(img.shape[1],geom.philtrum_lock_y),(60,220,240),1)
    cv2.line(img,(0,geom.jaw_start_y),(img.shape[1],geom.jaw_start_y),(80,220,80),1)
    if title:
        cv2.putText(img,title,(8,20),cv2.FONT_HERSHEY_SIMPLEX,.55,(255,255,255),1,cv2.LINE_AA)
    return img


def panelize(ref_img, out_img, label, note, progress):
    H,W=720,1280
    panel=Image.new('RGB',(W,H),(22,22,28))
    dr=ImageDraw.Draw(panel)
    f1=ImageFont.truetype(BOLD,30); f2=ImageFont.truetype(FONT,21); f3=ImageFont.truetype(FONT,17)
    ref=Image.fromarray(cv2.cvtColor(cv2.resize(ref_img,(430,430)),cv2.COLOR_BGR2RGB))
    out=Image.fromarray(cv2.cvtColor(cv2.resize(out_img,(430,430)),cv2.COLOR_BGR2RGB))
    panel.paste(ref,(50,120)); panel.paste(out,(800,120))
    dr.text((55,32),'실제 speaking 참고 프레임',font=f1,fill=(234,228,234))
    dr.text((805,32),'v31 수정 결과',font=f1,fill=(213,238,223))
    dr.text((55,82),f'모음/형태 {label}',font=f2,fill=(251,230,198))
    dr.text((55,575),note,font=f3,fill=(226,210,220))
    dr.text((805,575),'닫힌 입술 seam 고정 · 코–윗입술 길이 고정 · 턱은 하관만 이동',font=f3,fill=(226,210,220))
    dr.text((805,606),'ㅜ는 ㅗ보다 더 오므리고 앞으로 모으되 턱 하강은 매우 작게 제한',font=f3,fill=(226,210,220))
    dr.text((805,637),'ㅏ는 입이 벌어진 만큼 하관이 내려가고, 필트럼은 늘어나지 않도록 잠금',font=f3,fill=(226,210,220))
    dr.rectangle((50,683,1230,694), fill=(76,74,82))
    dr.rectangle((50,683,50+int(1180*progress),694), fill=(220,182,194))
    return cv2.cvtColor(np.asarray(panel),cv2.COLOR_RGB2BGR)


def encode(silent:Path, out:Path, audio:Path|None=None, duration:float|None=None):
    cmd=['ffmpeg','-y','-hide_banner','-loglevel','error','-nostdin','-i',str(silent)]
    if audio is not None:
        cmd += ['-i',str(audio),'-map','0:v:0','-map','1:a:0','-c:a','aac','-b:a','128k']
    cmd += ['-c:v','libx264','-preset','veryfast','-crf','23','-pix_fmt','yuv420p','-movflags','+faststart']
    if duration is not None: cmd += ['-t',str(duration)]
    cmd += [str(out)]
    subprocess.run(cmd,check=True)
    silent.unlink(missing_ok=True)


def render_v31_demo():
    # base neutral from user source, plus observed candidate references
    base=load_face('/mnt/data/IMG_0853.mp4',7.0)
    geom=detect_mouth_geometry(base)
    refs={
        'ㅡ': load_face('/mnt/data/IMG_0853.mp4',7.0),
        'ㅗ': load_face('/mnt/data/IMG_0853.mp4',5.0),
        'ㅜ': load_face('/mnt/data/IMG_0853.mp4',3.0),
        'ㅏ': load_face('/mnt/data/IMG_0853.mp4',1.0),
        'ㅔ': load_face('/mnt/data/IMG_0854.mp4',21.0),
    }
    specs={
        'ㅡ': dict(width_scale=1.0, upper_scale=0.94, lower_scale=0.96, jaw_drop=0.0, aperture_h=0.5, seam_strength=0.92, corner_dim=0.18),
        'ㅗ': dict(width_scale=0.74, upper_scale=1.08, lower_scale=1.05, jaw_drop=1.0, jaw_spread=-0.2, aperture_h=10.0, aperture_w=0.72, seam_strength=0.75, corner_dim=0.24),
        'ㅜ': dict(width_scale=0.60, upper_scale=1.10, lower_scale=1.04, jaw_drop=0.35, jaw_spread=-0.12, aperture_h=8.0, aperture_w=0.56, seam_strength=0.72, corner_dim=0.22),
        'ㅏ': dict(width_scale=1.02, upper_scale=1.02, lower_scale=1.12, jaw_drop=14.0, jaw_spread=0.22, aperture_h=30.0, aperture_w=1.02, seam_strength=0.40, corner_dim=0.10),
        'ㅔ': dict(width_scale=1.06, upper_scale=0.82, lower_scale=0.90, jaw_drop=3.0, jaw_spread=0.10, aperture_h=15.0, aperture_w=0.88, seam_strength=0.58, corner_dim=0.12),
    }
    notes={
        'ㅡ':'닫힌 기본선. 가장 어두운 seam line을 전체 입술 경계의 기준으로 유지.',
        'ㅗ':'원형 오므림 중심. 하관은 소폭만 관여하고, 세로로 길게 떨어뜨리지 않음.',
        'ㅜ':'ㅗ보다 더 강한 오므림·더 작은 너비. 턱 하강은 더 적고, 입술을 더 모음.',
        'ㅏ':'입을 벌린 만큼 하관이 내려감. 코–윗입술 길이는 고정.',
        'ㅔ':'ㅣ보다 조금 더 얇고, 양볼/입꼬리가 살짝 위로 가는 느낌의 입 모양.',
    }
    results={}
    for k,v in specs.items():
        img,meta=apply_v31_transform(base,geom,v)
        results[k]=(img,meta)
    # diagnostic guide image
    guide=draw_guides(base,geom,'neutral seam / philtrum lock / jaw start')
    cv2.imwrite(str(OUT/'V31_GUIDES_BASE.png'),guide)
    # sheet
    sheet=Image.new('RGB',(1000, len(results)*220),(18,18,24))
    for i,k in enumerate(results.keys()):
        left=Image.fromarray(cv2.cvtColor(cv2.resize(refs[k],(220,220)),cv2.COLOR_BGR2RGB))
        right=Image.fromarray(cv2.cvtColor(cv2.resize(results[k][0],(220,220)),cv2.COLOR_BGR2RGB))
        sheet.paste(left,(20,i*220)); sheet.paste(right,(280,i*220))
        dr=ImageDraw.Draw(sheet)
        dr.text((530,i*220+28), f'{k} · ref vs v31', fill=(240,234,240), font=ImageFont.truetype(BOLD,22))
        dr.text((530,i*220+66), notes[k], fill=(215,208,218), font=ImageFont.truetype(FONT,16))
        dr.text((530,i*220+104), f'seam {geom.width}px  jawDrop {results[k][1]["spec"].get("jaw_drop",0)}', fill=(215,208,218), font=ImageFont.truetype(FONT,16))
    sheet.save(OUT/'SONG_V31_FIX_SHEET.jpg', quality=92)
    # video
    raw=OUT/'_v31_demo_silent.mp4'
    writer=cv2.VideoWriter(str(raw),cv2.VideoWriter_fourcc(*'mp4v'),FPS,(1280,720))
    keys=list(results.keys())
    per=24
    total=per*len(keys)
    for i in range(total):
        j=i//per; alpha=(i%per)/per; k=keys[j]
        ref=refs[k]; out=results[k][0]
        if j>0 and alpha<0.2:
            t=(alpha/0.2); t=t*t*(3-2*t)
            prev=keys[j-1]
            ref=cv2.addWeighted(refs[prev],1-t,ref,t,0)
            out=cv2.addWeighted(results[prev][0],1-t,out,t,0)
        panel=panelize(ref,out,k,notes[k],(i+1)/total)
        writer.write(panel)
    writer.release()
    final=OUT/'SONG_V31_SEAM_AND_JAW_FIX_DIAGNOSTIC.mp4'
    encode(raw,final)
    # report
    report={
        'version':'SONG_V31_SEAM_JAW_CONSTRAINT_FIX',
        'baseSource':{'video':'IMG_0853.mp4','seconds':7.0},
        'referenceFrames':{'ㅡ':['IMG_0853.mp4',7.0],'ㅗ':['IMG_0853.mp4',5.0],'ㅜ':['IMG_0853.mp4',3.0],'ㅏ':['IMG_0853.mp4',1.0],'ㅔ':['IMG_0854.mp4',21.0]},
        'mouthGeometry':asdict(geom),
        'implementedFixes':[
            'darkest closed-lip seam line used as base mouth boundary',
            'philtrum and upper-face lock prevents nose-to-upper-lip elongation',
            'jaw drop applied only below lower-jaw start boundary',
            'ㅜ constrained to stronger pursing with very small jaw drop',
            'ㅏ uses large jaw drop with lower face descent'
        ],
        'notMeasured':[ 'true 3D protrusion', 'mandible rotation degrees', 'validated phoneme timing'],
        'results':[final.name,'SONG_V31_FIX_SHEET.jpg','V31_GUIDES_BASE.png']
    }
    (OUT/'SONG_V31_REPORT.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
    return final


def render_v31_am630():
    base=load_face('/mnt/data/IMG_0853.mp4',7.0)
    geom=detect_mouth_geometry(base)
    audio=Path('/mnt/data/am630.mp3')
    if not audio.exists():
        z=Path('/mnt/data/am630_original_song.zip')
        if z.exists():
            import zipfile
            with zipfile.ZipFile(z) as zz:
                with zz.open('am630.mp3') as r, open(audio,'wb') as o: o.write(r.read())
    # rough vowel sequence from lyric excerpt only (still unaligned)
    seq=[('ㅡ',12),('ㅏ',18),('ㅗ',12),('ㅜ',12),('ㅔ',14),('ㅏ',16),('ㅡ',12)]
    specs={
        'ㅡ': dict(width_scale=1.0, upper_scale=0.94, lower_scale=0.96, jaw_drop=0.0, aperture_h=0.5, seam_strength=0.92, corner_dim=0.18),
        'ㅗ': dict(width_scale=0.74, upper_scale=1.08, lower_scale=1.05, jaw_drop=1.0, jaw_spread=-0.2, aperture_h=10.0, aperture_w=0.72, seam_strength=0.75, corner_dim=0.24),
        'ㅜ': dict(width_scale=0.60, upper_scale=1.10, lower_scale=1.04, jaw_drop=0.35, jaw_spread=-0.12, aperture_h=8.0, aperture_w=0.56, seam_strength=0.72, corner_dim=0.22),
        'ㅏ': dict(width_scale=1.02, upper_scale=1.02, lower_scale=1.12, jaw_drop=14.0, jaw_spread=0.22, aperture_h=30.0, aperture_w=1.02, seam_strength=0.40, corner_dim=0.10),
        'ㅔ': dict(width_scale=1.06, upper_scale=0.82, lower_scale=0.90, jaw_drop=3.0, jaw_spread=0.10, aperture_h=15.0, aperture_w=0.88, seam_strength=0.58, corner_dim=0.12),
    }
    raw=OUT/'_am630_v31_silent.mp4'
    writer=cv2.VideoWriter(str(raw),cv2.VideoWriter_fourcc(*'mp4v'),FPS,(1100,700))
    total=sum(fr for _,fr in seq)
    idx=0
    for vowel,frames in seq:
        img,_=apply_v31_transform(base,geom,specs[vowel])
        for j in range(frames):
            panel=Image.new('RGB',(1100,700),(22,22,28)); dr=ImageDraw.Draw(panel)
            face=Image.fromarray(cv2.cvtColor(cv2.resize(img,(520,520)),cv2.COLOR_BGR2RGB))
            panel.paste(face,(42,90))
            dr.text((610,88),'AM 6:30 · v31 수정 preview',font=ImageFont.truetype(BOLD,29),fill=(237,230,238))
            dr.text((610,140),f'형태 {vowel}',font=ImageFont.truetype(BOLD,34),fill=(250,230,198))
            dr.text((610,205),'이번 preview는 가사 음절 정답 시간 없이',font=ImageFont.truetype(FONT,20),fill=(225,213,220))
            dr.text((610,235),'입술 seam / 턱 경계 수정이 잘 보이도록 만든 시험본이야.',font=ImageFont.truetype(FONT,20),fill=(225,213,220))
            dr.text((610,295),'핵심 수정:',font=ImageFont.truetype(BOLD,20),fill=(213,238,223))
            lines=['코–윗입술 길이 고정','턱은 하관에서만 하강','ㅜ는 강한 오므림 + 작은 턱 하강','닫힌 seam line 유지']
            for t,line in enumerate(lines): dr.text((632,330+t*34),f'• {line}',font=ImageFont.truetype(FONT,19),fill=(225,213,220))
            prog=(idx+1)/total
            dr.rectangle((40,670,1060,682),fill=(76,74,82)); dr.rectangle((40,670,40+int(1020*prog),682),fill=(220,182,194))
            writer.write(cv2.cvtColor(np.asarray(panel),cv2.COLOR_RGB2BGR)); idx+=1
    writer.release()
    final=OUT/'AM630_V31_CONSTRAINED_FACE_UNALIGNED.mp4'
    if audio.exists(): encode(raw,final,audio=audio,duration=6.0)
    else: encode(raw,final)
    return final

if __name__=='__main__':
    a=render_v31_demo(); b=render_v31_am630(); print(a); print(b)
