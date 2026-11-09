"""SONG-Vision v37 — train on the OWNER'S recorded audio/video, not synthetic truth.

This code intentionally separates what can be observed (mouth pixels / approximate
chin contour) from what cannot be directly measured in these videos (3D tongue
and bone joint angles). It learns real audio-to-visible-face mapping and weak
vowel classification; its 3D motion output remains conditional and uncertain.

Reproduce:
 python owner_v37_train_real_av.py --video '/private/Pronunciation .mp4' --out /private/results

No user source/weights should be published in the public GitHub repository.
"""
from __future__ import annotations
from dataclasses import asdict
import argparse,json,math,subprocess,sys
from pathlib import Path
import cv2,numpy as np,soundfile as sf
from scipy.signal import stft
from scipy.fft import dct
from scipy.ndimage import gaussian_filter1d
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.linear_model import Ridge, LogisticRegression
from sklearn.metrics import accuracy_score,mean_absolute_error
from sklearn.decomposition import PCA
from owner_v36_audio_inverse import detect_speech_segments,lpc_formants_candidate
from owner_v35_articulatory_3d import vowel_pose,BASE_VOWELS,CONSONANTS,VOWELS,ONSETS

FIRST_TEN=['아','야','어','여','오','요','우','유','으','이']
TEN_VOWELS=['ㅏ','ㅑ','ㅓ','ㅕ','ㅗ','ㅛ','ㅜ','ㅠ','ㅡ','ㅣ']
TARGETS=('oralDarkAreaRatio','oralCandidateWidthRatio','oralCandidateHeightRatio',
         'vermillionCandidateWidthRatio','vermillionCandidateHeightRatio','chinEdgeYRatio')


def extract_audio_pcm(video:Path,audio_path:Path):
    subprocess.run(['ffmpeg','-y','-hide_banner','-loglevel','error','-nostdin','-i',str(video),'-vn',
                    '-ac','1','-ar','16000','-c:a','pcm_s16le',str(audio_path)],check=True)
    audio,sr=sf.read(audio_path)
    if sr!=16000 or audio.ndim!=1:raise RuntimeError('expected 16kHz mono extracted audio')
    return audio,sr


def acoustic_features(samples:np.ndarray,sr:int,start:float,end:float):
    lo=max(0,int((start+.12*(end-start))*sr))
    hi=min(len(samples),int((start+.92*(end-start))*sr))
    y=samples[lo:hi].astype(np.float32)
    if len(y)<512:y=np.pad(y,(0,512-len(y)))
    # Speaker-independent spectral shape plus speaker-specific intensity and dynamics.
    y=np.r_[y[0],y[1:]-.96*y[:-1]]
    _,tt,z=stft(y,fs=sr,nperseg=512,noverlap=256)
    power=np.abs(z)**2
    f=np.linspace(0,sr/2,power.shape[0])
    mel_edges=np.geomspace(80,7800,26)
    bands=[]
    for a,b in zip(mel_edges[:-1],mel_edges[1:]):
        mask=(f>=a)&(f<b)
        bands.append(np.log(np.maximum(power[mask].mean(axis=0),1e-10)) if np.any(mask)
                     else np.full(power.shape[1],-23.))
    bands=np.asarray(bands)
    coefficients=dct(bands,axis=0,norm='ortho')[:15]
    mean=np.mean(coefficients,axis=1);std=np.std(coefficients,axis=1)
    raw=samples[max(0,int(start*sr)):min(len(samples),int(end*sr))]
    chunks=np.array_split(raw,4)
    rms=np.asarray([np.sqrt(np.mean(np.square(q))) if len(q) else 1e-7 for q in chunks])
    return np.r_[mean,std,np.log10(rms+1e-6),np.log10(max(end-start,.03))].astype(np.float32)


def crop_owner_face(frame:np.ndarray,detector,prev=None,size=256):
    small=cv2.resize(frame,(240,240),interpolation=cv2.INTER_AREA)
    g=cv2.cvtColor(small,cv2.COLOR_BGR2GRAY)
    boxes=detector.detectMultiScale(g,1.1,4,minSize=(55,55))
    boxes=[(int(x*frame.shape[1]/240),int(y*frame.shape[0]/240),int(w*frame.shape[1]/240),int(h*frame.shape[0]/240)) for x,y,w,h in boxes]
    if len(boxes):
        x,y,w,h=max(boxes,key=lambda b:b[2]*b[3]);box=np.array([x,y,w,h],np.float32);detected=True
    elif prev is not None:
        box=prev;detected=False
    else:raise ValueError('face missing')
    x,y,w,h=box;cx=x+w*.5;cy=y+h*.54;side=max(w,h)*1.20
    t=np.float32([[cx-side/2,cy-side/2],[cx+side/2,cy-side/2],[cx-side/2,cy+side/2]])
    m=cv2.getAffineTransform(t,np.float32([[0,0],[size-1,0],[0,size-1]]))
    return cv2.warpAffine(frame,m,(size,size),borderMode=cv2.BORDER_REFLECT_101),box,detected


