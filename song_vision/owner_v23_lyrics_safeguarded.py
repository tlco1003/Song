"""SONG-Vision v23: AM630 exact text driven visemes with constrained 2D face rendering.

IMPORTANT: lyric timestamps from make_draft_intervals are NOT forced aligned.
Facial shape masks are conservative *geometric proxies*, not image-segmented
individual anatomy. Audio RMS scales magnitude only, never vowel identity.

This module refines v22 with guaranteed fixed exterior/contour pixels,
strict rigid zones, no inverse-map source crossing of its conservative oval,
readout metrics, and individual owner-speech optical-flow capped movement.
"""
from __future__ import annotations
import math
from dataclasses import dataclass
from typing import Sequence
import numpy as np
import cv2
try:
    from .owner_v22_constrained_viseme import Pose, REST, syllables, pose_at, Interval, _face_geometry, smooth
except ImportError:
    from owner_v22_constrained_viseme import Pose, REST, syllables, pose_at, Interval, _face_geometry, smooth

FULL_LYRICS_EXCERPT=(
    "어두운 밤이 지나면",
    "아침은 다시 찾아오겠지",
)

@dataclass(frozen=True)
class DraftCue:
    glyph: str
    start: float
    end: float
    source: str="estimated_unreviewed_not_aligned"


def make_draft_intervals(lines:Sequence[str]=FULL_LYRICS_EXCERPT,
                         song_start:float=0., line_seconds:tuple[float,...]=(5.7,6.0),
                         between_lines:float=.35)->tuple[Interval,...]:
    """Unverified initial editor timings. NOT based on measured singing phonemes."""
    if len(lines)!=len(line_seconds) or any(x<=0 for x in line_seconds):
        raise ValueError('Each text line needs a positive estimated duration')
    if song_start<0 or between_lines<0:raise ValueError('Invalid draft timing')
    result=[];cursor=float(song_start)
    for i,(text,seconds) in enumerate(zip(lines,line_seconds)):
        parts=syllables(text)
        # Heuristic timing weights are an *editor draft*, not acoustically aligned.
        weights=[]
        for p in parts:
            weight=1.0+(.15 if p.onset in {'ㅁ','ㅂ','ㅍ','ㄸ','ㄲ'} else 0.)+(.12 if p.coda else 0.)
            if p.vowel in {'ㅑ','ㅕ','ㅛ','ㅠ'}:weight+=.18
            weights.append(weight)
        weights=np.asarray(weights,dtype=np.float64)
        durations=seconds*weights/weights.sum()
        for part,duration in zip(parts,durations):
            end=cursor+float(duration)
            result.append(Interval(part,cursor,end,'estimated_unreviewed_not_aligned'))
            cursor=end
        if i<len(lines)-1:cursor+=between_lines
    return tuple(result)


