"""SONG-Vision v26: observation-driven mouth appearance & contour library.

Uses real mouth pixels from owner-provided speaking videos. Shape categories are
manual *visual observations* of frames, never phoneme ground-truth labels.
No synthetic teeth bands or drawn dark cavity are used. The mouth patches are
transferred from real frames, with bounded local shape morph and feathered seam.

Mediapipe/dlib landmark tracking may replace the current fallback ROI later;
we do not claim to have reconstructed a hidden 3D oral cavity from monocular video.
"""
from __future__ import annotations
from dataclasses import dataclass, asdict
from pathlib import Path
import hashlib, json, cv2, numpy as np
from scipy.ndimage import gaussian_filter

CANVAS=320
# Frames visually examined: labels are appearance states, NOT transcriptions.
SOURCE_TIMES={
    'closed':('IMG_0853.mp4',7.60),
    'near_closed':('IMG_0853.mp4',14.30),
    'round_pursed':('IMG_0853.mp4',5.00),
    'round_wide_open':('IMG_0854.mp4',26.20),
    'wide_teeth':('IMG_0853.mp4',2.40),
    'moderately_open':('IMG_0853.mp4',22.60),
    'very_open':('IMG_0853.mp4',1.00),
    'wide_open_smile':('IMG_0854.mp4',32.00),
}

# The explicit style targets can later be fitted from human-labelled vowel data.
# These are designed shapes, not Korean speaker norm values.
VOWEL_TARGETS={
  'ㅗ':dict(state='round_pursed',width=.80,height=1.10,inner=.88,pucker=1.0),
  'ㅜ':dict(state='round_wide_open',width=.82,height=1.04,inner=1.15,pucker=.80),
  'ㅣ':dict(state='wide_teeth',width=1.13,height=.82,inner=1.00,pucker=.03),
  'ㅡ':dict(state='near_closed',width=1.13,height=.77,inner=.66,pucker=.00),
  'ㅏ':dict(state='very_open',width=1.06,height=1.29,inner=1.35,pucker=.0),
  'ㅓ':dict(state='moderately_open',width=1.06,height=1.12,inner=1.17,pucker=.04),
  'ㅔ':dict(state='wide_teeth',width=1.12,height=.94,inner=1.05,pucker=.03),
  'ㅐ':dict(state='wide_teeth',width=1.12,height=.94,inner=1.05,pucker=.03),
  'ㅑ':dict(state='very_open',width=1.06,height=1.22,inner=1.3,pucker=.0),
  'ㅕ':dict(state='moderately_open',width=1.02,height=1.08,inner=1.15,pucker=.03),
  'ㅛ':dict(state='round_pursed',width=.82,height=1.18,inner=1.04,pucker=.96),
  'ㅠ':dict(state='round_wide_open',width=.82,height=1.09,inner=1.18,pucker=.80),
}

@dataclass(frozen=True)
class ObservedFrame:
    role:str
    filename:str
    seconds:float
    sourceSha256:str
    faceBox:list[int]
    widthPx:int
    heightPx:int
    darkCenterAreaPx:int
    centralDarkAspect:float|None
    lipColorExcess:float
    outerLipWidthPx:int=0
    outerLipHeightPx:int=0
    outerLipAspect:float|None=None
    outerLipMaskArea:int=0
    trackingIsExact:bool=False
    phonemeAnnotationPresent:bool=False


