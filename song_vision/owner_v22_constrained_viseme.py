from __future__ import annotations

"""SONG-Vision v22 constrained text-first viseme prototype.

Goal: keep deformations inside the facial surface, protect rigid/boundary zones,
and apply jaw/cheek/lower-eye motion in a constrained, anatomy-inspired way.
This is still a 2D rig, not a true muscle/bone simulator.

New in v22:
- face-boundary mask and distance-falloff
- rigid-zone protection (forehead, nose bridge, outer contour)
- boundary lock band
- jaw-hinge-inspired lower-face rotation field
- optional owner-video learning of region-wise motion caps from optical flow
"""

import json, math, unicodedata
from dataclasses import dataclass
from pathlib import Path
from typing import Sequence

import cv2
import numpy as np

ONSETS = tuple("ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ")
VOWELS = tuple("ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ")
CODAS = ("",) + tuple("ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ")
TEN_VOWELS = tuple("ㅏㅑㅓㅕㅗㅛㅜㅠㅡㅣ")

VOWEL_PRIORS = {
    "ㅏ": (.92,.08,.35,.06,.92),
    "ㅓ": (.73,.10,.26,.06,.73),
    "ㅗ": (.48,.89,.12,.71,.48),
    "ㅜ": (.27,.95,.07,.92,.29),
    "ㅡ": (.24,.07,.40,.03,.22),
    "ㅣ": (.27,.02,.97,.01,.26),
    "ㅐ": (.61,.07,.74,.03,.58),
    "ㅔ": (.55,.07,.76,.03,.54),
}
GLIDES = {"ㅑ":"ㅏ","ㅕ":"ㅓ","ㅛ":"ㅗ","ㅠ":"ㅜ"}
OTHER_VOWELS = {"ㅒ":"ㅐ","ㅖ":"ㅔ","ㅘ":"ㅏ","ㅙ":"ㅐ","ㅚ":"ㅔ","ㅝ":"ㅓ","ㅞ":"ㅔ","ㅟ":"ㅣ","ㅢ":"ㅣ"}
W_GLIDES = set("ㅘㅙㅚㅝㅞㅟ")
BILABIAL_ONSET = {"ㅁ", "ㅂ", "ㅃ", "ㅍ"}
BILABIAL_CODA = {"ㅁ", "ㅂ", "ㅄ", "ㅍ"}


@dataclass(frozen=True)
class Pose:
    opening: float = .06
    rounding: float = .08
    spreading: float = .12
    protrusion: float = .02
    jaw: float = .07
    def blend(self, other: "Pose", weight: float) -> "Pose":
        t=float(np.clip(weight,0.,1.))
        return Pose(*(a+(b-a)*t for a,b in zip(self.values(), other.values())))
    def values(self):
        return (self.opening,self.rounding,self.spreading,self.protrusion,self.jaw)

REST = Pose()
TARGETS = {k:Pose(*v) for k,v in VOWEL_PRIORS.items()}

@dataclass(frozen=True)
class Syllable:
    glyph: str
    onset: str
    vowel: str
    coda: str

@dataclass(frozen=True)
class Interval:
    syllable: Syllable
    start: float
    end: float
    source: str


def smooth(x:float)->float:
    y=float(np.clip(x,0,1)); return y*y*(3-2*y)


def syllables(text: str) -> tuple[Syllable,...]:
    out=[]
    for ch in unicodedata.normalize('NFC',text):
        if ch in VOWELS:
            out.append(Syllable(ch,"ㅇ",ch,"")); continue
        code=ord(ch)-0xAC00
        if 0<=code<11172:
            o,rem=divmod(code,21*28); v,c=divmod(rem,28)
            out.append(Syllable(ch,ONSETS[o],VOWELS[v],CODAS[c])); continue
        if ch in " \n\t\r,.!?;:·—-…'\"()[]":
            continue
        raise ValueError(f"Unrecognized Hangul lyric symbol {ch!r}")
    if not out: raise ValueError("No recognized Hangul syllables/vowels")
    return tuple(out)


