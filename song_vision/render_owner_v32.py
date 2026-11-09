from __future__ import annotations
from pathlib import Path
import sys,json,subprocess
import cv2,numpy as np
from PIL import Image,ImageDraw,ImageFont
from owner_v32_oral_segmentation import OwnerMouthAtlas,extract_owner_atlas,render_actual_owner_pixels,extract_anatomical_appearance_layers,CANDIDATE_STATES
from owner_v32_3d_contract import default_neutral,export_3d_job_contract,optional_mediapipe_adapter
from korean_phone_contract_v32 import create_pending_annotations,inventory_report,all_isolated_jamo_annotation_rows

ROOT=Path(__file__).resolve().parent; OUT=ROOT/'results';OUT.mkdir(parents=True,exist_ok=True)
FONT='/usr/share/fonts/truetype/nanum/NanumSquareR.ttf'
BOLD='/usr/share/fonts/truetype/nanum/NanumSquareB.ttf'
F=ImageFont.truetype(BOLD,26);M=ImageFont.truetype(FONT,18);SM=ImageFont.truetype(FONT,14)


def crop_mouth(im,cy=238):
    h,w=im.shape[:2]
    return cv2.resize(im[max(0,cy-37):min(h,cy+36),82:238],(360,170),interpolation=cv2.INTER_CUBIC)


def interpolate_face(a,b,progress):
    """Appearance transition; not a demonstrated biomechanical path."""
    t=float(np.clip(progress,0,1));t=t*t*(3-2*t)
    # all movement is sourced from two actual owner frames. upper face fixed.
    return cv2.addWeighted(a,1-t,b,t,0)


def highlight_sources(frame,mask_layers):
    img=frame.copy().astype(np.float32)
    # Visual annotation ONLY; never used in output face rendering
    for key,color,weight in [('innerDarkCavity',(35,225,245),.28),('teethCandidate',(235,210,65),.27),('tongueCandidate',(175,75,235),.20)]:
        m=mask_layers[key]>0
        if np.count_nonzero(m):
            img[m]=img[m]*(1-weight)+np.array(color)[None,:]*weight
    return np.clip(img,0,255).astype(np.uint8)


def canvas_frame(base,rendered,marked,state,vowel,t,notes,obs):
    W,H=1260,680
    panel=Image.new('RGB',(W,H),(27,23,33));d=ImageDraw.Draw(panel)
    positions=[(45,116),(442,116),(840,116)]
    for im,xy in zip([base,rendered,marked],positions):
        rgb=Image.fromarray(cv2.cvtColor(im,cv2.COLOR_BGR2RGB)).resize((365,365))
        panel.paste(rgb,xy)
    for label,x in [('정지 원본',45),('v32 실제 구강 픽셀',442),('분할 후보 시각화',840)]:
        d.text((x,68),label,font=F,fill=(240,232,238))
    d.text((45,19),'SONG-VISION v32 · INNER ORAL BOUNDARY · OWNER SPEAKING',font=M,fill=(231,199,219))
    d.text((45,505),f'모양 목표: {vowel}  · 원본 형태: {state}',font=F,fill=(243,218,187))
    d.text((45,550),notes,font=M,fill=(237,226,236))
    d.text((45,586),f'검출된 어두운 구강 후보 {obs["detectedDarkCavityPx"]} px  /  안쪽 경계 후보 {obs["innerOpeningWidthPx"] or "미확인"} × {obs["innerOpeningHeightPx"] or "미확인"} px',font=M,fill=(232,215,222))
    d.text((45,620),'발음 정답 라벨 미검증 · 의학적 분할 미검증 · 개인 3D 골격 미학습 · 검은 타원 합성 없음',font=SM,fill=(245,177,166))
    d.rectangle((45,653,1215,662),fill=(73,65,79))
    d.rectangle((45,653,45+int(1170*t),662),fill=(233,187,210))
    return cv2.cvtColor(np.asarray(panel),cv2.COLOR_RGB2BGR)


