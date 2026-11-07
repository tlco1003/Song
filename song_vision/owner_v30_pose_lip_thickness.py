"""SONG-Vision v30: observed visible lip vermilion thickness + pose-aware atlas.

Input: owner's recorded speech. No fabricated phoneme tags, jaw angle, teeth surfaces.
Visible vermilion height (2D pixels) is NOT physical 3D tissue thickness (mm).

See: Nasir et al 2020 doi:10.1016/j.heliyon.2020.e04093 (dynamic 3D lips),
Ferrario et al 2000 doi:10.1046/j.1469-7580.2000.19630415.x,
Rams et al 2024 doi:10.1007/s00266-024-03876-8.
"""
from __future__ import annotations
from dataclasses import asdict, dataclass
from pathlib import Path
import json, math, sys
from typing import Optional
import cv2
import numpy as np

ROOT = Path(__file__).resolve().parent
sys.path.insert(0,str(ROOT))
if not (ROOT/'owner_mouth_library_v26.py').exists():
    sys.path.insert(0,str(ROOT.parent/'song_v28_work'/'v26'/'code'))
    sys.path.insert(0,str(ROOT.parent/'song_v28_work'))
from owner_mouth_library_v26 import load_video_face, segment_observed_outer_lip


@dataclass
class VisibleLipMeasurements:
    outerWidthPx: int
    outerHeightPx: int
    upperVisibleVermilionHeightPx: Optional[float]
    lowerVisibleVermilionHeightPx: Optional[float]
    upperToWidth: Optional[float]
    lowerToWidth: Optional[float]
    upperLowerVisibleRatio: Optional[float]
    mouthApertureHeightPx: Optional[float]
    apertureStatus: str
    method: str = '2D_mouth_pixel_proxy_not_tissue_depth_mm'
    clinicallyVerified: bool = False


def measure_bands_from_masks(outer_mask:np.ndarray, inner_aperture:np.ndarray,
                             require_verified_aperture:bool=False)->VisibleLipMeasurements:
    """Pixel distances of visible lip bands; exposes low-confidence when no gap.

    For each central column, measure upper/lower outer lip boundary and the
    dark inner mouth boundary if a continuous inner aperture is present.
    With no aperture, never pretend a precise inner vermilion boundary exists.
    """
    outer = (outer_mask > 0)
    inner = (inner_aperture > 0) & outer
    if outer.ndim!=2 or inner.shape!=outer.shape:
        raise ValueError('Both masks must be 2D, same shape')
    ys,xs=np.nonzero(outer)
    if xs.size<20:
        raise ValueError('No sufficiently large outer lip')
    xlo,xhi=int(xs.min()),int(xs.max()); ylo,yhi=int(ys.min()),int(ys.max())
    width=xhi-xlo+1; height=yhi-ylo+1
    # Restrict measurements to middle 40% to avoid commissure taper.
    center_cols=np.arange(xlo+round(.30*width),xlo+round(.70*width),dtype=np.int32)
    up=[];low=[];open_heights=[]
    for x in center_cols:
        yo=np.flatnonzero(outer[:,x]); yi=np.flatnonzero(inner[:,x]);
        if yo.size<3 or yi.size<3:continue
        # Require a nontrivial inner opening, not one dark crease pixel.
        top,bottom=int(yi.min()),int(yi.max())
        if bottom-top<2 or (bottom-top+1)<height*.11:continue
        if top<=int(yo.min())+1 or bottom>=int(yo.max())-1:continue
        up.append(top-int(yo.min()));low.append(int(yo.max())-bottom)
        open_heights.append(bottom-top+1)
    valid=len(up)>=max(3,int(.28*len(center_cols)))
    if require_verified_aperture and not valid:
        raise ValueError('No reliable inner mouth aperture')
    upper=round(float(np.median(up)),3) if valid else None
    lower=round(float(np.median(low)),3) if valid else None
    aperture=round(float(np.median(open_heights)),3) if valid else None
    return VisibleLipMeasurements(
        width,height,upper,lower,
        round(upper/width,5) if upper is not None else None,
        round(lower/width,5) if lower is not None else None,
        round(upper/lower,5) if upper is not None and lower and lower>0 else None,
        aperture,'visible_aperture_proxy' if valid else 'NOT_RESOLVED_NO_FALSE_VERMILION_NUMBERS')


