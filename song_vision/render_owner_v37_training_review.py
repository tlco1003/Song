"""Actual owner video and owner-trained audio -> constrained 3D jaw/tongue prior.

This diagnostic intentionally keeps original photographed skin/lips unchanged.
It is NOT an artificially reanimated face nor measured personal hidden tongue.
"""
from __future__ import annotations
import json,math,subprocess,sys
from pathlib import Path
from dataclasses import replace
import cv2,numpy as np,soundfile as sf
from PIL import Image,ImageDraw,ImageFont
from owner_v37_runtime_3d import LearnedOwnerArticulator
from owner_v35_articulatory_3d import palate_height, tongue_mesh,teeth_points,jaw_lines,vowel_pose
from owner_v36_audio_inverse import detect_speech_segments

BASE=Path(__file__).resolve().parent;RESULTS=BASE/'results'
FONT='/usr/share/fonts/truetype/nanum/NanumSquareR.ttf';BOLD='/usr/share/fonts/truetype/nanum/NanumSquareB.ttf'
W,H,FPS=1280,720,20


def draw_oral_rig(state):
    # X = posterior(-) -> anterior(+), Z vertical. Y mirrored slightly for 3D illusion.
    canvas=Image.new('RGB',(655,425),(20,26,36));dr=ImageDraw.Draw(canvas)
    def proj(x,z):return (int(335+275*x),int(205-245*z))
    dr.rounded_rectangle((5,5,650,420),10,outline=(63,71,87),width=2)
    xs=np.linspace(-.76,.85,48)
    roof=[proj(x,float(palate_height(x,0,state.velum_open))) for x in xs]
    dr.line(roof,fill=(238,211,181),width=8,joint='curve')
    dr.text((50,16),'경구개 / 연구개 (추정 모형)',fill=(230,202,178),font=ImageFont.truetype(FONT,15))
    vertices,faces,check=tongue_mesh(state,nx=23,ny=11)
    top=vertices[:23*11].reshape(23,11,3)
    bottom=vertices[23*11:].reshape(23,11,3)
    edge_top=[proj(*[p[0],p[2]]) for p in top[:,5,:]]
    edge_bottom=[proj(*[p[0],p[2]]) for p in bottom[::-1,5,:]]
    dr.polygon(edge_top+edge_bottom,fill=(181,96,116),outline=(246,146,164))
    dr.line(edge_top,fill=(253,165,176),width=4,joint='curve')
    for i in (2,7,12,17,21):
        x,z=top[i,5,0],top[i,5,2]
        x0,y0=proj(x,z);dr.ellipse((x0-4,y0-4,x0+4,y0+4),fill=(250,206,216))
    jaw=jaw_lines(state)
    dr.line([proj(row[0],row[2]) for row in jaw],fill=(105,218,238),width=5,joint='curve')
    up,low=teeth_points(state)
    for tooth in up:
        x,y=proj(tooth[0],tooth[2]);dr.ellipse((x-3,y-3,x+3,y+3),fill=(250,248,237))
    for tooth in low:
        x,y=proj(tooth[0],tooth[2]);dr.ellipse((x-3,y-3,x+3,y+3),fill=(213,232,244))
    # Lips locations illustrate pose: unlike mouth hole overlay, these are only within rig panel.
    lip_x=.92+.11*state.lip_protrusion
    upper=proj(lip_x,.12);lower=proj(lip_x,.12-state.lip_open)
    dr.ellipse((upper[0]-9,upper[1]-5,upper[0]+7,upper[1]+5),fill=(238,142,157))
    dr.ellipse((lower[0]-9,lower[1]-5,lower[0]+7,lower[1]+5),fill=(238,142,157))
    f=ImageFont.truetype(FONT,16)
    dr.text((27,334),'분홍: 가려진 혀 3D 연구 모형',font=f,fill=(250,195,206))
    dr.text((27,366),'청색: 학습값이 연결된 턱 회전 제어',font=f,fill=(128,224,240))
    dr.text((27,395),'흰색: 윗니 고정 · 아랫니 이동',font=f,fill=(225,223,221))
    return canvas