def _warp_maps(h:int,w:int,pose:Pose,reference:Pose,caps:dict):
    """Return strictly constrained inverse warp and masks, all in source pixels."""
    g=_face_geometry(h,w)
    X,Y=g['X'],g['Y'];d=np.asarray(pose.values(),np.float32)-np.asarray(reference.values(),np.float32)
    op,ro,spread,pro,jaw=d
    dx=np.zeros((h,w),np.float32);dy=np.zeros((h,w),np.float32)
    anchors=[
        (.50,.70, 0., -.006*op+.003*jaw, .14,.050),
        (.50,.77, 0.,  .025*jaw+.010*op, .18,.075),
        (.34,.74,-.015*spread+.007*ro,.007*jaw,.12,.10),
        (.66,.74, .015*spread-.007*ro,.007*jaw,.12,.10),
        (.29,.64,-.0045*spread+.0025*ro,.0035*jaw,.13,.11),
        (.71,.64, .0045*spread-.0025*ro,.0035*jaw,.13,.11),
        (.30,.54,-.0022*spread,.0017*jaw,.11,.07),
        (.70,.54, .0022*spread,.0017*jaw,.11,.07),
        (.33,.45,-.0012*spread,.0008*jaw,.08,.035),
        (.67,.45, .0012*spread,.0008*jaw,.08,.035),
    ]
    for cx,cy,xx,yy,rx,ry in anchors:
        influence=np.exp(-.5*(((X-cx)/rx)**2+((Y-cy)/ry)**2)).astype(np.float32)
        dx+=xx*influence;dy+=yy*influence
    lip=np.exp(-.5*(((X-.5)/.16)**2+((Y-.745)/.055)**2)).astype(np.float32)
    dx+=np.clip((.50-X)*(.11*ro+.06*pro),-.018,.018)*lip
    dy+=np.clip((.742-Y)*(.038*ro),-.006,.006)*lip
    lower=(Y>.69).astype(np.float32)*g['articulated']
    theta=float(jaw*.045+op*.020)
    x0,y0=X-.5,Y-.64
    dx+=((x0*np.cos(theta)-y0*np.sin(theta)+.5)-X)*.28*lower
    dy+=((x0*np.sin(theta)+y0*np.cos(theta)+.64)-Y)*.62*lower
    # Soft rigidity attenuation followed by a hard clamp for core rigid tissue.
    atten=(1-.96*g['rigid'])*g['boundary_falloff']
    dx*=atten*w;dy*=atten*h
    hard_rigid=g['rigid']>.72
    # Oval is a conservative fixed contour proxy, NOT true anatomical segmentation.
    # A >=5px interior strip is IMMUTABLE; outside face is IMMUTABLE.
    face_inside=g['face_mask']
    boundary=face_inside & (g['boundary_lock']>.5)
    immovable=(~face_inside)|boundary|hard_rigid
    dx[immovable]=0.;dy[immovable]=0.
    # Priority constraints: shared regions receive the tighter of their caps.
    limits=np.full((h,w), min(3.0,float(caps.get('articulated',2.8))),np.float32)
    def cap(mask,name,fallback):
        limits[mask]=np.minimum(limits[mask], min(float(caps.get(name,fallback)),fallback))
    cap(g['rigid']>.28,'rigid',.5)
    cap(g['semirigid']>.18,'semirigid',1.6)
    cap(g['left_cheek']>.25,'leftCheek',1.4)
    cap(g['right_cheek']>.25,'rightCheek',1.4)
    cap(g['left_lowereye']>.18,'leftLowerEye',.75)
    cap(g['right_lowereye']>.18,'rightLowerEye',.75)
    cap(g['mouth_core']>.32,'mouth',2.6)
    cap(g['chin']>.38,'jaw',2.9)
    cap(boundary,'boundary',0.)
    magnitude=np.sqrt(dx*dx+dy*dy)
    scale=np.minimum(1.,limits/np.maximum(magnitude,1e-9))
    dx*=scale;dy*=scale
    # Prevent sampling outside the conservative source-face mask:
    py,px=np.mgrid[:h,:w].astype(np.float32)
    sample_x=px-dx;sample_y=py-dy
    src_x=np.clip(np.rint(sample_x).astype(np.int32),0,w-1)
    src_y=np.clip(np.rint(sample_y).astype(np.int32),0,h-1)
    rejected=(~face_inside[src_y,src_x])|immovable
    dx[rejected]=0.;dy[rejected]=0.
    # Conservative displacement bound helps avoid foldovers in this 2D prototype.
    # Explicitly test local Jacobian of inverse warp and cancel unsafe vectors.
    sample_x=px-dx;sample_y=py-dy
    gx=np.gradient(sample_x,axis=1);gy=np.gradient(sample_y,axis=0)
    crossx=np.gradient(sample_x,axis=0);crossy=np.gradient(sample_y,axis=1)
    det=gx*gy-crossx*crossy
    folds=det<.65
    dx[folds]=0.;dy[folds]=0.
    sample_x=px-dx;sample_y=py-dy
    metadata={
        'faceContourSource':'conservative_oval_proxy_not_true_detected_landmarks',
        'exteriorPixelDisplacementMaximum':float(np.max(magnitude[~face_inside])) if np.any(~face_inside) else 0.,
        'exteriorAfterMaximum':float(np.max(np.hypot(dx[~face_inside],dy[~face_inside]))) if np.any(~face_inside) else 0.,
        'boundaryAfterMaximum':float(np.max(np.hypot(dx[boundary],dy[boundary]))) if np.any(boundary) else 0.,
        'rigidCoreAfterMaximum':float(np.max(np.hypot(dx[hard_rigid],dy[hard_rigid]))) if np.any(hard_rigid) else 0.,
        'maxDisplacementPx':float(np.max(np.hypot(dx,dy))),
        'rejectedSourceOutsidePixels':int(np.count_nonzero(rejected & (magnitude>1e-5))),
        'blockedLocalFoldPixels':int(np.count_nonzero(folds)),
        'boundaryPixels':int(np.count_nonzero(boundary)),
        'faceInsidePixels':int(np.count_nonzero(face_inside)),
        'skinModel':'conservative_2D_kinematic_surrogate_NOT_trained_muscles',
    }
    return sample_x,sample_y,metadata,immovable


def face_warp_safeguarded(image:np.ndarray,pose:Pose,caps:dict,reference:Pose=REST):
    if image.ndim!=3 or image.shape[2]!=3 or image.dtype!=np.uint8 or min(image.shape[:2])<128:
        raise ValueError('Expected uint8 face BGR >=128px')
    if not all(np.isfinite(v) and 0<=v<=1 for v in pose.values()):
        raise ValueError('Invalid pose')
    h,w=image.shape[:2]
    mx,my,meta,immovable=_warp_maps(h,w,pose,reference,caps)
    result=cv2.remap(image,mx.astype('float32'),my.astype('float32'),
                    interpolation=cv2.INTER_LINEAR,borderMode=cv2.BORDER_REPLICATE)
    result[immovable]=image[immovable]
    assert np.array_equal(result[immovable],image[immovable])
    return result,meta


def classify_displacements(original:np.ndarray,generated:np.ndarray):
    """Pixel-domain visibility checks, NOT optical flow ground truth."""
    if original.shape!=generated.shape:raise ValueError('Mismatched images')
    diff=np.abs(generated.astype(np.float32)-original.astype(np.float32)).mean(axis=2)
    h,w=diff.shape;g=_face_geometry(h,w)
    def mean(m):return float(np.mean(diff[m])) if np.any(m) else 0.
    return {
        'outsideFacePixelDifference':mean(~g['face_mask']),
        'boundaryPixelDifference':mean(g['face_mask'] & (g['boundary_lock']>.5)),
        'rigidCorePixelDifference':mean(g['rigid']>.72),
        'mouthPixelDifference':mean(g['mouth_core']>.32),
        'jawPixelDifference':mean(g['chin']>.38),
        'leftCheekPixelDifference':mean(g['left_cheek']>.25),
        'rightCheekPixelDifference':mean(g['right_cheek']>.25),
        'leftLowerEyePixelDifference':mean(g['left_lowereye']>.18),
        'rightLowerEyePixelDifference':mean(g['right_lowereye']>.18),
    }