def estimate_oral_aperture_candidate(face:np.ndarray, outer:np.ndarray):
    """Dark-pixel candidate only; do not equate with medical oral/teeth mask.

    Poor for exposed teeth, shadows, and 3/4 view; emits diagnostic scores.
    """
    h,w=outer.shape
    out=np.zeros((h,w),np.uint8)
    yy,xx=np.nonzero(outer)
    if len(xx)<20:return out,dict(confidence='none',reason='outer_not_detected')
    x0,x1=int(xx.min()),int(xx.max()); y0,y1=int(yy.min()),int(yy.max())
    lab=cv2.cvtColor(face,cv2.COLOR_BGR2LAB)
    lum=lab[...,0].astype(np.float32)
    # Luma of cheeks above mouth used to avoid darkening threshold by lip tint.
    left=lum[max(0,int(h*.58)):int(h*.64),int(w*.32):int(w*.39)]
    right=lum[max(0,int(h*.58)):int(h*.64),int(w*.61):int(w*.68)]
    cheek=np.concatenate([left.ravel(),right.ravel()]) if left.size and right.size else lum.ravel()
    cheek_luma=float(np.median(cheek))
    core=np.zeros((h,w),np.uint8)
    # Exclude outer contour rim; dark crease vs open cavity remains ambiguous.
    aperture=(lum < cheek_luma*.77)&(outer>0)
    aperture[:int(y0+.16*(y1-y0)),:]=False
    aperture[int(y1-.14*(y1-y0)):,:]=False
    aperture[:,:int(x0+.13*(x1-x0))]=False
    aperture[:,int(x1-.13*(x1-x0)):]=False
    core[aperture]=255
    n,labels,stats,centers=cv2.connectedComponentsWithStats(core,8)
    if n<=1:return out,dict(confidence='low',reason='no_interior_dark_component',cheekMedian=round(cheek_luma,1))
    best=-1;max_score=-1
    for i in range(1,n):
        area=int(stats[i,cv2.CC_STAT_AREA]);cx=float(centers[i,0]);cy=float(centers[i,1]);
        if area<4:continue
        center_penalty=abs(cx-(x0+x1)/2)/max(1,x1-x0)+.40*abs(cy-(y0+y1)/2)/max(1,y1-y0)
        score=area/(1+center_penalty)
        if score>max_score:best=i;max_score=score
    if best<0:return out,dict(confidence='low',reason='only_tiny_dark_regions')
    out[labels==best]=255
    gap_height=stats[best,cv2.CC_STAT_HEIGHT]
    area=stats[best,cv2.CC_STAT_AREA]
    category='candidate_low_not_anatomical_truth'
    if gap_height<4 or area<15:category='low'
    return out,dict(confidence=category,area=int(area),height=int(gap_height),cheekMedian=round(cheek_luma,1))


def observed_thickness(face:np.ndarray):
    outer, outer_meta=segment_observed_outer_lip(face)
    inner,confidence=estimate_oral_aperture_candidate(face,outer)
    result=measure_bands_from_masks(outer,inner)
    return result,outer,inner,confidence