def candidate_mouth_observations(face):
    """Observables are pixel proxies, NOT contour-annotated anatomical truth."""
    h,w=face.shape[:2]
    x0,x1=int(w*.28),int(w*.73)
    y0,y1=int(h*.62),int(h*.88)
    roi=face[y0:y1,x0:x1]
    lab=cv2.cvtColor(roi,cv2.COLOR_BGR2LAB)
    L=lab[:,:,0].astype(np.float32);A=lab[:,:,1].astype(np.float32)
    edge=np.r_[L[:5,:].ravel(),L[-5:,:].ravel(),L[:,:4].ravel(),L[:,-4:].ravel()]
    skinLight=float(np.median(edge))
    skinRed=float(np.median(np.r_[A[:5].ravel(),A[-5:].ravel()]))
    H,W=roi.shape[:2];yy,xx=np.mgrid[:H,:W]
    oval=((xx-W/2)/(.49*W))**2+((yy-H*.51)/(.46*H))**2<1.
    dark=np.uint8((L<skinLight-23)&oval)
    dark=cv2.morphologyEx(dark,cv2.MORPH_OPEN,np.ones((3,3),np.uint8))
    n,labels,stats,cent=cv2.connectedComponentsWithStats(dark,8)
    best=None
    for i in range(1,n):
        bx,by,bw,bh,area=map(int,stats[i]);cx,cy=cent[i]
        sc=area-45*abs(cx/W-.5)-25*abs(cy/H-.51)
        if area>=5 and (best is None or sc>best[0]):best=(sc,i,bw,bh,area)
    if best is None:cavityWidth=cavityHeight=area=0
    else:_,ident,cavityWidth,cavityHeight,area=best
    red=(A>skinRed+7)&oval
    redcol=np.flatnonzero(red.any(axis=0));redrow=np.flatnonzero(red.any(axis=1))
    redwidth=int(np.ptp(redcol))+1 if len(redcol) else 0
    redheight=int(np.ptp(redrow))+1 if len(redrow) else 0
    # Find a *candidate* chin shadow/skin boundary below the visible mouth.
    # A central luminance drop is more reliable here than a cheek/neck chroma
    # difference because this video has warm flat skin lighting.  It remains
    # a 2D camera-space proxy; it is not a detected jaw-bone landmark.
    labFull=cv2.cvtColor(face,cv2.COLOR_BGR2LAB).astype(np.float32)
    low,high=int(.87*h),min(h,int(.996*h))
    strip=labFull[low:high,int(w*.47):int(w*.53),0]
    rows=gaussian_filter1d(np.median(strip,axis=1),1.0)
    reference=float(np.median(rows[:max(3,len(rows)//4)]))
    j=int(np.argmin(rows)) if len(rows) else 0
    chin=(low+j)/h if len(rows) and reference-float(rows[j])>=12 and j>=4 else None
    feats={
       'oralDarkAreaRatio':float(area)/float(H*W),
       'oralCandidateWidthRatio':float(cavityWidth)/W,
       'oralCandidateHeightRatio':float(cavityHeight)/H,
       'vermillionCandidateWidthRatio':float(redwidth)/W,
       'vermillionCandidateHeightRatio':float(redheight)/H,
       'chinEdgeYRatio':chin,
    }
    # Appearance representation, trained as 2D observable visual prior.
    pixels=cv2.resize(cv2.cvtColor(roi,cv2.COLOR_BGR2GRAY),(40,24),interpolation=cv2.INTER_AREA).astype(np.float32)/255.
    return feats,pixels.ravel(),roi


def make_weak_vowel_labels(groups,source_rows):
    """A group of 10 VAD intervals is NOT proof it contains the 10 target vowels."""
    result=[]
    count=0
    for gi,group in enumerate(groups):
        if len(group)==10:
            for pos,(a,b) in enumerate(group):
                result.append({'group':gi,'position':pos,'vowelCandidate':TEN_VOWELS[pos],
                               'syllableCandidate':FIRST_TEN[pos],
                               'startSec':round(a,3),'endSec':round(b,3),
                               'independentlyVerified':False})
            count+=1
    return result,count


def train(video:Path,out:Path):
    out.mkdir(parents=True,exist_ok=True)
    audio,sr=extract_audio_pcm(video,out/'_owner_audio_local_only.wav')
    groups=detect_speech_segments(audio,sr)
    rows=[]
    for gi,g in enumerate(groups):
        for pos,(a,b) in enumerate(g):
            rows.append({'eventIndex':len(rows),'group':gi,'ordinal':pos,'startSec':a,'endSec':b,
                         'humanVerifiedPhone':False,'userReportedOrderApplied':gi==0 and len(g)==10,
                         'weakVowel':TEN_VOWELS[pos] if len(g)==10 and pos<10 else None})
    cap=cv2.VideoCapture(str(video));det=cv2.CascadeClassifier(cv2.data.haarcascades+'haarcascade_frontalface_default.xml')
    X=[];Y=[];pixels=[];ids=[];missing=0
    for row in rows:
        features=[];textures=[]
        for ratio in (.50,):
            t=row['startSec']+(row['endSec']-row['startSec'])*ratio
            cap.set(cv2.CAP_PROP_POS_MSEC,t*1000)
            ok,frame=cap.read()
            if not ok:missing+=1;continue
            try:face,box,detected=crop_owner_face(frame,det)
            except ValueError:missing+=1;continue
            obs,visual,_=candidate_mouth_observations(face)
            features.append(obs);textures.append(visual)
        if not features:
            row['featuresAvailable']=False
            continue
        row['featuresAvailable']=True
        # Chin detection occasionally occluded; use None->missing with training-set only imputation.
        Y.append([float(np.median([q[k] for q in features if q[k] is not None]))
                  if any(q[k] is not None for q in features) else np.nan for k in TARGETS])
        pixels.append(np.mean(textures,axis=0))
        X.append(acoustic_features(audio,sr,row['startSec'],row['endSec']))
        ids.append(row['eventIndex'])
    cap.release()
    X=np.asarray(X,np.float32);Y=np.asarray(Y,np.float32);P=np.asarray(pixels,np.float32);ids=np.asarray(ids)
    group_array=np.asarray([rows[i]['group'] for i in ids]); N=len(X)
    test=np.isin(group_array,[3,7,11,15]);tr=~test
    if tr.sum()<30 or test.sum()<15:raise RuntimeError('Insufficient split for holdout groups')
    # Leave missing chin target out; do not invent training target labels for any sample.
    valid_cols=[];regressor_params={};stats={}
    inputMean=X[tr].mean(axis=0);inputStd=X[tr].std(axis=0)+1e-6
    XX=(X-inputMean)/inputStd
    for j,name in enumerate(TARGETS):
        gtmask=np.isfinite(Y[:,j]); trainmask=tr&gtmask;evalmask=test&gtmask
        if trainmask.sum()<25 or evalmask.sum()<5:
            stats[name]={'status':'not_enough_observations','train':int(trainmask.sum()),'heldout':int(evalmask.sum())}
            continue
        avg=float(Y[trainmask,j].mean())
        sd=float(Y[trainmask,j].std()+1e-4)
        reg=Ridge(alpha=70.0).fit(XX[trainmask],(Y[trainmask,j]-avg)/sd)
        predictions=reg.predict(XX[evalmask])*sd+avg
        baseline=np.full(evalmask.sum(),avg)
        mae=float(mean_absolute_error(Y[evalmask,j],predictions))
        base=float(mean_absolute_error(Y[evalmask,j],baseline))
        passing=bool(mae<base*.97)
        stats[name]={'status':'passed' if passing else 'not_better_than_baseline','train':int(trainmask.sum()),'heldout':int(evalmask.sum()),
             'mae':round(mae,5),'staticBaselineMAE':round(base,5),'relativeImprovementPct':round((1-mae/base)*100,2) if base else None}
        valid_cols.append(name)
        regressor_params[name]={'coef':reg.coef_.tolist(),'intercept':float(reg.intercept_),
                                'targetMean':avg,'targetStd':sd,'enabled':passing}
    # Visual texture PCA shows meaningful speaker appearance basis but is not voice->video sync.
    pca=PCA(n_components=min(12,int(tr.sum())-1),svd_solver='randomized',random_state=37).fit(P[tr]);px=pca.inverse_transform(pca.transform(P[test]))
    imgMAE=float(np.mean(np.abs(P[test]-px)));imgBase=float(np.mean(np.abs(P[test]-P[tr].mean(axis=0))))
    # Weak-label vowel probe: strictly separate complete *groups*, not interleaved frames.
    avail=[i for i,idv in enumerate(ids) if rows[idv]['weakVowel'] is not None]
    tempX=XX[avail];tempY=np.asarray([TEN_VOWELS.index(rows[ids[i]]['weakVowel']) for i in avail]);tempGroups=group_array[avail]
    trainv=~np.isin(tempGroups,[11,13]);testv=np.isin(tempGroups,[11,13]);weakAcc=None
    if trainv.sum()>30 and testv.sum()>10 and len(set(tempY[trainv]))==10:
        cl=LogisticRegression(C=.25,max_iter=600).fit(tempX[trainv],tempY[trainv]);pred=cl.predict(tempX[testv]);weakAcc=float(accuracy_score(tempY[testv],pred))
        labelParams={'weights':cl.coef_.tolist(),'bias':cl.intercept_.tolist(),'classes':cl.classes_.tolist(),
                     'heldout10VowelSequenceAgreement':weakAcc,'validatedLabels':False}
    else:labelParams=None
    # Fit an observed 2D aperture -> virtual jaw control transfer. This maps visual
    # parameters to a *model* jaw rotation, not actual TMJ angle measurement.
    ap=Y[tr,2];ap=ap[np.isfinite(ap)]
    lo,hi=map(float,np.percentile(ap,[10,90])) if len(ap)>10 else (0.,1.)
    if hi-lo<.04:lo,hi=0.,max(.1,hi)
    # Bounds match v35 RigControls. No other regions stretched.
    jawMapping={'apertureHeightRatioP10':lo,'apertureHeightRatioP90':hi,
                'minJawRad':0.015,'maxJawRad':0.245,
                'source':'observed_2D_mouth_aperture_calibration_not_bone_angle_truth',
                'anatomicalTmjAngleMeasured':False}
    pack={'inputMean':inputMean,'inputStd':inputStd,'pcaMean':pca.mean_,'pcaComponents':pca.components_,
          'pcaVariance':pca.explained_variance_ratio_,'modelVersion':np.asarray(['v37_owner_actual_audio_video'])}
    for name,d in regressor_params.items():
        pack[name+'_coef']=np.array(d['coef']);pack[name+'_intercept']=np.asarray([d['intercept']]);pack[name+'_mean']=np.asarray([d['targetMean']]);pack[name+'_std']=np.asarray([d['targetStd']]);pack[name+'_enabled']=np.asarray([d['enabled']])
    if labelParams:
        pack['weakVowelCoef']=np.array(labelParams['weights']);pack['weakVowelBias']=np.array(labelParams['bias']);pack['weakVowelClasses']=np.array(labelParams['classes'])
    np.savez_compressed(out/'OWNER_V37_AV_MODEL_PRIVATE.npz',**pack)
    (out/'OWNER_V37_RIG_MAPPING.json').write_text(json.dumps(jawMapping,indent=2,ensure_ascii=False))
    summary={'schema':'song-v37-training-report','source':'owner supplied actual audio+video','video':video.name,'durationSec':round(len(audio)/sr,3),
      'sourceFramesPerSpeechEvent':1,'segmentation':'energy VAD; not ASR',
      'VADgroups':[len(q) for q in groups],'VADspeechCandidateEvents':len(rows),'trainingWithMeasuredPixels':int(tr.sum()),'groupHoldoutEvents':int(test.sum()),
      'featureRows':N,'unsampledVideoFrames':int(missing),'holdoutGroupIds':[3,7,11,15],
      'audioToOwnerVisible2DTargets':stats,'observedMouthPCA':{'dim':int(pca.n_components_),'heldoutReconstructionMAE':round(imgMAE,6),'staticMeanMAE':round(imgBase,6)},
      'weakVowelClassification':{'groupsUsed':[int(x) for x in sorted(set(tempGroups))],'heldoutGroupIds':[11,13],
             'heldoutSamples':int(testv.sum()),'sequenceAgreement':weakAcc,'independentlyVerifiedPronunciationAccuracy':None},
      '3DRigMapping':jawMapping,'observed3DTongue':False,'observedJawBoneAngle':False,
      'research3DTongueMotorPrior':True,'verifiedPhoneLabels':0,
      'deploymentGate':'PREVIEW_ONLY_BECAUSE_NO_OWNER_3D_TONGUE_OR_CONFIRMED_TIMINGS',
      'trainedFromUserVoiceAndVideo':True,'trainedFromSyntheticTongueOnly':False,
      'statisticalCaution':'Holdouts are from same speaker/video, not unseen identity. Mouth targets are imperfect color/contrast/chin proxies. Weak vowel matches are not ASR accuracy.'}
    (out/'OWNER_V37_TRAINING_REPORT.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2))
    (out/'OWNER_V37_PRIVATE_EVENTS.json').write_text(json.dumps({'containsFacialData':True,'rows':rows,'featureTargets':Y.tolist()},ensure_ascii=False))
    return summary


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--video',type=Path,required=True);p.add_argument('--out',type=Path,required=True)
    a=p.parse_args();r=train(a.video,a.out);print(json.dumps(r,ensure_ascii=False,indent=2))