def detect_face_crop(frame,size=CANVAS):
    cascade=cv2.CascadeClassifier(cv2.data.haarcascades+'haarcascade_frontalface_default.xml')
    boxes=cascade.detectMultiScale(cv2.cvtColor(frame,cv2.COLOR_BGR2GRAY),1.08,4,minSize=(90,90))
    if not len(boxes):raise ValueError('Cannot detect source face: no fallback to another person')
    x,y,w,h=max(boxes,key=lambda b:int(b[2])*int(b[3]))
    side=int(round(max(w,h)*1.32));cx=x+w//2;cy=y+h//2
    x0=max(0,cx-side//2);y0=max(0,cy-side//2)
    roi=frame[y0:min(y0+side,frame.shape[0]),x0:min(x0+side,frame.shape[1])]
    if roi.shape[0]<side*.96 or roi.shape[1]<side*.96:raise ValueError('Source face too close to frame edge')
    return cv2.resize(roi,(size,size),interpolation=cv2.INTER_AREA),[int(x),int(y),int(w),int(h)]


def load_video_face(video:Path,seconds:float,size:int=CANVAS):
    cap=cv2.VideoCapture(str(video))
    if not cap.isOpened():raise FileNotFoundError(video)
    cap.set(cv2.CAP_PROP_POS_MSEC,float(seconds)*1000)
    ok,img=cap.read();cap.release()
    if not ok:raise ValueError(f'Cannot load source {video.name} at {seconds}s')
    return detect_face_crop(img,size)


def _measure_patch(face):
    h,w=face.shape[:2]
    # Measured only in the central mouth: shadows are a PROXY for oral aperture.
    x0,x1=round(w*.38),round(w*.62);y0,y1=round(h*.705),round(h*.797)
    roi=cv2.cvtColor(face[y0:y1,x0:x1],cv2.COLOR_BGR2GRAY)
    gray=cv2.cvtColor(face,cv2.COLOR_BGR2GRAY)
    skin=np.median(gray[round(h*.60):round(h*.65),round(w*.40):round(w*.60)])
    binary=(roi<skin*.73).astype(np.uint8)
    # ignore tiny chromatic lip gradients; estimate dark cavity and shadows, not an anatomical inner lip contour
    binary=cv2.morphologyEx(binary,cv2.MORPH_OPEN,np.ones((2,2),np.uint8))
    n=int(binary.sum());ys,xs=np.where(binary>0)
    if len(xs)>10:
        sx=np.percentile(xs,[10,90]);sy=np.percentile(ys,[10,90])
        ratio=float((sx[1]-sx[0]+.1)/(sy[1]-sy[0]+.1))
    else:ratio=None
    lab=cv2.cvtColor(face,cv2.COLOR_BGR2LAB)
    lip=float(np.mean(lab[round(h*.72):round(h*.78),round(w*.39):round(w*.61),1]))
    cheek=float(np.mean(lab[round(h*.57):round(h*.63),round(w*.39):round(w*.61),1]))
    return n,ratio,lip-cheek



def segment_observed_outer_lip(face):
    """Actual RGB lip-contour estimate via seeded GrabCut, not a fixed oval.

    Seed geometry only restricts the search region. The outer contour itself is
    estimated from the owner's image colour and texture. It can still be wrong
    on unusual lighting, moustaches, makeup or motion blur; this is not a
    verified anatomical segmentation model.
    """
    h,w=face.shape[:2]
    yy,xx=np.mgrid[:h,:w].astype(np.float32)
    X=xx/w;Y=yy/h
    masks=np.full((h,w),cv2.GC_BGD,np.uint8)
    masks[(X>.31)&(X<.69)&(Y>.67)&(Y<.84)]=cv2.GC_PR_BGD
    masks[(((X-.5)/.155)**2+((Y-.745)/.074)**2)<1]=cv2.GC_PR_FGD
    masks[(((X-.5)/.075)**2+((Y-.747)/.030)**2)<1]=cv2.GC_FGD
    cv2.grabCut(face,masks,None,np.zeros((1,65),np.float64),np.zeros((1,65),np.float64),
                3,cv2.GC_INIT_WITH_MASK)
    raw=np.isin(masks,[cv2.GC_FGD,cv2.GC_PR_FGD]).astype(np.uint8)
    contours,_=cv2.findContours(raw,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE)
    contours=sorted(contours,key=cv2.contourArea,reverse=True)
    if not contours or cv2.contourArea(contours[0])<w*h*.0002:
        raise ValueError('No lip contour with sufficient pixels')
    lip=np.zeros((h,w),np.uint8)
    cv2.drawContours(lip,contours[:1],-1,255,-1)
    x,y,ww,hh=cv2.boundingRect(contours[0])
    return lip,dict(outerLipWidthPx=ww,outerLipHeightPx=hh,
                   outerLipAspect=round(ww/max(1,hh),5),
                   outerLipMaskArea=int(np.count_nonzero(lip)),
                   method='colour_texture_GrabCut_seeds_approximate',
                   innerOralContourVerified=False)


def _alignment_fixed_upper_face(base,source):
    """Translate source to base via upper-face ECC; mouth is excluded from fit."""
    h,w=base.shape[:2]
    a=cv2.cvtColor(base,cv2.COLOR_BGR2GRAY)
    b=cv2.cvtColor(source,cv2.COLOR_BGR2GRAY)
    mask=np.zeros((h,w),np.uint8)
    mask[int(.20*h):int(.66*h),int(.26*w):int(.74*w)]=255
    m=np.eye(2,3,dtype=np.float32)
    try:
        score,m=cv2.findTransformECC(a,b,m,cv2.MOTION_EUCLIDEAN,
                          (cv2.TERM_CRITERIA_EPS|cv2.TERM_CRITERIA_COUNT,65,1e-5),mask,5)
        if not np.isfinite(score) or score<.48:raise cv2.error('alignment confidence low')
        if abs(m[0,2])>w*.06 or abs(m[1,2])>h*.06 or abs(np.arctan2(m[1,0],m[0,0]))>.07:
            raise cv2.error('large rigid pose mismatch')
        aligned=cv2.warpAffine(source,m,(w,h),flags=cv2.WARP_INVERSE_MAP|cv2.INTER_LINEAR,borderMode=cv2.BORDER_REFLECT_101)
        return aligned,float(score),True
    except (cv2.error,ValueError):
        return source.copy(),0.,False


class OwnerMouthAtlas:
    def __init__(self,base,images,metadata,alignment):
        self.base=base.copy();self.images=images;self.meta=metadata;self.alignment=alignment

    @classmethod
    def from_user_videos(cls,folder:Path,out_dir:Path|None=None,size=CANVAS):
        images={}; metadata={};alignments={}
        for role,(filename,sec) in SOURCE_TIMES.items():
            file=folder/filename
            if not file.exists():raise FileNotFoundError(file)
            image,box=load_video_face(file,sec,size)
            pixels,aspect,color=_measure_patch(image)
            _,lip_mask_metrics=segment_observed_outer_lip(image)
            metadata[role]=ObservedFrame(role,filename,sec,hashlib.sha256(file.read_bytes()).hexdigest(),box,
                         size,size,pixels,aspect,color,
                         lip_mask_metrics['outerLipWidthPx'],lip_mask_metrics['outerLipHeightPx'],
                         lip_mask_metrics['outerLipAspect'],lip_mask_metrics['outerLipMaskArea'])
            images[role]=image
        base=images['closed'].copy()
        # Registration uses the actual upper face (eyes/nose) and never lip pixels.
        for role,im in images.items():
            aligned,score,ok=_alignment_fixed_upper_face(base,im)
            if role=='closed':aligned=base;ok=True;score=1.0
            images[role]=aligned
            alignments[role]={'upperFaceECC':round(score,4),'accepted':bool(ok)}
        atlas=cls(base,images,metadata,alignments)
        if out_dir:
            out_dir.mkdir(parents=True,exist_ok=True)
            obj={'dataRole':'owner_real_mouth_patches_unlabelled_speech',
                 'noPhonemeGroundTruth':True,'realTeethAndCavityPixels':True,
                 'notBoneOrMuscleReconstruction':True,
                 'sources':[asdict(v) for v in metadata.values()],
                 'registration':alignments}
            (out_dir/'OWNER_V26_OBSERVED_MOUTH_ATLAS_PRIVATE.json').write_text(json.dumps(obj,ensure_ascii=False,indent=2))
        return atlas


def _local_lip_morph(image:np.ndarray,width_scale:float,height_scale:float,inner_scale:float=1):
    """Pixel remap of *real observed* lip texture; preserves outside lip region."""
    h,w=image.shape[:2];cy=h*.748;cx=w*.50
    yy,xx=np.mgrid[0:h,0:w].astype(np.float32)
    # Center of the mouth is remapped with both inner and outer lip rings.
    d2=((xx-cx)/(w*.18))**2+((yy-cy)/(h*.081))**2
    active=np.exp(-1.35*d2).astype(np.float32)
    inner=np.exp(-3.1*d2).astype(np.float32)
    sw=1+(width_scale-1)*active + .25*(inner_scale-1)*inner
    sh=1+(height_scale-1)*active + .28*(inner_scale-1)*inner
    mx=cx+(xx-cx)/np.maximum(.65,sw)
    my=cy+(yy-cy)/np.maximum(.65,sh)
    warped=cv2.remap(image,mx.astype('float32'),my.astype('float32'),interpolation=cv2.INTER_CUBIC,borderMode=cv2.BORDER_REFLECT_101)
    return warped


def _blend_mask(h,w):
    yy,xx=np.mgrid[0:h,0:w].astype(np.float32)
    X=xx/w;Y=yy/h
    # Mouth active: actual recorded upper/lower lips, corners, chin and cheeks.
    lip=np.exp(-.5*(((X-.50)/.175)**4 + ((Y-.744)/.087)**4)).astype(np.float32)
    jaw=np.exp(-.5*(((X-.50)/.19)**2+((Y-.844)/.06)**2)).astype(np.float32)*.13
    cheek=(np.exp(-.5*(((X-.28)/.07)**2+((Y-.64)/.06)**2))+
           np.exp(-.5*(((X-.72)/.07)**2+((Y-.64)/.06)**2)))*.065
    alpha=np.clip(lip*.98+jaw+cheek,0,.98)
    # Absolutely NO changes to the eye and nose; mouth patch carries real texture only.
    alpha[Y<.585]=0.
    # Conservative face interior, with hard zero background and hair boundary.
    oval=((X-.50)/.38)**2 + ((Y-.53)/.48)**2
    dist=cv2.distanceTransform((oval<1).astype(np.uint8),cv2.DIST_L2,3)
    falloff=np.clip((dist-min(h,w)*.04)/(min(h,w)*.08),0,1)
    alpha*=falloff
    alpha[oval>=1]=0.
    alpha[alpha<.03]=0.
    return alpha.astype(np.float32)


def render_observed_mouth(atlas:OwnerMouthAtlas,vowel:str,view_strength:float=1.0):
    """Blend a transformed *observed mouth frame* into the immutable base face."""
    cfg=VOWEL_TARGETS.get(vowel)
    if cfg is None:raise ValueError('Vowel not supported by observed atlas')
    state=cfg['state']
    src=atlas.images[state]
    warped=_local_lip_morph(src,1+(cfg['width']-1)*view_strength,
                              1+(cfg['height']-1)*view_strength,
                              1+(cfg['inner']-1)*view_strength)
    base=atlas.base.astype(np.float32)
    alpha=_blend_mask(*base.shape[:2])[:,:,None]
    # local luminance offset estimated at invariant skin band above lips, bounded
    source=warped.astype(np.float32)
    base_skin=np.median(base[int(.62*len(base)):int(.66*len(base)),int(.42*len(base)):int(.58*len(base))],axis=(0,1))
    other_skin=np.median(source[int(.62*len(base)):int(.66*len(base)),int(.42*len(base)):int(.58*len(base))],axis=(0,1))
    source=np.clip(source+np.clip(base_skin-other_skin,-10,10)[None,None,:],0,255)
    out=np.clip(base*(1-alpha)+source*alpha,0,255).astype(np.uint8)
    region=(alpha[:,:,0]>.02)
    return out,{'vowel':vowel,'observedShapeState':state,
                'sourceFile':atlas.meta[state].filename,
                'sourceAtSeconds':atlas.meta[state].seconds,
                'sourceHasMeasuredPhonemeLabel':False,
                'ownerPixelsUsedForTeethCavityAndLips':True,
                'outerLipDeformationFromRealSample':True,
                'outsidePixelChangeCount':int(np.count_nonzero(np.any(out[~region]!=atlas.base[~region],axis=1))),
                'mouthBlendMeanDifferenceRGB255':round(float(np.abs(out.astype('float32')-base).mean()),4)}


def render_transition(atlas,from_vowel,to_vowel,progress):
    """Linear interpolation of geometrically transformed observed mouth states.
    This is a preview crossfade, NOT a phoneme physically solved motion path.
    """
    t=np.clip(progress,0,1);t=t*t*(3-2*t)
    a,ma=render_observed_mouth(atlas,from_vowel)
    b,mb=render_observed_mouth(atlas,to_vowel)
    frame=cv2.addWeighted(a,1-float(t),b,float(t),0)
    return frame,{'transitionPreviewOnly':True,'sourceStates':[ma['observedShapeState'],mb['observedShapeState']]}