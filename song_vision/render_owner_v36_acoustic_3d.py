"""Diagnostic video: owner source SPEAKING audio vs hidden 3D tongue tube resonances.

It does not claim the 3D tongue mesh was observed; right panel contrasts rough
acoustic resonances with unverified LPC formant candidates from owner's audio.
"""
from __future__ import annotations
import sys,json,subprocess
from pathlib import Path
import numpy as np,cv2
from PIL import Image,ImageDraw,ImageFont
BASE_DIR=Path(__file__).resolve().parent
if not (BASE_DIR/'render_owner_v35_3d.py').exists():
    sys.path.insert(0,str(BASE_DIR.parent/'song_v35_articulatory'))
from owner_v35_articulatory_3d import vowel_pose,blend_controls,consonant_pose,ONSETS,VOWELS,CONSONANTS
from render_owner_v35_3d import draw_cutaway
from owner_v36_acoustic_articulation import airway_from_pose,formant_candidates,phoneme_signature

BASE=Path(__file__).resolve().parent;OUT=BASE/'results';OUT.mkdir(parents=True,exist_ok=True)
FONT='/usr/share/fonts/truetype/nanum/NanumGothic.ttf'
BOLD='/usr/share/fonts/truetype/nanum/NanumGothicBold.ttf'
F26=ImageFont.truetype(BOLD,26);F21=ImageFont.truetype(FONT,21);F17=ImageFont.truetype(FONT,17);F34=ImageFont.truetype(BOLD,34)
VOWELS10=['ㅏ','ㅑ','ㅓ','ㅕ','ㅗ','ㅛ','ㅜ','ㅠ','ㅡ','ㅣ']
FR=15;WIDTH=1720;HEIGHT=890


def smooth(t):
    t=np.clip(float(t),0.,1.);return t*t*(3-2*t)


def acoustic_area_panel(areas,model,recorded):
    """Draw normalized tract-area diagram, not anatomical CT ground truth."""
    panel=Image.new('RGB',(370,410),(31,29,39));d=ImageDraw.Draw(panel)
    d.text((12,9),'성도 단면적 모델 (가정)',font=F21,fill=(235,226,235))
    coords=np.asarray(areas,float)
    maxy=max(6.6,coords.max())
    for tick in np.arange(0,6.1,2):
        y=215-int(tick/maxy*139)
        d.line((36,y,357,y),fill=(77,67,83),width=1)
        d.text((2,y-12),str(tick),font=F17,fill=(183,168,183))
    pts=[(36+int(i/(len(coords)-1)*320),215-int(v/maxy*139)) for i,v in enumerate(coords)]
    d.line(pts,fill=(113,209,218),width=3,joint='curve')
    d.text((45,224),'성문 → 혀 → 입술',font=F17,fill=(212,215,216))
    if len(model)>=2:
        d.text((12,271),f'3D→성도 계산: {model[0]} / {model[1]} Hz',font=F17,fill=(192,223,237))
    vals=(recorded.get('F1candidateHz'),recorded.get('F2candidateHz'))
    a='?' if vals[0] is None else str(vals[0]);b='?' if vals[1] is None else str(vals[1])
    d.text((12,304),f'원본 음성 후보: {a} / {b} Hz',font=F17,fill=(245,210,178))
    if vals[1] is None:d.text((12,339),'F2 검출 불확실',font=F17,fill=(255,155,146))
    elif len(model)>1 and abs(vals[1]-model[1])>=500:
        d.text((12,339),'F2 오차 큼 · 모델 미검증',font=F17,fill=(255,155,146))
    else:d.text((12,339),'개인 혀 모양 검증은 미완료',font=F17,fill=(255,155,146))
    return panel