def export():
    atlas,records=extract_owner_atlas(Path('/mnt/data'),OUT)
    candidates=['ㅡ','ㅗ','ㅜ','ㅏ','ㅔ','ㅣ','ㅓ']
    descriptions={'ㅡ':'실제 닫힌 입술선 · 구강이 보이지 않으면 미확인 처리',
        'ㅗ':'둥글게 벌린 실제 원본 형태 · 소리 정답은 아직 없음',
        'ㅜ':'작고 강하게 오므린 실제 원본 형태 · 턱의 인공 하강 없음',
        'ㅏ':'실제로 크게 벌어진 원본 입 · 혀·치아·하관 픽셀 그대로',
        'ㅔ':'가로로 펼친 원본 · 입술 두께 정답은 미검증',
        'ㅣ':'가로로 펼친 원본 · ㅔ와 서로 다른 정답은 아직 없음',
        'ㅓ':'실제로 적당히 벌어진 입 · 어두운 구강 영역 추적'}
    cache={}
    for v in candidates:
        im,meta=render_actual_owner_pixels(atlas,v)
        role=meta['observedShapeRole']
        layers,laymeta=extract_anatomical_appearance_layers(atlas.images[role],role)
        marked=highlight_sources(atlas.images[role],layers)
        cache[v]=(im,marked,meta,laymeta)
    # smooth display-only fades; contours and oral pixels always come from observed frames.
    fps=15;hold=.93;dur=hold*len(candidates)
    raw=OUT/'_v32_uncompressed.mp4'
    writer=cv2.VideoWriter(str(raw),cv2.VideoWriter_fourcc(*'mp4v'),fps,(1260,680))
    if not writer.isOpened():raise RuntimeError('MP4 writer unavailable')
    for j,v in enumerate(candidates):
        im,marked,meta,lay=cache[v]
        for k in range(round(fps*hold)):
            t=k/round(fps*hold)
            if j>0 and t<.26:
                a=t/.26
                prev=cache[candidates[j-1]]
                view=interpolate_face(prev[0],im,a)
                labels=interpolate_face(prev[1],marked,a)
            else:view=im;labels=marked
            obs=records[meta['observedShapeRole']]
            frame=canvas_frame(atlas.base,view,labels,meta['observedShapeRole'],v,
                (j+t)/len(candidates),descriptions[v],obs)
            writer.write(frame)
    writer.release()
    video=OUT/'SONG_V32_REAL_INNER_ORAL_PIXELS_DIAGNOSTIC.mp4'
    subprocess.run(['ffmpeg','-y','-hide_banner','-loglevel','error','-i',str(raw),'-c:v','libx264','-preset','veryfast','-crf','23','-pix_fmt','yuv420p','-movflags','+faststart',str(video)],check=True)
    raw.unlink(missing_ok=True)
    # visual QA still frames include actual owner image, natural mouth and segmentation proxies
    rows=[]
    for v in candidates:
        im,mark,meta,lay=cache[v]
        rows.append(cv2.hconcat([atlas.base,im,mark]))
    cv2.imwrite(str(OUT/'SONG_V32_OWNER_ORAL_ATLAS_COMPARISON.jpg'),cv2.vconcat(rows))
    alignment=create_pending_annotations('어두운 밤이 지나면 아침은 다시 찾아오겠지','am630.mp3',25)
    (OUT/'AM630_V32_HUMAN_PHONE_LABELS_PENDING.json').write_text(json.dumps(alignment,ensure_ascii=False,indent=2))
    (OUT/'ALL_HANGUL_JAMO_REVIEW_PENDING.json').write_text(json.dumps({
        'summary':inventory_report(),'isolatedJamo':all_isolated_jamo_annotation_rows(),
        'all11172SyllablesSupportedAlgorithmically':True,'phonemeLabelsVerified':False},ensure_ascii=False,indent=2))
    (OUT/'OWNER_V32_3D_FIT_PENDING.json').write_text(json.dumps(export_3d_job_contract('owner-speaking-v32',default_neutral()),ensure_ascii=False,indent=2))
    report={'version':'SONG-Vision v32','videosUsed':['IMG_0853.mp4','IMG_0854.mp4'],
       'renderedVideo':video.name,'fps':fps,'roughDurationSec':dur,
       'primaryModelUsed':'OwnerMouthAtlas v26 observed RGB mouth frames',
       'observableOralMasks':{k:{'darkPixels':v['detectedDarkCavityPx'],'boundaryReliableCandidate':v['reliableBoundary'],
              'widthPx':v['innerOpeningWidthPx'],'heightPx':v['innerOpeningHeightPx']} for k,v in records.items()},
       'labelCoverage':inventory_report(),'3DAdapter':optional_mediapipe_adapter(),
       'noBlackEllipseHole':True,'realOwnerOralPixelsDisplayed':True,
       'phonemeSpecificModelTrained':False,'3DFaceMeshFitted':False,
       'jawBoneAngleMeasured':False,'medicalSegmentationValidated':False,
       'claims':'2D observed-appearance prototype + 3D schema, not trained anatomical 3D or verified lipsync',
       'limitations':['dark pixels are not entire mouth aperture','tooth and tongue color layers are unverified candidates',
         'source frames have unverified vowel labels','inter-frame crossfade is not physically plausible 3D animation']}
    (OUT/'SONG_V32_VALIDATION_REPORT.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
    print(json.dumps({'video':str(video),'videoBytes':video.stat().st_size,'sourceStates':len(records),'annotationSlots':len(alignment['frames']),
        '3Dready':report['3DAdapter']['ready']},ensure_ascii=False,indent=2))

if __name__=='__main__':export()