def render(video,out,results=RESULTS):
    out.parent.mkdir(parents=True,exist_ok=True)
    model=LearnedOwnerArticulator(results/'OWNER_V37_AV_MODEL_PRIVATE.npz',results/'OWNER_V37_RIG_MAPPING.json')
    wav,sr=sf.read(results/'_owner_audio_local_only.wav')
    groups=detect_speech_segments(wav,sr)
    first=groups[0]
    assert len(first)==10
    cap=cv2.VideoCapture(str(video));raw=out.with_name('_owner_v37_silent.mp4');wavout=out.with_name('_owner_v37_audio.wav')
    writer=cv2.VideoWriter(str(raw),cv2.VideoWriter_fourcc(*'mp4v'),FPS,(W,H))
    if not writer.isOpened():raise RuntimeError('video writer failed')
    fontT=ImageFont.truetype(BOLD,28);fontH=ImageFont.truetype(BOLD,42);fontS=ImageFont.truetype(FONT,18)
    vowels=list('ㅏㅑㅓㅕㅗㅛㅜㅠㅡㅣ');chars=list('아야어여오요우유으이')
    report=[];sound=[]
    for j,(a,b) in enumerate(first):
        vowel=vowels[j];pred=model.predict_rig(wav,sr,a,b,vowel=vowel)
        base=vowel_pose(vowel);state=replace(base,jaw_rad=float(pred['rigControls']['jaw_rad']),
                     lip_open=float(pred['rigControls']['lip_open']),lip_width=float(pred['rigControls']['lip_width']))
        frames=max(6,int(np.ceil((b-a+.14)*FPS)))
        start=max(0,a-.07)
        segment=wav[int(start*sr):int((start+frames/FPS)*sr)]
        desired=int(frames/FPS*sr)
        if len(segment)<desired:segment=np.pad(segment,(0,desired-len(segment)))
        else:segment=segment[:desired]
        sound.append(segment)
        for k in range(frames):
            t=start+k/FPS
            cap.set(cv2.CAP_PROP_POS_MSEC,t*1000)
            ok,fr=cap.read()
            if not ok:continue
            # Real skin/face is unmodified, demonstrating observation not fake facial synthesis.
            face=Image.fromarray(cv2.cvtColor(fr,cv2.COLOR_BGR2RGB)).resize((500,500))
            chunk=wav[max(0,int((t-.024)*sr)):min(len(wav),int((t+.024)*sr))]
            loud=float(np.sqrt(np.mean(chunk**2))) if len(chunk) else 0.
            # Motion follows actual local audio dynamic, base normalized per vowel.
            energy=np.clip(loud/(np.sqrt(np.mean(segment**2))+1e-6),.55,1.25)
            motion=replace(state,jaw_rad=min(.39,state.jaw_rad*(.77+.23*energy)),
                           lip_open=min(.4,state.lip_open*(.8+.2*energy)))
            side=draw_oral_rig(motion)
            panel=Image.new('RGB',(W,H),(26,25,36));dr=ImageDraw.Draw(panel)
            panel.paste(face,(24,97));panel.paste(side,(599,122))
            dr.text((25,23),'SONG AI v37 · 내 실제 음성으로 학습한 입·턱 제어',font=fontT,fill=(247,234,242))
            dr.text((544,88),f'{chars[j]} ({vowel})',font=fontH,fill=(255,217,197))
            dr.text((25,615),'왼쪽: 원본 실제 얼굴·목소리 (변형 없음)',font=fontS,fill=(245,229,234))
            dr.text((600,575),f'학습 기반 턱 제어값 {motion.jaw_rad:.3f} rad · 입 개방 {motion.lip_open:.3f}',font=fontS,fill=(225,229,237))
            dr.text((600,603),'혀 위치 = 논문 참고 조음 사전값 (개인 측정 아님)',font=fontS,fill=(247,198,203))
            dr.text((24,657),'발음 라벨은 사용자 순서 기반 임시 후보 · 실제 혀/턱뼈 3D 정답 미확인 · 시각 특징 예측 시험본',font=fontS,fill=(231,205,219))
            dr.rectangle((24,693,1252,701),fill=(87,75,89))
            dr.rectangle((24,693,24+round(1228*(j+k/max(frames,1))/10),701),fill=(226,161,184))
            writer.write(cv2.cvtColor(np.asarray(panel),cv2.COLOR_RGB2BGR))
        report.append({'weakSyllable':chars[j],'weakVowel':vowel,'startSec':round(a,3),'endSec':round(b,3),
                      'jawProxyRad':pred['jawRotationProxyRad'],'resonanceCandidatesHz':pred['simulatedResonanceCandidatesHz'][:3],
                      'owner3DTongueMeasured':False,'phoneTimeHumanVerified':False})
    cap.release();writer.release()
    sf.write(wavout,np.concatenate(sound),sr)
    subprocess.run(['ffmpeg','-y','-loglevel','error','-nostdin','-i',str(raw),'-i',str(wavout),
                    '-map','0:v:0','-map','1:a:0','-c:v','libx264','-preset','veryfast','-crf','24',
                    '-pix_fmt','yuv420p','-c:a','aac','-b:a','96k','-shortest','-movflags','+faststart',str(out)],check=True)
    raw.unlink(missing_ok=True);wavout.unlink(missing_ok=True)
    (results/'OWNER_V37_FIRST_TEN_INFERENCE_PRIVATE.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
    print('Video:',out,'bytes:',out.stat().st_size)

if __name__=='__main__':
    import argparse
    ap=argparse.ArgumentParser()
    ap.add_argument('--video',type=Path,required=True)
    ap.add_argument('--results',type=Path,required=True)
    ap.add_argument('--output',type=Path,required=True)
    args=ap.parse_args()
    render(args.video,args.output,args.results)