def render_owner_vowels(video:Path,results:Path):
    data=json.loads((results/'SONG_V36_OWNER_AUDIO_COMPARISON_PRIVATE.json').read_text())
    records=data['vowels'];start=2.1;end=11.25
    cap=cv2.VideoCapture(str(video));cap.set(cv2.CAP_PROP_POS_MSEC,start*1000)
    silent=results/'_SONG_V36_OWNER_ACOUSTIC_3D_NO_AUDIO.mp4'
    wr=cv2.VideoWriter(str(silent),cv2.VideoWriter_fourcc(*'mp4v'),FR,(WIDTH,HEIGHT))
    if not wr.isOpened():raise RuntimeError('Could not open MP4 writer')
    total=int((end-start)*FR)
    idx=0;neutral=vowel_pose('ㅡ')
    for n in range(total):
        t=start+n/FR
        # Video input kept in its original recording time coordinates.
        cap.set(cv2.CAP_PROP_POS_MSEC,t*1000)
        good,face=cap.read()
        if not good:break
        while idx+1<len(records) and t>records[idx]['endSec']+.2:idx+=1
        item=records[idx];target=item['vowel']
        a=item['startSec'];b=item['endSec'];phase=(t-a)/max(.1,b-a)
        p=float(np.clip(phase,0,1))
        vpose=vowel_pose(target,p)
        gate=smooth((t-(a-.12))/.25)*smooth(((b+.14)-t)/.24)
        pose=blend_controls(neutral,vpose,gate)
        visual,_=draw_cutaway(pose)
        # 3D side-cutaway (left) & real owner face (center) and tract (right).
        cut=cv2.resize(visual[105:700,33:885],(920,612))
        cut=Image.fromarray(cv2.cvtColor(cut,cv2.COLOR_BGR2RGB))
        real=Image.fromarray(cv2.cvtColor(cv2.resize(face,(360,360)),cv2.COLOR_BGR2RGB))
        f=airway_from_pose(pose)
        predicted=formant_candidates(airway_from_pose(vowel_pose(target,1)))
        graph=acoustic_area_panel(f.areas_cm2,predicted,item['acoustic'])
        bg=Image.new('RGB',(WIDTH,HEIGHT),(26,23,35));d=ImageDraw.Draw(bg)
        bg.paste(cut,(20,123));bg.paste(real,(954,140));bg.paste(graph,(1335,115))
        d.text((32,18),'SONG AI v36 · 소리와 혀 3D 조음 대조',font=F34,fill=(246,232,239))
        d.text((36,72),'3D 모형의 가려진 혀 / 실제 사용자 Speaking 원본 / 성도 공명 후보',font=F21,fill=(233,211,222))
        d.text((970,520),f"발음 순서 후보: {item['userReportedSyllable']}  ({target})",font=F26,fill=(247,213,185))
        d.text((970,558),f'원본 {a:.2f}~{b:.2f}초',font=F21,fill=(233,217,222))
        d.text((32,766),'왼쪽 3D는 연구용 가정치. 실제 음성의 스펙트럼값과 다르면 혀 모양 정답으로 사용하지 않아.',font=F21,fill=(245,206,204))
        d.text((32,807),'가려진 개인 혀 미관측 · 1D 성도 음향 단순화 · 음소 시간 미검증 · 원본 오디오는 실제 사용자 발음',font=F17,fill=(210,202,212))
        d.rectangle((32,855,1688,866),fill=(84,77,90))
        d.rectangle((32,855,32+int(1656*((n+1)/total)),866),fill=(240,178,195))
        wr.write(cv2.cvtColor(np.asarray(bg),cv2.COLOR_RGB2BGR))
    wr.release();cap.release()
    out=results/'SONG_V36_3D_TONGUE_VS_REAL_VOICE.mp4'
    subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-nostdin','-i',str(silent),
       '-ss',str(start),'-t',str(end-start),'-i',str(video),'-map','0:v:0','-map','1:a:0',
       '-c:v','libx264','-preset','veryfast','-crf','24','-pix_fmt','yuv420p',
       '-c:a','aac','-b:a','96k','-shortest','-movflags','+faststart',str(out)],check=True)
    silent.unlink(missing_ok=True)
    return out


