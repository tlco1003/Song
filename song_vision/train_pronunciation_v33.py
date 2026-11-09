"""SONG-Vision v33: learn a visual mouth-motion prior from the owner's recorded pronunciation video.

Performs actual audio VAD, extracts corresponding video mouth/cheek proxies, fits
PCA (not a speech-to-video model), and creates review candidates.  The owner's
spoken ordering is weak supervision, NOT independently verified ASR/phoneme GT.

Usage:
 python train_pronunciation_v33.py --video pronunciation_25mb.mp4 --output results

Dependencies: Python 3.11+, cv2, numpy, scipy, soundfile, scikit-learn, ffmpeg.
The video is private user data.  Do NOT commit the raw source or learned tensors
into a public repository; public commit should include only scripts and demos.
"""
from __future__ import annotations
import argparse,csv,json,math,subprocess
from pathlib import Path
import numpy as np
import cv2, soundfile as sf
from scipy.ndimage import gaussian_filter1d,binary_closing
from sklearn.decomposition import PCA
from sklearn.metrics import mean_absolute_error

VOWELS=['ㅏ','ㅑ','ㅓ','ㅕ','ㅗ','ㅛ','ㅜ','ㅠ','ㅡ','ㅣ']
ONSETS=['ㅇ','ㄱ','ㄴ','ㄷ','ㄹ','ㅁ','ㅂ','ㅅ','ㅇ','ㅈ','ㅋ','ㅌ','ㅍ','ㅎ']
# ㅇ is repeated intentionally: initial vowel-only sequence followed by ㅇ+vowel row.
ONSETS_OTHER=['ㄱ','ㄴ','ㄷ','ㄹ','ㅁ','ㅂ','ㅅ','ㅇ','ㅈ','ㅋ','ㅌ','ㅍ','ㅎ']


def generate_script():
    script=[{'row':0,'onset':'ㅇ','vowel':v,'syllable':'아야어여오요우유으이'[i], 'targetStatus':'user_supplied_order_not_audio_verified'} for i,v in enumerate(VOWELS)]
    onset_no={'ㄱ':0,'ㄴ':2,'ㄷ':3,'ㄹ':5,'ㅁ':6,'ㅂ':7,'ㅅ':9,'ㅇ':11,'ㅈ':12,'ㅋ':15,'ㅌ':16,'ㅍ':17,'ㅎ':18}
    jung=['ㅏ','ㅑ','ㅓ','ㅕ','ㅗ','ㅛ','ㅜ','ㅠ','ㅡ','ㅣ']; jungs=['ㅏ','ㅐ','ㅑ','ㅒ','ㅓ','ㅔ','ㅕ','ㅖ','ㅗ','ㅘ','ㅙ','ㅚ','ㅛ','ㅜ','ㅝ','ㅞ','ㅟ','ㅠ','ㅡ','ㅢ','ㅣ']
    for row,onset in enumerate(ONSETS_OTHER,1):
        for v in jung:
            ch=chr(0xAC00+(onset_no[onset]*21+jungs.index(v))*28)
            script.append({'row':row,'onset':onset,'vowel':v,'syllable':ch,'targetStatus':'user_supplied_order_not_audio_verified'})
    return script


def decode_audio(video,out_wav):
    subprocess.run(['ffmpeg','-y','-hide_banner','-loglevel','error','-nostdin','-i',str(video),'-vn','-ac','1','-ar','16000','-c:a','pcm_s16le',str(out_wav)],check=True)
    return sf.read(out_wav)


