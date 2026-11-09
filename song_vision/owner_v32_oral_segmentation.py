"""v32 anatomy-separated observable oral mask and real-pixel portrait render.

No fake painted mouth-hole, fake teeth, or medical segmentation accuracy claims.
Uses 320px registered owner frames from v26; estimates mouth cavity boundaries
with image contrast and connected components, returning unknown on low confidence.
"""
from __future__ import annotations
from dataclasses import dataclass, asdict
from pathlib import Path
import sys, json
import cv2,numpy as np

BASE=Path(__file__).resolve().parent
sys.path.insert(0,str(BASE/'code'))
from owner_mouth_library_v26 import OwnerMouthAtlas, segment_observed_outer_lip

# These are *appearance candidates*, NOT a proven vowel-by-video annotation.
CANDIDATE_STATES={
 'ㅡ':'closed','ㅏ':'very_open','ㅐ':'wide_teeth','ㅔ':'wide_teeth',
 'ㅣ':'wide_teeth','ㅓ':'moderately_open','ㅗ':'round_wide_open','ㅜ':'round_pursed',
 'ㅑ':'very_open','ㅕ':'moderately_open','ㅛ':'round_wide_open','ㅠ':'round_pursed',
 'ㅘ':'round_wide_open','ㅙ':'wide_teeth','ㅚ':'round_wide_open','ㅝ':'round_pursed',
 'ㅞ':'wide_teeth','ㅟ':'round_pursed','ㅢ':'closed','ㅒ':'wide_teeth','ㅖ':'wide_teeth'}

@dataclass
class OralObservation:
    sourceState:str
    mouthRoi:list[int]
    detectedDarkCavityPx:int
    innerOpeningWidthPx:int|None
    innerOpeningHeightPx:int|None
    upperInnerContour:list[list[int]]
    lowerInnerContour:list[list[int]]
    outerLipPixelCount:int
    contourSource:str
    reliableBoundary:bool
    medicalSegmentationValidated:bool=False
    phonemeVerified:bool=False
    teethIdentifiedWithGroundTruth:bool=False


def oral_roi(h=320,w=320):
    return int(.34*w),int(.685*h),int(.68*w),int(.825*h)


def _component_near_center(bin_roi:np.ndarray, min_area=12):
    # Only use actual dark pixels, no fabricated ellipse/cavity.
    n,labs,stats,centr=cv2.connectedComponentsWithStats(bin_roi.astype(np.uint8),8)
    cand=[]
    H,W=bin_roi.shape
    for i in range(1,n):
        x,y,w,h,area=map(int,stats[i]); cx,cy=centr[i]
        if area<min_area or area>(H*W*.68):continue
        # leave the shadow of corners and background out
        penalty=abs(cx-W/2)/max(W,1)*0.35+abs(cy-H*.45)/max(H,1)*.25
        cand.append((area*(1-penalty),i))
    mask=np.zeros_like(bin_roi,np.uint8)
    if cand:mask[labs==max(cand)[1]]=1
    return mask


def segment_opening(frame:np.ndarray,state:str='unknown',external_mask:np.ndarray|None=None):
    h,w=frame.shape[:2]; x0,y0,x1,y1=oral_roi(h,w)
    roi=frame[y0:y1,x0:x1]
    lab=cv2.cvtColor(roi,cv2.COLOR_BGR2LAB)
    light=lab[:,:,0].astype(np.float32)
    # local cheek baseline, robust to lighting. darker region may contain cavity OR lip shadow.
    cheek=cv2.cvtColor(frame[int(.61*h):int(.67*h),int(.4*w):int(.6*w)],cv2.COLOR_BGR2LAB)[:,:,0]
    baseline=float(np.percentile(cheek,55))
    threshold=min(float(np.percentile(light,29)),baseline*.69)
    dark=(light<threshold).astype(np.uint8)
    dark=cv2.morphologyEx(dark,cv2.MORPH_CLOSE,np.ones((3,3),np.uint8))
    dark=cv2.morphologyEx(dark,cv2.MORPH_OPEN,np.ones((2,2),np.uint8))
    # keep dark cavity only inside real observed outer-lip (when available)
    if external_mask is not None:
        lip=external_mask[y0:y1,x0:x1]>0
        lip=cv2.dilate(lip.astype(np.uint8),np.ones((9,9),np.uint8))>0
        dark=np.where(lip,dark,0).astype(np.uint8)
    center=_component_near_center(dark)
    npx=int(center.sum())
    coords=np.argwhere(center>0)
    upper=[];lower=[];width=None;height=None
    if len(coords)>=14:
        yy,xx=coords[:,0],coords[:,1]
        xleft,xright=int(xx.min()),int(xx.max());ytop,ybottom=int(yy.min()),int(yy.max())
        width=xright-xleft+1;height=ybottom-ytop+1
        for x in range(xleft,xright+1):
            ys=np.where(center[:,x]>0)[0]
            if len(ys):
                upper.append([x0+x,y0+int(ys.min())])
                lower.append([x0+x,y0+int(ys.max())])
    # Confidence is only 2D image segmentation plausibility, not a clinical score.
    reliable=bool(npx>=35 and width is not None and width>=7 and height>=4 and height<44)
    if state in ('closed','near_closed'):
        reliable=False;upper=[];lower=[];width=height=None
    mask=np.zeros((h,w),np.uint8);mask[y0:y1,x0:x1]=center*255
    obs=OralObservation(state,[x0,y0,x1,y1],npx,width,height,upper,lower,
        int(np.count_nonzero(external_mask)) if external_mask is not None else 0,
        'actual_image_dark_connected_component_not_verified_inner_lip_label', reliable)
    return mask,obs


