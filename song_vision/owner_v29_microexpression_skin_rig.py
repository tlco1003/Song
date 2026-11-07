from __future__ import annotations
import json, sys
from pathlib import Path
import cv2
import numpy as np

HERE=Path(__file__).resolve().parent
sys.path.insert(0, str(HERE/'v26'/'code'))
sys.path.insert(0, str(HERE))
from owner_mouth_library_v26 import OwnerMouthAtlas, VOWEL_TARGETS, render_observed_mouth
from owner_v27_jaw_oral_rig import import_profile, learnable_jaw_shift, apply_owner_jaw_image_motion

# AU-inspired face regions. We only estimate 2-D skin motion from the owner's video.
REGION_SPECS={
    'brow_inner_left':(.41,.26,.045,.032,.22),
    'brow_inner_right':(.59,.26,.045,.032,.22),
    'eye_lower_left':(.41,.42,.050,.032,.22),
    'eye_lower_right':(.59,.42,.050,.032,.22),
    'nasolabial_left':(.42,.60,.050,.065,.45),
    'nasolabial_right':(.58,.60,.050,.065,.45),
    'cheek_upper_left':(.31,.58,.085,.070,.55),
    'cheek_upper_right':(.69,.58,.085,.070,.55),
    'cheek_lower_left':(.29,.69,.095,.075,.58),
    'cheek_lower_right':(.71,.69,.095,.075,.58),
    'mouth_corner_left':(.40,.75,.070,.055,.90),
    'mouth_corner_right':(.60,.75,.070,.055,.90),
    'upper_lip':(.50,.72,.085,.040,.85),
    'lower_lip':(.50,.775,.095,.050,.90),
    'mentalis':(.50,.84,.085,.055,.88),
    'chin_center':(.50,.89,.12,.08,1.00),
    'jaw_left':(.35,.86,.09,.08,.62),
    'jaw_right':(.65,.86,.09,.08,.62),
}


def _smooth01(x):
    x=np.clip(x,0,1)
    return x*x*(3-2*x)


def _gauss2(h,w,cx,cy,sx,sy):
    yy,xx=np.mgrid[:h,:w].astype(np.float32)
    return np.exp(-0.5*(((xx/w-cx)/sx)**2+((yy/h-cy)/sy)**2)).astype(np.float32)


def _sample_flow_regions(base_gray, other_gray):
    flow=cv2.calcOpticalFlowFarneback(base_gray,other_gray,None,0.5,3,21,3,5,1.2,0)
    h,w=base_gray.shape[:2]
    out={}
    for name,(cx,cy,sx,sy,alpha) in REGION_SPECS.items():
        x0=max(0,int((cx-sx)*w)); x1=min(w,int((cx+sx)*w))
        y0=max(0,int((cy-sy)*h)); y1=min(h,int((cy+sy)*h))
        roi=flow[y0:y1,x0:x1]
        if roi.size==0:
            dx=dy=mag=0.
        else:
            dx=float(np.median(roi[...,0]))
            dy=float(np.median(roi[...,1]))
            mag=float(np.median(np.linalg.norm(roi,axis=2)))
        out[name]={'dx':round(dx,4),'dy':round(dy,4),'mag':round(mag,4),'alpha':alpha}
    return out


def infer_microexpression_profiles(atlas:OwnerMouthAtlas):
    base_gray=cv2.cvtColor(atlas.base,cv2.COLOR_BGR2GRAY)
    profiles={}
    for state,img in atlas.images.items():
        other_gray=cv2.cvtColor(img,cv2.COLOR_BGR2GRAY)
        profiles[state]=_sample_flow_regions(base_gray,other_gray)
    return profiles


def _deepcopy_profile(p):
    return json.loads(json.dumps(p))