def build_owner_thickness_atlas(source_dir:Path, times_by_video:dict[str,list[float]]):
    records=[]; samples=[]
    for vid,times in times_by_video.items():
        for t in times:
            try:
                face,_=load_video_face(source_dir/vid,t,size=320)
                value,outer,inner,confidence=observed_thickness(face)
                # Appearance-only review: visibly CLOSED lips cannot yield a
                # trustworthy dark inner-mouth aperture from chromatic pixels.
                seen_closed=((vid=='IMG_0853.mp4' and any(abs(t-z)<.05 for z in [7.6,14.3])) or
                             (vid=='IMG_0854.mp4' and any(abs(t-z)<.05 for z in [40.0,49.0])))
                if seen_closed:
                    value=measure_bands_from_masks(outer,np.zeros_like(inner))
                    confidence={'confidence':'NONE_MANUALLY_REVIEWED_CLOSED_APPEARANCE',
                                'reason':'no_proven_inner_oral_boundary'}
                    inner[:]=0
                entry={'source':vid,'seconds':t,'measurement':asdict(value),'oralCandidate':confidence,
                       'speechLabel':'UNVERIFIED', 'poseLabel':'FRONT_FACE_DETECTOR_ONLY_YAW_NOT_MEASURED'}
                records.append(entry);samples.append((entry,face,outer,inner))
            except (ValueError,cv2.error) as e:
                records.append({'source':vid,'seconds':t,'error':str(e),'speechLabel':'UNVERIFIED'})
    return records,samples


def make_pose_samples(video_file:Path, times:list[float],out_dir:Path):
    """Conservative frontal/profile detector labels, not metric yaw estimates."""
    out_dir.mkdir(parents=True,exist_ok=True)
    front=cv2.CascadeClassifier(cv2.data.haarcascades+'haarcascade_frontalface_default.xml')
    profile=cv2.CascadeClassifier(cv2.data.haarcascades+'haarcascade_profileface.xml')
    eye=cv2.CascadeClassifier(cv2.data.haarcascades+'haarcascade_eye.xml')
    cap=cv2.VideoCapture(str(video_file))
    records=[];frames=[]
    for sec in times:
        cap.set(cv2.CAP_PROP_POS_MSEC,sec*1000)
        ok,img=cap.read()
        if not ok:continue
        sm=cv2.resize(img,None,fx=.65,fy=.65,interpolation=cv2.INTER_AREA)
        grey=cv2.cvtColor(sm,cv2.COLOR_BGR2GRAY)
        fs=front.detectMultiScale(grey,1.09,4,minSize=(80,80))
        ps=profile.detectMultiScale(grey,1.10,3,minSize=(80,80))
        flip=cv2.flip(grey,1)
        pp=profile.detectMultiScale(flip,1.10,3,minSize=(80,80))
        faces=sorted(fs,key=lambda b:b[2]*b[3],reverse=True)
        category='UNRESOLVED_NOT_YAW'
        n_eyes=0
        if len(faces):
            x,y,w,h=faces[0]
            eg=grey[y:y+round(.56*h),x:x+w]
            # Eyes are not always detectable under turns or occlusions.
            n_eyes=len(eye.detectMultiScale(eg,1.09,4,minSize=(12,12),maxSize=(100,100)))
            category='FRONTAL_CANDIDATE' if n_eyes>=2 else 'OBLIQUE_OR_FRONTAL_UNCERTAIN'
            if len(ps) or len(pp):
                category='FRONTAL_PROFILE_CONFLICT_REVIEW_REQUIRED'
        elif len(ps): category='PROFILE_CANDIDATE_RIGHT_UNVERIFIED'
        elif len(pp): category='PROFILE_CANDIDATE_LEFT_UNVERIFIED'
        else:category='TURNED_OR_OCCLUDED_UNRESOLVED'
        records.append({'source':video_file.name,'timeSec':sec,'class':category,
                       'frontDetections':len(fs),'profileRightDetections':len(ps),
                       'profileLeftDetections':len(pp),'eyeDetections':n_eyes,
                       'metricYawDegrees':None,'poseHumanVerified':False})
        title=f'{video_file.name} {sec:.1f}s  {category}'
        frame=cv2.resize(img,(180,320),interpolation=cv2.INTER_AREA)
        cv2.rectangle(frame,(0,0),(180,35),(10,12,15),-1)
        cv2.putText(frame,f'{sec:.1f}s {category[:13]}',(6,22),cv2.FONT_HERSHEY_SIMPLEX,.37,(241,235,235),1,cv2.LINE_AA)
        frames.append(frame)
    cap.release()
    return records,frames


