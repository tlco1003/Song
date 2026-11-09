"""Draw the actual v35 XYZ meshes into explanatory 3-D cutaway MP4s.

The right panel is a schematic mouth opening, not the owner's real face.
The cutaway exposes otherwise hidden tongue/palate/teeth surfaces.
"""
from __future__ import annotations
import math,json,subprocess
from pathlib import Path
import cv2,numpy as np
from PIL import Image,ImageDraw,ImageFont
from owner_v35_articulatory_3d import *

OUT=Path(__file__).resolve().parent/'results';OUT.mkdir(parents=True,exist_ok=True)
FONT='/usr/share/fonts/truetype/nanum/NanumGothic.ttf'
BOLD='/usr/share/fonts/truetype/nanum/NanumGothicBold.ttf'
if not Path(BOLD).exists():BOLD=FONT
FONTS={s:ImageFont.truetype(BOLD,s) for s in (18,20,22,27,34,42)}
WIDTH,HEIGHT=1440,820
FPS=14


def side_project(p):
    p=np.asarray(p)
    return np.stack([440+315*p[...,0]+132*p[...,1],385-315*p[...,2]+64*p[...,1]],axis=-1)


def _shade_mesh(image,vertices,faces,color,front_only=False):
    vertices=np.asarray(vertices);faces=np.asarray(faces)
    proj=side_project(vertices)
    n=len(vertices)
    # For open top surfaces, use top half of tongue vertices only.
    if front_only:
        n//=2
        faces=faces[np.all(faces<n,axis=1)]
    # painter's algorithm: far/behind y first
    ranks=np.mean(vertices[faces,1],axis=1)
    for idx in np.argsort(ranks)[::1]:
        f=faces[idx]
        pts=proj[f].astype(np.int32)
        if np.any(~np.isfinite(pts)):continue
        # shallow faceted shading that makes curved tongue geometry visible.
        e1=vertices[f[1]]-vertices[f[0]];e2=vertices[f[2]]-vertices[f[0]]
        nml=np.cross(e1,e2);l=np.linalg.norm(nml)
        if l<1e-8:continue
        nml=nml/l;shade=.74+.19*abs(nml[2])+.07*max(0,nml[0]);shade=float(np.clip(shade,.53,1.13))
        fill=tuple(int(np.clip(x*shade,0,255)) for x in color)
        cv2.fillConvexPoly(image,pts,fill,lineType=cv2.LINE_AA)