def _vowel_refine(vowel:str, p:dict):
    q=_deepcopy_profile(p)
    # make subtle speech-expression changes visible but bounded.
    if vowel=='ㅔ':
        # more smile-like, thinner lips, slight zygomatic lift, jaw slight drop.
        for k in ('cheek_upper_left','cheek_upper_right','nasolabial_left','nasolabial_right','mouth_corner_left','mouth_corner_right'):
            q[k]['dy']-=0.75
        q['mouth_corner_left']['dx']-=0.55; q['mouth_corner_right']['dx']+=0.55
        q['upper_lip']['dy']-=0.55
        q['lower_lip']['dy']+=0.75
        q['mentalis']['dy']+=0.75
        q['chin_center']['dy']+=0.75
        for k in ('eye_lower_left','eye_lower_right'):
            q[k]['dy']-=0.18
    elif vowel=='ㅣ':
        for k in ('cheek_upper_left','cheek_upper_right','mouth_corner_left','mouth_corner_right'):
            q[k]['dy']-=0.35
        q['mouth_corner_left']['dx']-=0.45; q['mouth_corner_right']['dx']+=0.45
        q['upper_lip']['dy']-=0.22
        q['chin_center']['dy']+=0.22
        for k in ('eye_lower_left','eye_lower_right'):
            q[k]['dy']-=0.10
    elif vowel in ('ㅗ','ㅛ'):
        # cheeks pull slightly inward/up, lips round, jaw slight drop.
        for k in ('cheek_lower_left','cheek_upper_left','nasolabial_left'):
            q[k]['dx']+=0.55
        for k in ('cheek_lower_right','cheek_upper_right','nasolabial_right'):
            q[k]['dx']-=0.55
        q['mouth_corner_left']['dx']+=1.10; q['mouth_corner_right']['dx']-=1.10
        q['upper_lip']['dy']+=0.20; q['lower_lip']['dy']+=0.45
        q['mentalis']['dy']+=0.50; q['chin_center']['dy']+=0.58
    elif vowel in ('ㅜ','ㅠ'):
        for k in ('cheek_lower_left','cheek_upper_left','nasolabial_left'):
            q[k]['dx']+=0.75
        for k in ('cheek_lower_right','cheek_upper_right','nasolabial_right'):
            q[k]['dx']-=0.75
        q['mouth_corner_left']['dx']+=0.95; q['mouth_corner_right']['dx']-=0.95
        q['upper_lip']['dy']+=0.28; q['lower_lip']['dy']+=0.95
        q['mentalis']['dy']+=0.85; q['chin_center']['dy']+=1.10
        q['jaw_left']['dy']+=0.45; q['jaw_right']['dy']+=0.45
    elif vowel in ('ㅏ','ㅑ'):
        q['lower_lip']['dy']+=1.15
        q['mentalis']['dy']+=1.20; q['chin_center']['dy']+=1.55
        q['jaw_left']['dy']+=0.55; q['jaw_right']['dy']+=0.55
        for k in ('nasolabial_left','nasolabial_right'):
            q[k]['dy']+=0.15
    elif vowel in ('ㅓ','ㅕ'):
        q['lower_lip']['dy']+=0.85
        q['mentalis']['dy']+=0.95; q['chin_center']['dy']+=1.10
        q['jaw_left']['dy']+=0.35; q['jaw_right']['dy']+=0.35
    elif vowel=='ㅡ':
        # stretched horizontal, small cheek tension, very small jaw.
        q['mouth_corner_left']['dx']-=0.70; q['mouth_corner_right']['dx']+=0.70
        for k in ('cheek_lower_left','cheek_lower_right'):
            q[k]['dy']-=0.10
        q['chin_center']['dy']+=0.10
    return q