def render_thickness_debug_samples(samples,filepath:Path):
    from PIL import Image,ImageDraw,ImageFont
    f=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',14)
    rows=[]
    for entry,face,outer,inner in samples:
        overlay=face.copy()
        outer_c,_=cv2.findContours((outer>0).astype(np.uint8),cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE)
        inner_c,_=cv2.findContours((inner>0).astype(np.uint8),cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE)
        cv2.drawContours(overlay,outer_c,-1,(74,240,88),1,cv2.LINE_AA)
        cv2.drawContours(overlay,inner_c,-1,(241,220,48),1,cv2.LINE_AA)
        s=entry['measurement']
        tile=Image.new('RGB',(640,356),(25,26,36))
        tile.paste(Image.fromarray(cv2.cvtColor(face,cv2.COLOR_BGR2RGB)),(0,0))
        tile.paste(Image.fromarray(cv2.cvtColor(overlay,cv2.COLOR_BGR2RGB)),(320,0))
        d=ImageDraw.Draw(tile)
        h0='NA' if s['upperVisibleVermilionHeightPx'] is None else str(s['upperVisibleVermilionHeightPx'])
        h1='NA' if s['lowerVisibleVermilionHeightPx'] is None else str(s['lowerVisibleVermilionHeightPx'])
        label=f"{entry['source']} {entry['seconds']:.1f}s | upper {h0}px lower {h1}px | {s['apertureStatus']}"
        d.text((4,328),label[:93],font=f,fill=(245,237,226))
        rows.append(tile)
    canvas=Image.new('RGB',(640,356*len(rows)),(16,16,22))
    for i,t in enumerate(rows):canvas.paste(t,(0,i*356))
    canvas.save(filepath,quality=91)


def apply_apparent_vermilion_thickness(image:np.ndarray, upper_scale:float,lower_scale:float,
                                      protect_center:bool=True):
    """Independent upper/lower *texture* thickness scaling, bounded in mouth ROI.

    Applies a local pixel remap, not fake drawing. Values are prefit research
    defaults only until verified lip-border landmarks are available.
    """
    if not (.78<=upper_scale<=1.20 and .78<=lower_scale<=1.20):
        raise ValueError('out-of-range apparent vermilion stretch')
    h,w=image.shape[:2]
    yy,xx=np.mgrid[:h,:w].astype(np.float32)
    X=xx/w; Y=yy/h
    # Prior atlas conventions normalized 320 image: must still guard true outline.
    cx,cy=.50,.75
    top_anchor=.684; bottom_anchor=.82; seam_y=.748
    dy=np.zeros((h,w),np.float32)
    up=(Y<seam_y)
    down=(Y>=seam_y)
    dy[up]=(top_anchor+(Y[up]-top_anchor)/upper_scale-Y[up])*h
    dy[down]=(bottom_anchor-(bottom_anchor-Y[down])/lower_scale-Y[down])*h
    gaussian=np.exp(-0.5*(((X-cx)/.14)**4+((Y-cy)/.074)**4)).astype(np.float32)
    cut=(Y>=.675)&(Y<=.830)&(X>=.30)&(X<=.70)
    strength=gaussian*cut.astype(np.float32)
    src_y=(yy+dy*strength).astype(np.float32)
    remapped=cv2.remap(image,xx,src_y,cv2.INTER_LINEAR,borderMode=cv2.BORDER_REFLECT_101)
    out=np.clip(image.astype(np.float32)*(1-strength[...,None])+remapped.astype(np.float32)*strength[...,None],0,255).astype(np.uint8)
    # Explicitly preserve entire forehead, corners of frame, and face exterior.
    out[:int(.675*h),:]=image[:int(.675*h),:]
    out[int(.83*h):,:]=image[int(.83*h):,:]
    return out,{'upperRelativeScale':upper_scale,'lowerRelativeScale':lower_scale,
                'pixelWarpOnlyNotTissueDepth':True,'outsideFaceUnchanged':True,
                'top67PercentUnchanged':True}