def draw_cutaway(c:RigControls,phi=0.):
    img=np.zeros((HEIGHT,WIDTH,3),np.uint8)
    img[:]=[34,26,25]  # BGR dark
    cv2.rectangle(img,(32,110),(877,691),(60,47,43),1,cv2.LINE_AA)
    cv2.rectangle(img,(901,110),(1408,691),(60,47,43),1,cv2.LINE_AA)
    # axes indicate real 3-D coordinates; no bone ground truth.
    origin=side_project(np.array([-.85,-.47,-.59]))
    for vec,c0,lab in [(np.array([.30,0,0]),(190,195,216),'x'),(np.array([0,.30,0]),(166,193,197),'y'),(np.array([0,0,.30]),(155,216,188),'z')]:
        end=side_project(np.array([-.85,-.47,-.59])+vec)
        cv2.arrowedLine(img,tuple(origin.astype(int)),tuple(end.astype(int)),c0,1,cv2.LINE_AA,tipLength=.15)
    geo=observed_geometry(c)
    pv,pf=geo['palate'];tv,tf=geo['tongue'];lv,lf=geo['lips']
    # bone palate is a 3-D rigid mesh (the velum part changes, not the maxilla).
    _shade_mesh(img,pv,pf,(185,199,210))
    # grid lines expose the static hard-palate arch and nasal/soft-palate separation.
    P=side_project(pv).reshape(19,9,2)
    for j in [0,2,4,6,8]:
        cv2.polylines(img,[P[:,j,:].astype(np.int32)],False,(227,225,207),1,cv2.LINE_AA)
    # Tongue: projected from real 3D surface, not a moved black oval.
    _shade_mesh(img,tv,tf,(131,117,224),front_only=True)
    # cross-sagittal dorsal tongue centerline (from the 3D mesh points).
    T=side_project(tv[:23*11].reshape(23,11,3)[:,5,:])
    cv2.polylines(img,[T.astype(np.int32)],False,(170,182,251),3,cv2.LINE_AA)
    # mandibular hinge arc: jaw line transformed in 3-D by independent hinge rotation.
    lower=geo['jawLine'];upperTeeth=geo['upperTeeth'];lowerTeeth=geo['lowerTeeth']
    j=side_project(lower)
    cv2.polylines(img,[j.astype(np.int32)],False,(215,201,197),7,cv2.LINE_AA)
    pivot=side_project([-.76,0,-.40]).astype(int)
    cv2.circle(img,tuple(pivot),9,(117,190,236),-1,cv2.LINE_AA)
    cv2.circle(img,tuple(pivot),16,(117,190,236),1,cv2.LINE_AA)
    # Teeth anchor to their own maxilla/mandible; upper teeth remain stationary.
    for pts,color in ((upperTeeth,(242,235,227)),(lowerTeeth,(232,223,220))):
        pp=side_project(pts)
        for x,y in pp:cv2.circle(img,(int(x),int(y)),4,color,-1,cv2.LINE_AA)
    # Lip mesh ring including forward protrusion (x-axis displacement).
    _shade_mesh(img,lv,lf,(168,128,216))
    rim=side_project(geo['lipOpeningContour']);cv2.polylines(img,[rim.astype(np.int32)],True,(219,179,246),2,cv2.LINE_AA)
    # front view schematic external mouth, with hidden tongue still modeled behind it
    mouth_cx=1152;mouth_cy=int(415+30*c.jaw_rad);sx=345;sz=340
    # neutral cheek/face silhouette purely illustrative (not from user's photos)
    cv2.ellipse(img,(mouth_cx,mouth_cy-20),(190,235),0,0,360,(53,45,61),-1,cv2.LINE_AA)
    cv2.ellipse(img,(mouth_cx,mouth_cy-20),(190,235),0,0,360,(85,74,93),2,cv2.LINE_AA)
    # upper tooth stripe inside lip aperture, only if there is enough space.
    outer_pts=[];inner_pts=[]
    for p in lv[:44]:
        outer_pts.append((int(mouth_cx+sx*p[1]),int(mouth_cy-sz*(p[2]+.06))))
    for p in geo['lipOpeningContour']:
        inner_pts.append((int(mouth_cx+sx*p[1]),int(mouth_cy-sz*(p[2]+.06))))
    outer_pts=np.array(outer_pts,np.int32);inner_pts=np.array(inner_pts,np.int32)
    # These are diagnostic colour surfaces: front schematic cavity, not photo compositing.
    cv2.fillPoly(img,[outer_pts],(160,111,183),lineType=cv2.LINE_AA)
    if c.lip_open>.015:
        cv2.fillPoly(img,[inner_pts],(47,29,49),lineType=cv2.LINE_AA)
        # Visible tongue shape for an open vowel; otherwise hidden behind lips/teeth.
        if c.lip_open>.13:
            a=int(mouth_cx);tongue_h=int(mouth_cy+sz*c.lip_open*.32)
            cv2.ellipse(img,(a,tongue_h),(int(sx*c.lip_width*.60),int(sz*c.lip_open*.24)),0,0,180,(138,101,211),-1,cv2.LINE_AA)
        # Upper/lower teeth in the front projection, depth occlusion is schematic.
        for y in np.linspace(-min(.23,c.lip_width*.72),min(.23,c.lip_width*.72),8):
            p=(int(mouth_cx+y*sx),int(mouth_cy-max(2,int(c.lip_open*sz*.31))))
            if c.lip_open>.07:
                cv2.rectangle(img,(p[0]-7,p[1]-1),(p[0]+7,p[1]+7),(241,236,232),-1)
    cv2.polylines(img,[inner_pts],True,(222,167,224),2,cv2.LINE_AA)
    cv2.polylines(img,[outer_pts],True,(222,176,230),2,cv2.LINE_AA)
    return img,geo


def label_frame(img,c,meta,position,total,mode):
    im=Image.fromarray(cv2.cvtColor(img,cv2.COLOR_BGR2RGB));d=ImageDraw.Draw(im)
    d.text((34,18),'SONG AI · 3D ARTICULATORY ENGINE  v35',font=FONTS[34],fill=(243,234,244))
    d.text((39,66),'3D 구강 단면 / 가려진 혀를 보여줌',font=FONTS[20],fill=(236,204,217))
    d.text((923,65),'정면 입술 개방 도식',font=FONTS[20],fill=(236,204,217))
    if mode=='vowel':
        suffix='모음별 혀 앞·뒤·높이 · 입술 돌출 · 턱 개방'
    else:suffix='자음 접촉부 · 연구개 · 후두 · 다음 모음으로 전이'
    d.text((47,121),f'{meta["label"]}    {suffix}',font=FONTS[27],fill=(243,221,194))
    d.text((48,705),f'혀 위치: 끝 {c.tip_z:.2f} / 앞 {c.blade_z:.2f} / 몸통 {c.body_z:.2f} / 뒤 {c.dorsum_z:.2f} / 뿌리 {c.root_z:.2f}',font=FONTS[18],fill=(221,210,226))
    d.text((48,733),f'턱 회전 {c.jaw_rad*180/math.pi:.1f}° (연구용 가정)   입술 폭 {c.lip_width:.2f}   돌출 {c.lip_protrusion:.2f}   연구개 열림 {c.velum_open:.2f}',font=FONTS[18],fill=(218,208,221))
    d.text((924,707),f'접촉 부위: {c.oral_closure}',font=FONTS[20],fill=(240,224,229))
    d.text((924,735),f'구강 협착 {c.oral_stricture:.2f}   성문 긴장 {c.laryngeal_tense:.2f}',font=FONTS[18],fill=(218,206,214))
    d.text((44,784),'비실측 3D 예제 · 실측 혀/치아·개인 골격 아님 · 소리 합성 아님 · 음소 시간 미검증',font=FONTS[18],fill=(249,180,164))
    d.rectangle((45,806,1390,814),fill=(78,73,82))
    d.rectangle((45,806,45+int(1345*position/max(1,total)),814),fill=(238,176,203))
    return cv2.cvtColor(np.asarray(im),cv2.COLOR_RGB2BGR)