def detect_speech(audio,sr, threshold_db=-40, closing_frames=7, min_dur=.15):
    hop=int(sr*.01); window=int(sr*.03); n=(len(audio)-window)//hop
    frames=np.lib.stride_tricks.sliding_window_view(audio[:n*hop+window],window)[::hop][:n]
    rms=np.sqrt(np.mean(frames*frames,axis=1)); smooth=gaussian_filter1d(rms,2)
    db=20*np.log10(smooth+1e-6)
    voice=binary_closing(db>threshold_db,iterations=closing_frames)
    changes=np.flatnonzero(np.diff(np.r_[False,voice,False]))
    spans=[(round(a*hop/sr,3),round(b*hop/sr,3)) for a,b in zip(changes[::2],changes[1::2]) if (b-a)*hop/sr>=min_dur]
    groups=[]
    for a,b in spans:
        if not groups or a-groups[-1][-1][1]>1.5:groups.append([])
        groups[-1].append((a,b))
    items=[]
    for gi,grp in enumerate(groups):
        for k,(a,b) in enumerate(grp):
            items.append({'group':gi,'positionInGroup':k,'startSec':a,'endSec':b,'durationSec':round(b-a,3),'audioLabelVerified':False,'syllable':None,'vowel':None,'onset':None})
    # The first 10 are assigned by the user's first sequence, pending acoustic/visual review.
    if len(groups)>0 and len(groups[0])==10:
        for item in items[:10]:
            i=item['positionInGroup'];item.update({'syllable':'아야어여오요우유으이'[i],'vowel':VOWELS[i],'onset':'ㅇ','labelProvenance':'user_reported_first_ten_order','audioLabelVerified':False})
    return items,groups,db


def mouth_face_crop(frame, detector, prev=None, size=256):
    gray=cv2.cvtColor(frame,cv2.COLOR_BGR2GRAY)
    faces=detector.detectMultiScale(gray,scaleFactor=1.10,minNeighbors=4,minSize=(110,110))
    if len(faces):
        x,y,w,h=sorted(faces,key=lambda b:b[2]*b[3],reverse=True)[0]
        # landmarks-free ROI. Face/camera head motion normalized by Haar bounding square.
        face_box=np.array([x,y,w,h],np.float32)
    elif prev is not None:
        face_box=prev.copy()
    else:
        raise ValueError('face_not_detected')
    x,y,w,h=face_box
    side=float(max(w,h)*1.18)
    cx=x+w*.5;cy=y+h*.54
    x0=cx-side/2; y0=cy-side/2
    pts=np.float32([[x0,y0],[x0+side,y0],[x0,y0+side]])
    target=np.float32([[0,0],[size-1,0],[0,size-1]])
    face=cv2.warpAffine(frame,cv2.getAffineTransform(pts,target),(size,size),flags=cv2.INTER_LINEAR,borderMode=cv2.BORDER_REFLECT_101)
    return face,face_box


def extract_mouth(face):
    size=face.shape[0]
    # Normalized face ROI based on frontal face detector. Not anatomical landmarks.
    mouth=face[int(.61*size):int(.84*size),int(.31*size):int(.69*size)]
    if min(mouth.shape[:2])<20: raise ValueError('mouth roi too small')
    patch=cv2.resize(mouth,(48,32),interpolation=cv2.INTER_AREA)
    gray=cv2.cvtColor(mouth,cv2.COLOR_BGR2GRAY)
    lab=cv2.cvtColor(mouth,cv2.COLOR_BGR2LAB)
    L=lab[...,0].astype(np.float32); A=lab[...,1].astype(np.float32)
    # relative local skin brightness; avoid absolute dark ellipse in the original picture.
    border=np.r_[L[:5,:].ravel(),L[-5:,:].ravel(),L[:,:5].ravel(),L[:,-5:].ravel()]
    bg=float(np.median(border))
    redness=float(np.median(np.r_[A[:4,:].ravel(),A[-4:,:].ravel()]))
    h,w=gray.shape[:2];Y,X=np.mgrid[:h,:w];cx=(w-1)*.5;cy=(h-1)*.50
    oval=(((X-cx)/(.48*w))**2+((Y-cy)/(.47*h))**2)<=1
    # candidate = mouth darkness or redder-than-surrounding; not medical segmentation.
    dark=(L<(bg-22))&oval
    red=(A>(redness+7))&oval
    mask=(dark.astype(np.uint8))*255
    mask=cv2.morphologyEx(mask,cv2.MORPH_OPEN,np.ones((3,3),np.uint8))
    contours,_=cv2.findContours(mask,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE)
    best=None
    for contour in contours:
        area=cv2.contourArea(contour); x,y,cw,ch=cv2.boundingRect(contour)
        dist=abs((x+cw*.5)-cx)/(w*.5)+.75*abs((y+ch*.5)-cy)/(h*.5)
        score=area-25*dist
        if best is None or score>best[0]:best=(score,contour,(x,y,cw,ch),area)
    if best and best[3]>=6:
        _,_,(bx,by,bw,bh),barea=best
        opening_area=float(barea)
        opening_width=float(bw);opening_height=float(bh)
    else: opening_area=opening_width=opening_height=0.0
    # lip red/skin visible features, not guaranteed vermilion contour.
    red_cols=np.any(red,axis=0)
    red_rows=np.any(red,axis=1)
    red_width=int(np.ptp(np.flatnonzero(red_cols))+1) if np.any(red_cols) else 0
    red_height=int(np.ptp(np.flatnonzero(red_rows))+1) if np.any(red_rows) else 0
    # PCA training tensor from real measured pixels.
    small=cv2.cvtColor(patch,cv2.COLOR_BGR2GRAY).astype(np.float32)/255
    features={
      'oralDarkCandidateAreaPx':round(opening_area,2),
      'oralCandidateWidthPx':round(opening_width,2),
      'oralCandidateHeightPx':round(opening_height,2),
      'lipRedCandidateWidthPx':red_width,'lipRedCandidateHeightPx':red_height,
      'mouthROIWidthPx':w,'mouthROIHeightPx':h,
      'darkMaskShare':round(float(np.mean(dark)),4),
    }
    return small.reshape(-1),features,mouth,mask