def extract_owner_atlas(root:Path, outdir:Path, atlas:OwnerMouthAtlas|None=None):
    outdir.mkdir(parents=True,exist_ok=True)
    atlas=atlas or OwnerMouthAtlas.from_user_videos(root)
    records={}
    for name,im in atlas.images.items():
        try:lip,lip_meta=segment_observed_outer_lip(im)
        except (ValueError,cv2.error):lip=np.zeros(im.shape[:2],np.uint8);lip_meta={'method':'failed'}
        mask,obs=segment_opening(im,name,lip)
        records[name]=asdict(obs)
        cv2.imwrite(str(outdir/f'oral_mask_{name}.png'),mask)
    (outdir/'OWNER_V32_OBSERVABLE_ORAL_ATLAS.json').write_text(json.dumps({
      'sources':'owner-authorized two Speaking MP4 videos',
      'notActualKoreanPhonemeLabels':True,'not3DOralAnatomy':True,'records':records},ensure_ascii=False,indent=2))
    return atlas,records


def render_actual_owner_pixels(atlas:OwnerMouthAtlas,vowel:str):
    """Show natural observed mouth incl. real oral/teeth pixels, never paint a hole."""
    if vowel not in CANDIDATE_STATES:raise ValueError(f'unsupported vowel {vowel}')
    role=CANDIDATE_STATES[vowel]
    source=atlas.images[role]
    base=atlas.base
    h,w=base.shape[:2]
    yy,xx=np.mgrid[:h,:w].astype(np.float32)
    # full lower face (cheeks+mouth+chin) actual source to avoid detached mandible.
    oval=((xx/w-.50)/.36)**2+((yy/h-.56)/.46)**2
    face=np.clip((1.06-oval)/.14,0,1)
    top=np.clip((yy/h-.61)/.12,0,1)
    alpha=np.clip(face*top,0,1)
    # No source leakage into nose/philtrum: upper part fully unchanged.
    alpha[:int(.61*h),:]=0
    # Use real RGB pixels for lower face; not an additive dark aperture.
    blended=np.clip(base.astype(np.float32)*(1-alpha[...,None])+source.astype(np.float32)*alpha[...,None],0,255).astype(np.uint8)
    blended[:int(.61*h),:]=base[:int(.61*h),:]
    info={'candidateVowel':vowel,'observedShapeRole':role,'innerPixelsFromRealOwnerFrame':True,
          'syntheticCavityDrawn':False,'actualKoreanPhonemeVerified':False,
          'maxillaUpper61PctIdentical':bool(np.array_equal(base[:int(.61*h)],blended[:int(.61*h)]))}
    return blended,info


def extract_anatomical_appearance_layers(face:np.ndarray, state:str):
    """Separate observable pixel classes, never label tissue not actually visible.

    Candidate teeth/tongue are heuristic color classes for human review, not
    segmentation ground truth. If uncertain keep mask and confidence explicit.
    """
    h,w=face.shape[:2]
    try: outer,outer_meta=segment_observed_outer_lip(face)
    except (ValueError,cv2.error):outer=np.zeros((h,w),np.uint8);outer_meta={'method':'failed'}
    cavity,obs=segment_opening(face,state,outer)
    lab=cv2.cvtColor(face,cv2.COLOR_BGR2LAB)
    light=lab[:,:,0];red=lab[:,:,1]
    x0,y0,x1,y1=oral_roi(h,w)
    roi=np.zeros((h,w),np.uint8);roi[y0:y1,x0:x1]=255
    # luminance/color heuristics, no teeth geometry synthesized
    outer_d=cv2.dilate(outer,np.ones((7,7),np.uint8))
    localized=cv2.bitwise_and(roi,outer_d)>0
    cheek_L=np.median(light[int(.61*h):int(.66*h),int(.4*w):int(.6*w)])
    cheek_A=np.median(red[int(.61*h):int(.66*h),int(.4*w):int(.6*w)])
    teeth=np.where(localized&(light>min(242,cheek_L+23))&(red<cheek_A+5),255,0).astype(np.uint8)
    tongue=np.where(localized&(red>cheek_A+10)&(light<cheek_L+17)&(light>cheek_L-90),255,0).astype(np.uint8)
    # Teeth/tongue candidates may include reflections/vermilion; do NOT treat as verified.
    return {'outerLip':outer,'innerDarkCavity':cavity,'teethCandidate':teeth,'tongueCandidate':tongue}, {
       'state':state,'annotationProvenance':'source_video_rgb_thresholds','outerLip':outer_meta,
       'inner':asdict(obs),'teethVerified':False,'tongueVerified':False,
       'upperJawBoneInferred':False,'mandibleBoneInferred':False}