def render(name,events,mode):
    raw=OUT/('_'+name+'.mp4');mp4=OUT/(name+'.mp4')
    writer=cv2.VideoWriter(str(raw),cv2.VideoWriter_fourcc(*'mp4v'),FPS,(WIDTH,HEIGHT))
    if not writer.isOpened():raise RuntimeError('MP4 writer could not open')
    total=sum(fr for _,fr in events);n=0;previous=None
    try:
        for target,frames in events:
            for k in range(frames):
                t=k/max(1,frames-1)
                if mode=='vowel':
                    c=vowel_pose(target,t if target in GLIDES else 1.)
                    if previous is not None and t<.20:
                        c=blend_controls(previous,c,t/.20)
                    label=f'모음  {target}'
                else:
                    onset=target
                    seq=list(syllable_motion(onset,'ㅏ',frames))
                    c=seq[k]
                    label=f'자음 {onset} → 아'
                base,geo=draw_cutaway(c)
                display=label_frame(base,c,{'label':label},n+1,total,mode)
                writer.write(display);n+=1
            previous=c
    finally:writer.release()
    subprocess.run(['ffmpeg','-y','-hide_banner','-loglevel','error','-i',str(raw),'-c:v','libx264',
          '-preset','veryfast','-crf','24','-pix_fmt','yuv420p','-movflags','+faststart',str(mp4)],check=True)
    raw.unlink(missing_ok=True)
    return mp4,total


def main():
    vowels=['ㅏ','ㅑ','ㅓ','ㅕ','ㅗ','ㅛ','ㅜ','ㅠ','ㅡ','ㅣ']
    consonants=list(ONSETS)
    p1,n1=render('SONG_V35_TONGUE_3D_TEN_VOWELS',[(v,10) for v in vowels],'vowel')
    p2,n2=render('SONG_V35_TONGUE_3D_NINETEEN_CONSONANTS',[(v,9) for v in consonants],'consonant')
    for glyph,c in [('a',vowel_pose('ㅏ')),('u',vowel_pose('ㅜ')),('o',vowel_pose('ㅗ')),
                    ('n',consonant_pose('ㄴ','ㅏ')),('m',consonant_pose('ㅁ','ㅏ')),('k',consonant_pose('ㄱ','ㅏ'))]:
        export_gltf(c,OUT/f'ARTICULATORY_3D_{glyph}.glb')
    report={
      'version':'SONG_V35_ARTICULATORY_3D_RESEARCH',
      'vowelsSupported':list(VOWELS),'onsetsSupported':list(ONSETS),'codaInventorySlots':len(CODAS),
      'simpleCodaArticulatorPlans':SIMPLE_CODA,'videos':[p1.name,p2.name],
      'frames':{'vowels':n1,'consonants':n2},'fps':FPS,
      'features':['3D tongue surface tip blade body dorsum root',
          '3D upper hard palate and descending soft palate',
          'independent 3D jaw hinge and upper/lower teeth',
          'independent 3D lips width height protrusion',
          'velum nasal port and glottal settings',
          'tongue/palate nonpenetration and contact-place targets',
          'coarticulatory consonant release vowel glides'],
      'verification':'10 geometric and phonetic contract tests on all 19 × 21 onset-vowel pairs',
      'limitations':anatomical_status(),
      "referenceData":"published phonetic place/manner + normalized prototype authoring, NOT an individual's 3D tissue measurements"
    }
    (OUT/'SONG_V35_ARTICULATORY_REPORT.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
    print(json.dumps({'videoVowels':str(p1),'videoConsonants':str(p2),'frames':[n1,n2],'glbs':len(list(OUT.glob('*.glb')))},ensure_ascii=False))

if __name__=='__main__':main()