def get_frame_at(cap,t):
    cap.set(cv2.CAP_PROP_POS_MSEC,max(0,float(t))*1000)
    ok,frame=cap.read()
    if not ok:raise RuntimeError(f'video frame unavailable at {t}')
    return frame


def fit_and_export(video:Path,output:Path):
    output.mkdir(parents=True,exist_ok=True)
    audio_file=output/'pronunciation_audio_16k.wav'
    audio,sr=decode_audio(video,audio_file)
    items,groups,db=detect_speech(audio,sr)
    script=generate_script()
    detector=cv2.CascadeClassifier(cv2.data.haarcascades+'haarcascade_frontalface_default.xml')
    cap=cv2.VideoCapture(str(video))
    measurements=[];latent=[]; event_tensors=[];face_fail=0
    # 3 temporal samples per speech event. Match sound and video timestamps.
    for i,item in enumerate(items):
        a,b=item['startSec'],item['endSec'];duration=b-a
        samples=[];ftrs=[];blocks=[]
        for phase in (.18,.50,.82):
            t=a+duration*phase
            try:
                frame=get_frame_at(cap,t)
                face,fb=mouth_face_crop(frame,detector)
                tensor,metrics,mouth,mask=extract_mouth(face)
                samples.append(tensor); ftrs.append(metrics)
            except Exception as e:
                face_fail+=1
        if samples:
            vector=np.mean(np.vstack(samples),axis=0)
            flat={key:round(float(np.median([z[key] for z in ftrs])),4) for key in ftrs[0]}
            result={**item,'featureValid':True,'sampleTimesSec':[round(a+(b-a)*p,3) for p in (.18,.50,.82)],**flat}
            latent.append(vector);event_tensors.append(i)
        else: result={**item,'featureValid':False,'error':'face_not_detected'}
        measurements.append(result)
    cap.release()
    X=np.array(latent,dtype=np.float32)
    valid=np.array(event_tensors)
    if X.shape[0]<20: raise RuntimeError('too few valid owner mouth frames')
    train_mask=valid%5!=0;test_mask=~train_mask
    # Actual training: PCA on owner mouth pixels with temporally disjoint segment holdout.
    mean=X[train_mask].mean(axis=0)
    pca=PCA(n_components=min(12,int(train_mask.sum())-1),svd_solver='randomized',random_state=33)
    pca.fit(X[train_mask])
    pred=pca.inverse_transform(pca.transform(X[test_mask]))
    mae=float(np.mean(np.abs(X[test_mask]-pred)))
    baseline=float(np.mean(np.abs(X[test_mask]-mean)))
    # First 10 vowel prototypes: weak labels, each has only one utterance.
    first=np.arange(10)
    proto_raw={}
    for i in first:
        if i in valid:
            index=int(np.where(valid==i)[0][0]);proto_raw[VOWELS[i]]=pca.transform(X[index:index+1])[0].tolist()
    np.savez_compressed(output/'OWNER_V33_MOUTH_MOTION_PRIOR_PRIVATE.npz',pca_mean=pca.mean_,pca_components=pca.components_,pca_explained_variance=pca.explained_variance_ratio_,vowel_prototype_labels=np.array(list(proto_raw)),vowel_prototypes=np.array(list(proto_raw.values()),dtype=np.float32),training_segments=valid[train_mask],holdout_segments=valid[test_mask]);
    report={
      'modelVersion':'SONG_V33_OWNER_AUDIO_VISUAL_WEAK_LABEL',
      'videoSourceFilename':video.name,
      'durationSec':round(len(audio)/sr,3),'videoFps':float(cv2.VideoCapture(str(video)).get(cv2.CAP_PROP_FPS)),
      'expectedUserScriptSyllables':len(script),
      'speechSegmentsCandidateCount':len(items),'speechGroups':len(groups),
      'groupSizes':[len(g) for g in groups],
      'firstTenProvisionalLabels':[e['syllable'] for e in measurements[:10]],
      'confirmedPhonemeTimingCount':0,
      'validMouthSegmentFeatures':len(valid),'invalidSampleAttempts':face_fail,
      'trainedModel':'PCA on grayscale actual mouth region, not predictive lip-sync',
      'trainingEventCount':int(train_mask.sum()),'holdoutEventCount':int(test_mask.sum()),
      'pcaComponents':int(pca.n_components_),
      'holdoutMouthReconstructionMAE_0to1':mae,
      'holdoutStaticMeanMAE_0to1':baseline,
      'holdoutReconstructionImprovementPct':round((1-mae/baseline)*100,2) if baseline>0 else None,
      'vowelPrototypeCount':len(proto_raw),
      'annotationStatus':'Weak labels for the initial 10 based on user-declared ordering; remaining VAD groups need verification and include possible retakes',
      'notCompleted':['independently verified speech-to-text','150+ phoneme-level alignment','consonant+vowel supervised classifier','jaw-bone 3D','anatomical mouth landmarks and muscle ground truth'],
      'privacy':'Training tensors must remain private, publish only summarized metrics and masked preview'
    }
    (output/'V33_TRAINING_REPORT.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    (output/'V33_EXPECTED_ALL_USER_SYLLABLES.json').write_text(json.dumps({'inputSource':'user-reported pronunciation order','phonemeTimingVerified':False,'targetSyllables':script},ensure_ascii=False,indent=2),encoding='utf-8')
    (output/'V33_AUDIO_SEGMENT_REVIEW.json').write_text(json.dumps({'phonemeTimingVerified':False,'segments':measurements,'groups':[{'groupIndex':i,'startSec':g[0][0],'endSec':g[-1][1],'count':len(g),'requiresHumanReview':i>0 or len(g)!=10} for i,g in enumerate(groups)]},ensure_ascii=False,indent=2),encoding='utf-8')
    with open(output/'V33_AUDIO_SEGMENT_REVIEW.csv','w',newline='',encoding='utf-8-sig') as fh:
        cols=['group','positionInGroup','startSec','endSec','durationSec','syllable','onset','vowel','audioLabelVerified','featureValid','oralDarkCandidateAreaPx','oralCandidateWidthPx','oralCandidateHeightPx','lipRedCandidateWidthPx','lipRedCandidateHeightPx']
        w=csv.DictWriter(fh,fieldnames=cols,extrasaction='ignore');w.writeheader();w.writerows(measurements)
    return report,measurements

if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('--video',type=Path,required=True);ap.add_argument('--output',type=Path,required=True)
    a=ap.parse_args()
    print(json.dumps(fit_and_export(a.video,a.output)[0],ensure_ascii=False,indent=2))