def preview_intervals(text: str, each_seconds: float=.85, offset: float=0.) -> tuple[Interval,...]:
    if not (.20<=each_seconds<=4 and math.isfinite(offset) and offset>=0):
        raise ValueError('Invalid preview spacing')
    return tuple(Interval(p,offset+i*each_seconds,offset+(i+1)*each_seconds,
                          'auto_preview_NOT_ALIGNED') for i,p in enumerate(syllables(text)))


def vowel_pose(vowel: str, fraction: float) -> Pose:
    f=float(np.clip(fraction,0.,1.))
    if vowel in TARGETS: return TARGETS[vowel]
    if vowel in GLIDES:
        return TARGETS['ㅣ'].blend(TARGETS[GLIDES[vowel]], smooth(np.clip(f/.35,0,1)))
    if vowel in OTHER_VOWELS:
        start='ㅜ' if vowel in W_GLIDES else ('ㅡ' if vowel=='ㅢ' else 'ㅣ')
        return TARGETS[start].blend(TARGETS[OTHER_VOWELS[vowel]], smooth(np.clip(f/.35,0,1)))
    raise ValueError(f"No viseme profile for {vowel}")


def pose_at(intervals:Sequence[Interval], seconds:float, energy:float|None=None):
    row=next((x for x in intervals if x.start<=seconds<x.end),None)
    if row is None:
        return REST,{'status':'REST','alignmentVerified':False,'glyph':'','vowel':''}
    f=(seconds-row.start)/(row.end-row.start)
    pose=vowel_pose(row.syllable.vowel, f)
    if row.syllable.onset in BILABIAL_ONSET and f<.13:
        pose=Pose(.015,pose.rounding,.22,pose.protrusion,.015).blend(pose,smooth(f/.13))
    if row.syllable.coda in BILABIAL_CODA and f>.82:
        pose=pose.blend(Pose(.025,pose.rounding,.18,pose.protrusion,.03), smooth((f-.82)/.18))
    idx=intervals.index(row)
    if f<.10:
        if idx>0 and abs(intervals[idx-1].end-row.start)<.03:
            prev=vowel_pose(intervals[idx-1].syllable.vowel,1.)
            if intervals[idx-1].syllable.coda in BILABIAL_CODA:
                prev=Pose(.025,prev.rounding,.18,prev.protrusion,.03)
            pose=prev.blend(pose,.5+.5*smooth(f/.10))
        else:
            pose=REST.blend(pose,smooth(f/.10))
    if f>.90:
        if idx+1<len(intervals) and abs(intervals[idx+1].start-row.end)<.03:
            nxt=vowel_pose(intervals[idx+1].syllable.vowel,0.)
            if intervals[idx+1].syllable.onset in BILABIAL_ONSET:
                nxt=Pose(.02,nxt.rounding,nxt.spreading,nxt.protrusion,.02)
            pose=pose.blend(nxt,.5*smooth((f-.90)/.10))
        else:
            pose=pose.blend(REST,smooth((f-.90)/.10))
    if energy is not None:
        scale=.86+.28*float(np.clip(energy,0.,1.))
        pose=Pose(*[float(np.clip(v*scale,0,1)) if i in (0,4) else v for i,v in enumerate(pose.values())])
    return pose, {'status':'PREVIEW_UNALIGNED','alignmentVerified':False,'glyph':row.syllable.glyph,'vowel':row.syllable.vowel}