def render_consonant_contacts(results:Path):
    # All 19 modern Korean initial consonants, plus 21 medials in data tests.
    vowels='ㅏ';items=list(ONSETS);per=8
    silent=results/'_SONG_V36_CONSONANTS_SILENT.mp4'
    w=cv2.VideoWriter(str(silent),cv2.VideoWriter_fourcc(*'mp4v'),FR,(WIDTH,HEIGHT))
    rows=[]
    for i,c in enumerate(items):
        facts=phoneme_signature(c,'ㅏ')
        rows.append(facts)
        for k in range(per):
            phase=k/max(1,per-1)
            pose=consonant_pose(c,'ㅏ',release_progress=max(0,min(1,(phase-.23)/.58)))
            img,_=draw_cutaway(pose)
            left=Image.fromarray(cv2.cvtColor(cv2.resize(img[105:700,35:890],(1030,650)),cv2.COLOR_BGR2RGB))
            tract=airway_from_pose(pose)
            graph=acoustic_area_panel(tract.areas_cm2,[],{'F1candidateHz':None,'F2candidateHz':None})
            bg=Image.new('RGB',(WIDTH,HEIGHT),(25,24,34));d=ImageDraw.Draw(bg)
            bg.paste(left,(20,120));bg.paste(graph,(1315,128))
            d.text((34,25),'SONG AI v36 · 한국어 초성 19개 3D 접촉·성문 제어',font=F34,fill=(244,234,240))
            d.text((45,80),f'{c} → ㅏ   {facts["onsetPlace"]}  /  {facts["onsetManner"]}',font=F26,fill=(253,224,195))
            d.text((1038,580),f'입술 닫힘: {facts["lipSealed"]}',font=F21,fill=(229,213,228))
            d.text((1038,616),f'연구개 열림: {facts["velumOpen"]}',font=F21,fill=(229,213,228))
            d.text((1038,652),f'기식 프리셋: {facts["glottalAspirationPreset"]:.1f}',font=F21,fill=(229,213,228))
            d.text((1038,688),f'후두 긴장: {facts["laryngealTensePreset"]:.1f}',font=F21,fill=(229,213,228))
            d.text((35,805),'3D 접촉 예제 · 발화·소리합성 아님 · 비강 분지 음향 및 기식·VOT 음향 합성은 아직 미구현',font=F17,fill=(245,181,171))
            d.rectangle((32,855,1688,867),fill=(80,76,87))
            d.rectangle((32,855,32+int(1656*(i*per+k+1)/(len(items)*per)),867),fill=(232,179,197))
            w.write(cv2.cvtColor(np.asarray(bg),cv2.COLOR_RGB2BGR))
    w.release()
    p=results/'SONG_V36_19_CONSONANT_CONTACT_AND_AIRWAY.mp4'
    subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-nostdin','-i',str(silent),'-c:v','libx264','-preset','veryfast','-crf','25','-pix_fmt','yuv420p','-movflags','+faststart',str(p)],check=True)
    silent.unlink(missing_ok=True)
    (results/'SONG_V36_CONSONANT_3D_SIGNATURES.json').write_text(json.dumps({'source':'v35 stylized presets','owner3DTongueObserved':False,'nasalBranchAcousticsSimulated':False,'consonants':rows},ensure_ascii=False,indent=2))
    return p

if __name__=='__main__':
    import argparse
    parser=argparse.ArgumentParser()
    parser.add_argument('--owner-video',type=Path,required=True)
    parser.add_argument('--output',type=Path,default=OUT)
    args=parser.parse_args()
    p=render_owner_vowels(args.owner_video,args.output);print('owner video',p,p.stat().st_size)
    p2=render_consonant_contacts(args.output);print('consonant video',p2,p2.stat().st_size)