def apply_microexpression_motion(image:np.ndarray, profile:dict):
    h,w=image.shape[:2]
    yy,xx=np.mgrid[0:h,0:w].astype(np.float32)
    dx=np.zeros((h,w),np.float32)
    dy=np.zeros((h,w),np.float32)
    for name,(cx,cy,sx,sy,base_alpha) in REGION_SPECS.items():
        if name not in profile:
            continue
        g=_gauss2(h,w,cx,cy,sx,sy)*(base_alpha)
        dx += g*float(profile[name]['dx'])
        dy += g*float(profile[name]['dy'])
    X=xx/w; Y=yy/h
    face_oval=((X-.50)/.385)**2 + ((Y-.54)/.48)**2
    gate=np.clip((1.03-face_oval)/0.12,0,1)
    # Permit subtle eyelid/cheek motion while keeping forehead rigid and hair/background fixed.
    top_taper=_smooth01((Y-.18)/.18)
    bottom_taper=1-.35*_smooth01((Y-.96)/.04)
    gate=(gate*top_taper*bottom_taper).astype(np.float32)
    gate[Y<.18]=0
    dx*=gate; dy*=gate
    map_x=(xx-dx).astype(np.float32)
    map_y=(yy-dy).astype(np.float32)
    warped=cv2.remap(image,map_x,map_y,interpolation=cv2.INTER_LINEAR,borderMode=cv2.BORDER_REFLECT_101)
    alpha=np.clip(gate*1.08,0,1)[...,None]
    out=np.clip(image.astype(np.float32)*(1-alpha)+warped.astype(np.float32)*alpha,0,255).astype(np.uint8)
    # hard preserve upper forehead only
    out[:int(.16*h),:]=image[:int(.16*h),:]
    return out, {
        'maxMicroDxPx':round(float(np.max(np.abs(dx))),4),
        'maxMicroDyPx':round(float(np.max(np.abs(dy))),4),
        'foreheadTop16PercentUnchanged':True,
        'microexpressionRegionsApplied':True,
    }


def render_owner_v29(atlas:OwnerMouthAtlas, jaw_profile:dict, micro_profiles:dict, vowel:str):
    base, legacy = render_observed_mouth(atlas, vowel)
    state=VOWEL_TARGETS[vowel]['state']
    observed=atlas.meta[state]
    refined=_vowel_refine(vowel, micro_profiles[state])
    micro, minfo = apply_microexpression_motion(base, refined)
    jaw_shift=learnable_jaw_shift(jaw_profile, observed.darkCenterAreaPx)
    if vowel in ('ㅗ','ㅛ'):
        jaw_shift=max(jaw_shift,1.15)
    elif vowel in ('ㅔ','ㅐ'):
        jaw_shift=max(jaw_shift,0.7)
    elif vowel=='ㅣ':
        jaw_shift=max(jaw_shift,0.3)
    jaw, jinfo = apply_owner_jaw_image_motion(micro, jaw_shift)
    return jaw, {
        **legacy,
        **minfo,
        **jinfo,
        'expressionStateSource':state,
        'microexpressionDerivedFromOwnerOpticalFlow':True,
        'jawAndLipSeparatedVariables':True,
        'facialSkinMotionIntegrated':True,
        'subtleExpressionMode':True,
        'hiddenOralCavity3DMeasured':False,
        'jawBoneRotationAngleMeasured':False,
    }


if __name__=='__main__':
    root=Path('/mnt/data')
    atlas=OwnerMouthAtlas.from_user_videos(root)
    profile=import_profile(Path('/mnt/data/song_v28_work/results/OWNER_V27_LEARNED_JAW_PROFILE.json'))
    micro=infer_microexpression_profiles(atlas)
    Path('/mnt/data/song_v29_work/results').mkdir(parents=True, exist_ok=True)
    (Path('/mnt/data/song_v29_work/results/OWNER_V29_MICRO_PROFILES.json')
        .write_text(json.dumps(micro,ensure_ascii=False,indent=2)))
    for v in ['ㅣ','ㅔ','ㅗ','ㅜ','ㅏ','ㅓ']:
        img, info=render_owner_v29(atlas, profile, micro, v)
        cv2.imwrite(f'/mnt/data/song_v29_work/results/{v}_v29.png', img)
        print(v, info)