def load_face_frame(video_path: Path, second: float=0.2, size:int=400):
    cap=cv2.VideoCapture(str(video_path))
    if not cap.isOpened(): raise FileNotFoundError(video_path)
    cap.set(cv2.CAP_PROP_POS_MSEC,second*1000)
    ok,im=cap.read(); cap.release()
    if not ok: raise ValueError('Cannot decode face frame')
    casc=cv2.CascadeClassifier(cv2.data.haarcascades+'haarcascade_frontalface_default.xml')
    boxes=casc.detectMultiScale(cv2.cvtColor(im,cv2.COLOR_BGR2GRAY),1.1,4,minSize=(100,100))
    if not len(boxes): raise ValueError('No front face found')
    x,y,w,h=max(boxes,key=lambda b:int(b[2])*int(b[3]))
    pad=int(.15*max(w,h)); cx=x+w//2; cy=y+h//2; width=max(w,h)+2*pad
    x0=max(0,cx-width//2); y0=max(0,cy-width//2)
    roi=im[y0:min(im.shape[0],y0+width),x0:min(im.shape[1],x0+width)]
    if min(roi.shape[:2])<width*.95: raise ValueError('Face too close to edge')
    return cv2.resize(roi,(size,size),interpolation=cv2.INTER_AREA)


def _face_geometry(h:int,w:int):
    yy,xx=np.mgrid[0:h,0:w].astype(np.float32)
    X=xx/w; Y=yy/h
    # conservative face-oval entirely inside crop to keep deformation inside surface
    oval=((X-.5)/.39)**2 + ((Y-.54)/.50)**2 <= 1.0
    oval &= (Y>.08)
    face_mask=oval.astype(np.uint8)
    inner_dist=cv2.distanceTransform(face_mask, cv2.DIST_L2, 3)
    boundary_falloff=np.clip(inner_dist/(0.09*min(h,w)),0,1).astype(np.float32)
    boundary_lock=(inner_dist<0.055*min(h,w)).astype(np.float32)
    # rigid zones and semi-rigid zones
    forehead=np.exp(-.5*(((X-.50)/.22)**2 + ((Y-.23)/.08)**2)).astype(np.float32)
    nose_bridge=np.exp(-.5*(((X-.50)/.05)**2 + ((Y-.46)/.16)**2)).astype(np.float32)
    outer_left=np.exp(-.5*(((X-.16)/.08)**2 + ((Y-.56)/.25)**2)).astype(np.float32)
    outer_right=np.exp(-.5*(((X-.84)/.08)**2 + ((Y-.56)/.25)**2)).astype(np.float32)
    rigid=np.clip(np.maximum.reduce([forehead,nose_bridge,outer_left,outer_right]) * boundary_falloff,0,1)
    mouth_core=np.exp(-.5*(((X-.50)/.14)**2 + ((Y-.74)/.06)**2)).astype(np.float32)
    chin=np.exp(-.5*(((X-.50)/.20)**2 + ((Y-.88)/.10)**2)).astype(np.float32)
    left_cheek=np.exp(-.5*(((X-.28)/.13)**2 + ((Y-.64)/.12)**2)).astype(np.float32)
    right_cheek=np.exp(-.5*(((X-.72)/.13)**2 + ((Y-.64)/.12)**2)).astype(np.float32)
    left_malar=np.exp(-.5*(((X-.30)/.12)**2 + ((Y-.54)/.08)**2)).astype(np.float32)
    right_malar=np.exp(-.5*(((X-.70)/.12)**2 + ((Y-.54)/.08)**2)).astype(np.float32)
    left_lowereye=np.exp(-.5*(((X-.33)/.10)**2 + ((Y-.45)/.045)**2)).astype(np.float32)
    right_lowereye=np.exp(-.5*(((X-.67)/.10)**2 + ((Y-.45)/.045)**2)).astype(np.float32)
    semirigid=np.clip(np.maximum.reduce([left_cheek,right_cheek,left_malar,right_malar,left_lowereye,right_lowereye])*(1-rigid)*boundary_falloff,0,1)
    articulated=np.clip(np.maximum.reduce([mouth_core,chin])*(1-rigid),0,1)
    return dict(X=X,Y=Y,face_mask=face_mask.astype(bool),boundary_falloff=boundary_falloff,boundary_lock=boundary_lock,
                rigid=rigid, semirigid=semirigid, articulated=articulated,
                mouth_core=mouth_core, chin=chin, left_cheek=left_cheek,right_cheek=right_cheek,
                left_malar=left_malar,right_malar=right_malar,left_lowereye=left_lowereye,right_lowereye=right_lowereye)


def learn_owner_motion_caps(video_paths: Sequence[Path], out_json: Path|None=None, sample_step:int=8):
    """Learn safe motion caps from owner videos using optical flow.
    This learns *how much* each facial region tends to move, not which vowel caused it.
    """
    region_values={k:[] for k in ['boundary','rigid','semirigid','articulated','mouth','jaw','leftCheek','rightCheek','leftLowerEye','rightLowerEye']}
    casc=cv2.CascadeClassifier(cv2.data.haarcascades+'haarcascade_frontalface_default.xml')
    geom=_face_geometry(384,384)
    prev=None
    frames_used=0
    def crop_face(frame):
        gray=cv2.cvtColor(frame,cv2.COLOR_BGR2GRAY)
        boxes=casc.detectMultiScale(gray,1.08,4,minSize=(100,100))
        if not len(boxes): return None
        x,y,w,h=max(boxes,key=lambda b:int(b[2])*int(b[3]))
        pad=int(.15*max(w,h)); cx=x+w//2; cy=y+h//2; width=max(w,h)+2*pad
        x0=max(0,cx-width//2); y0=max(0,cy-width//2)
        x1=min(frame.shape[1],x0+width); y1=min(frame.shape[0],y0+width)
        roi=frame[y0:y1,x0:x1]
        if min(roi.shape[:2])<160: return None
        return cv2.resize(roi,(384,384),interpolation=cv2.INTER_AREA)
    # region boxes approximate same as v21 metric regions
    boxes={'mouth':(.33,.68,.67,.85),'jaw':(.29,.83,.71,.95),'leftCheek':(.17,.58,.36,.74),'rightCheek':(.64,.58,.83,.74),
           'leftLowerEye':(.23,.43,.39,.49),'rightLowerEye':(.61,.43,.77,.49)}
    for path in video_paths:
        cap=cv2.VideoCapture(str(path)); idx=0
        while True:
            ok,frame=cap.read()
            if not ok: break
            idx+=1
            if idx % sample_step: continue
            face=crop_face(frame)
            if face is None: continue
            gray=cv2.cvtColor(face,cv2.COLOR_BGR2GRAY)
            if prev is None:
                prev=gray; continue
            flow=cv2.calcOpticalFlowFarneback(prev,gray,None,.5,3,21,3,5,1.2,0)
            mag=np.sqrt(flow[...,0]**2+flow[...,1]**2)
            frames_used+=1
            region_values['boundary'].append(float(np.mean(mag[geom['boundary_lock']>0])))
            region_values['rigid'].append(float(np.mean(mag[geom['rigid']>.35])))
            region_values['semirigid'].append(float(np.mean(mag[geom['semirigid']>.20])))
            region_values['articulated'].append(float(np.mean(mag[geom['articulated']>.20])))
            for name,(x0,y0,x1,y1) in boxes.items():
                reg=mag[int(y0*384):int(y1*384), int(x0*384):int(x1*384)]
                region_values[name].append(float(np.mean(reg)))
            prev=gray
        cap.release()
    if frames_used<20:
        raise RuntimeError('Too few owner frames for motion-cap learning')
    report={'framesUsed':frames_used,'caps':{},'means':{}}
    for k,v in region_values.items():
        arr=np.asarray(v,np.float32)
        report['means'][k]=float(np.mean(arr))
        report['caps'][k]=float(np.percentile(arr,95))
    # enforce protection logic even if real flow noisy
    report['caps']['boundary']=min(report['caps']['boundary'],0.35)
    report['caps']['rigid']=min(report['caps']['rigid'],0.65)
    report['caps']['semirigid']=min(report['caps']['semirigid'],1.80)
    report['caps']['articulated']=min(report['caps']['articulated'],2.80)
    report['caps']['mouth']=min(report['caps']['mouth'],2.60)
    report['caps']['jaw']=min(report['caps']['jaw'],3.00)
    report['caps']['leftCheek']=min(report['caps']['leftCheek'],1.60)
    report['caps']['rightCheek']=min(report['caps']['rightCheek'],1.60)
    report['caps']['leftLowerEye']=min(report['caps']['leftLowerEye'],0.95)
    report['caps']['rightLowerEye']=min(report['caps']['rightLowerEye'],0.95)
    if out_json:
        out_json.write_text(json.dumps(report,ensure_ascii=False,indent=2))
    return report


def _clip_by_region(dx,dy,mask,max_pixels):
    mag=np.sqrt(dx*dx+dy*dy)
    limit=float(max_pixels)
    if limit<=0: 
        dx[mask]=0; dy[mask]=0; return
    region=mask & (mag>limit)
    if np.any(region):
        s=(limit/(mag[region]+1e-6)).astype(np.float32)
        dx[region]*=s; dy[region]*=s


def face_warp(face:np.ndarray, pose:Pose, reference:Pose=REST, learned_caps:dict|None=None):
    if face.dtype!=np.uint8 or face.ndim!=3 or face.shape[2]!=3 or min(face.shape[:2])<128:
        raise ValueError('uint8 BGR face crop >=128px required')
    h,w=face.shape[:2]
    g=_face_geometry(h,w)
    X,Y=g['X'],g['Y']
    d=np.array(pose.values(),np.float32)-np.array(reference.values(),np.float32)
    op,ro,spread,pro,jaw=d
    dX=np.zeros((h,w),np.float32); dY=np.zeros((h,w),np.float32)
    # articulation anchors (reduced versus v21)
    anchors=[
        (.50,.70, 0, -.006*op + .003*jaw, .14,.050,'upperLip'),
        (.50,.77, 0,  .025*jaw + .010*op, .18,.075,'lowerLip'),
        (.34,.74,-.015*spread + .007*ro, .007*jaw, .12,.10,'mouthLeft'),
        (.66,.74, .015*spread - .007*ro, .007*jaw, .12,.10,'mouthRight'),
        (.29,.64,-.0045*spread + .0025*ro, .0035*jaw, .13,.11,'cheekLeft'),
        (.71,.64, .0045*spread - .0025*ro, .0035*jaw, .13,.11,'cheekRight'),
        (.30,.54,-.0022*spread, .0017*jaw, .11,.07,'malarLeft'),
        (.70,.54, .0022*spread, .0017*jaw, .11,.07,'malarRight'),
        (.33,.45,-.0012*spread, .0008*jaw, .08,.035,'lowerEyeLeft'),
        (.67,.45, .0012*spread, .0008*jaw, .08,.035,'lowerEyeRight'),
    ]
    for cx,cy,dx,dy,rx,ry,_ in anchors:
        k=np.exp(-.5*(((X-cx)/rx)**2 + ((Y-cy)/ry)**2)).astype(np.float32)
        dX += dx*k; dY += dy*k
    # lip rounding centered on mouth only
    lip=np.exp(-.5*(((X-.50)/.16)**2 + ((Y-.745)/.055)**2)).astype(np.float32)
    dX += np.clip((.50-X)*(.11*ro+.06*pro),-.018,.018)*lip
    dY += np.clip((.742-Y)*(.038*ro),-.006,.006)*lip
    # jaw hinge inspired rotation for lower face only; pivot around ear-level arc approximation
    lower=(Y>.69).astype(np.float32) * g['articulated']
    theta=float(jaw*.045 + op*.020)  # radians scale surrogate
    pivot_x=.50; pivot_y=.64
    x0=(X-pivot_x); y0=(Y-pivot_y)
    rotX=(x0*np.cos(theta)-y0*np.sin(theta)+pivot_x)-X
    rotY=(x0*np.sin(theta)+y0*np.cos(theta)+pivot_y)-Y
    dX += rotX*0.28*lower
    dY += rotY*0.62*lower
    # region attenuation: rigid almost fixed, semirigid small, articulated larger
    attenuation=(1-0.96*g['rigid'])*(1-0.70*g['boundary_lock'])
    attenuation*=g['boundary_falloff']
    dX*=attenuation; dY*=attenuation
    # zero outside face mask
    outside=~g['face_mask']
    dX[outside]=0; dY[outside]=0
    # learned or default caps in pixels
    caps=learned_caps or {'boundary':0.35,'rigid':0.65,'semirigid':1.25,'articulated':2.65,'leftLowerEye':0.9,'rightLowerEye':0.9,'leftCheek':1.4,'rightCheek':1.4,'mouth':2.5,'jaw':2.9}
    pxX=dX*w; pxY=dY*h
    _clip_by_region(pxX,pxY,g['boundary_lock']>0,caps.get('boundary',0.35))
    _clip_by_region(pxX,pxY,g['rigid']>.35,caps.get('rigid',0.65))
    _clip_by_region(pxX,pxY,g['semirigid']>.18,caps.get('semirigid',1.25))
    _clip_by_region(pxX,pxY,g['articulated']>.18,caps.get('articulated',2.65))
    _clip_by_region(pxX,pxY,g['left_lowereye']>.2,caps.get('leftLowerEye',0.9))
    _clip_by_region(pxX,pxY,g['right_lowereye']>.2,caps.get('rightLowerEye',0.9))
    _clip_by_region(pxX,pxY,g['left_cheek']>.25,caps.get('leftCheek',1.4))
    _clip_by_region(pxX,pxY,g['right_cheek']>.25,caps.get('rightCheek',1.4))
    # rescale back to normalized map units
    dX=pxX/w; dY=pxY/h
    yy,xx=np.mgrid[0:h,0:w].astype(np.float32)
    out=cv2.remap(face,(xx-dX*w).astype(np.float32),(yy-dY*h).astype(np.float32),interpolation=cv2.INTER_CUBIC,borderMode=cv2.BORDER_REFLECT_101)
    meta={
        'skinModel':'2D_constrained_surface_warp_boundary_locked',
        'maxHorizontalPixels':round(float(np.max(np.abs(dX*w))),3),
        'maxVerticalPixels':round(float(np.max(np.abs(dY*h))),3),
        'outsideFaceMotionZero': True,
        'boundaryLockBand': True,
        'rigidZoneProtected': True,
    }
    return out, meta


def region_differences(before:np.ndarray, after:np.ndarray):
    if before.shape!=after.shape: raise ValueError('Images must share shape')
    h,w=before.shape[:2]; diff=np.abs(before.astype(np.float32)-after.astype(np.float32))
    boxes={'mouth':(.33,.68,.67,.85),'jaw':(.29,.83,.71,.95),
       'leftCheek':(.17,.58,.36,.74),'rightCheek':(.64,.58,.83,.74),
       'leftMalar':(.17,.51,.34,.61),'rightMalar':(.66,.51,.83,.61),
       'leftLowerEye':(.23,.43,.39,.49),'rightLowerEye':(.61,.43,.77,.49),
       'edge':(.00,.00,.07,.07), 'forehead':(.35,.10,.65,.22), 'noseBridge':(.46,.28,.54,.52)}
    out={}
    for name,(x0,y0,x1,y1) in boxes.items():
        region=diff[int(y0*h):int(y1*h),int(x0*w):int(x1*w)]
        out[name]=round(float(region.mean()),6)
    return out