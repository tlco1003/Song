#!/usr/bin/env python3
"""Owner-only experimental Korean vowel reverse identification.

Audio -> vowel candidate and silent video -> vowel candidate, then cross-check.
It is NOT a pretrained Korean ASR, does not 'hear' actual spoken words, and cannot
verify consonants.  Weak labels are inferred from the owner's declared 10-vowel
ordering in VAD groups of exactly 10 events, with noisy VAD groups excluded.

No source footage, face embeddings or voice weights may be published by default.
"""
from __future__ import annotations
import argparse, csv, json, warnings
from pathlib import Path
import numpy as np
import pandas as pd
import soundfile as sf
from scipy import signal
from scipy.fft import dct
from sklearn.preprocessing import StandardScaler
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import make_pipeline
from sklearn.metrics import accuracy_score, confusion_matrix

VOWELS=['ㅏ','ㅑ','ㅓ','ㅕ','ㅗ','ㅛ','ㅜ','ㅠ','ㅡ','ㅣ']
PROVISIONAL_SYLLABLES=['아','야','어','여','오','요','우','유','으','이']
TWO_WAY_EXCLUDE_GROUPS=[1,2,5,9,10,12,14,15,16,17]
# Hold out complete 10-event groups.  No cross-modal learning uses these groups.
TEST_GROUPS=[11,13]


def triangular_mel(sr:int, nfft:int, mels:int=28):
    def hz_to_mel(v): return 2595*np.log10(1+v/700)
    def mel_to_hz(v): return 700*(10**(v/2595)-1)
    hz=mel_to_hz(np.linspace(hz_to_mel(90), hz_to_mel(7000),mels+2))
    bins=np.floor((nfft+1)*hz/sr).astype(int)
    result=np.zeros((mels,nfft//2+1),np.float64)
    for i in range(mels):
        a,b,c=bins[i:i+3]
        if a==b:b=a+1
        if b==c:c=b+1
        for j in range(a,min(b,nfft//2+1)):
            result[i,j]=(j-a)/(b-a)
        for j in range(b,min(c,nfft//2+1)):
            result[i,j]=(c-j)/(c-b)
    result/=np.maximum(result.sum(axis=1,keepdims=True),1e-10)
    return result


def audio_features(signal_data:np.ndarray,sr:int,start:float,end:float,mels=None)->np.ndarray:
    if mels is None:mels=triangular_mel(sr,512)
    # Use last ~65% of each detected syllable to avoid confusing onset consonants.
    a=int((start+(end-start)*.35)*sr);b=int((start+(end-start)*.95)*sr)
    x=signal_data[max(0,a):min(len(signal_data),b)].astype(np.float64)
    if len(x)<400:x=signal_data[int(start*sr):int(end*sr)].astype(np.float64)
    if len(x)<400:x=np.pad(x,(0,400-len(x)))
    x=np.r_[x[0],x[1:]-.97*x[:-1]]
    fs,ts,Z=signal.stft(x,sr,nperseg=400,noverlap=240,nfft=512,boundary=None)
    power=np.abs(Z)**2
    mel=np.log(np.maximum(mels@power,1e-12))
    # per-event spectral envelope + MFCCs, no absolute pitch or loudness identity.
    mfcc=dct(mel,type=2,axis=0,norm='ortho')[1:14]
    med=mel-np.mean(mel,axis=0,keepdims=True)
    f=np.concatenate([
        np.mean(mfcc,axis=1),
        np.std(mfcc,axis=1),
        np.mean(med,axis=1),
    ])
    assert np.isfinite(f).all()
    return f


def visual_features(row)->np.ndarray:
    # These are V33 color/brightness *proxies*, not anatomical landmarks.
    cols=['oralDarkCandidateAreaPx','oralCandidateWidthPx','oralCandidateHeightPx',
          'lipRedCandidateWidthPx','lipRedCandidateHeightPx']
    p=np.array([float(row[c]) for c in cols],np.float64)
    # Standardizing derived features across train rows is handled by pipeline.
    extra=np.array([
      np.log1p(max(0,p[0])),
      p[1]/max(1,p[2]),
      p[3]/max(1,p[4]),
      p[1]*p[2],
      p[3]*p[4],
    ])
    f=np.r_[p,extra]
    assert np.isfinite(f).all()
    return f


def load_examples(wav_path:Path, seg_csv:Path):
    audio,sr=sf.read(wav_path)
    if audio.ndim==2:audio=audio.mean(axis=1)
    rows=list(csv.DictReader(seg_csv.open(encoding='utf-8-sig',newline='')))
    mel=triangular_mel(sr,512)
    A=np.asarray([audio_features(audio,sr,float(r['startSec']),float(r['endSec']),mel) for r in rows])
    V=np.asarray([visual_features(r) for r in rows])
    groups=np.asarray([int(r['group']) for r in rows])
    positions=np.asarray([int(r['positionInGroup']) for r in rows])
    counts=pd.Series(groups).value_counts().to_dict()
    exact=np.array([counts[g]==10 for g in groups])
    y=np.asarray([p if good else -1 for p,good in zip(positions,exact)])
    return rows,A,V,groups,positions,exact,y,counts


def do_analysis(wav_path:Path, seg_csv:Path, outdir:Path):
    outdir.mkdir(parents=True,exist_ok=True)
    rows,A,V,groups,positions,exact,y,counts=load_examples(wav_path,seg_csv)
    train=exact & ~np.isin(groups,TEST_GROUPS)
    test=exact & np.isin(groups,TEST_GROUPS)
    assert train.sum()>20 and test.sum()==20
    preds={};models={}
    for modality,X in [('audio',A),('silent_video',V)]:
        pipe=make_pipeline(StandardScaler(),LogisticRegression(C=.15,max_iter=3000,class_weight='balanced',random_state=34))
        pipe.fit(X[train],y[train])
        logits=pipe.predict_proba(X)
        classes=pipe[-1].classes_
        rank=np.argsort(-logits,axis=1)
        ids=classes[rank]
        preds[modality]={'proba':logits,'labels':ids,'prediction':ids[:,0]}
        models[modality]=pipe
    aa=preds['audio']['prediction'];vv=preds['silent_video']['prediction']
    results=[]
    for i,row in enumerate(rows):
        obj={
           'eventId':i,'group':int(groups[i]),'positionInGroup':int(positions[i]),
           'startSec':float(row['startSec']),'endSec':float(row['endSec']),
           'weakSequenceExpected':PROVISIONAL_SYLLABLES[positions[i]] if exact[i] else None,
           'expectedStatus':'owner_order_inferred_not_audio_verified' if exact[i] else 'unknown',
           'audioPredictedVowel':VOWELS[aa[i]],
           'audioTop3':[VOWELS[k] for k in preds['audio']['labels'][i,:3]],
           'visualPredictedVowel':VOWELS[vv[i]],
           'visualTop3':[VOWELS[k] for k in preds['silent_video']['labels'][i,:3]],
           'audioVisualAgree':bool(aa[i]==vv[i]),
           'audioExpectedPositionAgree':bool(aa[i]==positions[i]) if exact[i] else None,
           'visualExpectedPositionAgree':bool(vv[i]==positions[i]) if exact[i] else None,
           'split':'heldout' if test[i] else ('training' if train[i] else 'excluded_unreliable_count'),
           'humanVerified':False,
           'independentKoreanASR':False,
        }
        results.append(obj)
    held= [e for e in results if e['split']=='heldout']
    ga={str(g):{
        'n':int(counts[g]),
        'firstSec':next(float(r['startSec']) for r in rows if int(r['group'])==g),
        'lastSec':max(float(r['endSec']) for r in rows if int(r['group'])==g),
        'includedAsWeakOrderedTen':counts[g]==10,
        'role':'test' if g in TEST_GROUPS else 'training' if counts[g]==10 else 'excluded',
    } for g in sorted(counts)}
    acc_audio=float(accuracy_score(y[test],aa[test]));acc_visual=float(accuracy_score(y[test],vv[test]));agree=float(np.mean(aa[test]==vv[test]));
    both=int(np.sum((aa[test]==y[test])&(vv[test]==y[test])))
    report={
      'version':'SONG-Vision v34 audio/video cross-modal weak vowel verification',
      'source':'owner-provided pronunciation_25mb.mp4 audio, plus V33 synchronized image-color proxies',
      'videoDurationSec':195.584,
      'totalSpeechCandidates':len(rows),
      'exactTenEventGroups':sorted(int(g) for g,c in counts.items() if c==10),
      'excludedNonTenGroups':[int(g) for g,c in sorted(counts.items()) if c!=10],
      'groupSizes':{str(k):int(v) for k,v in sorted(counts.items())},
      'modalityTraining':{'audio':'audio waveform -> log-Mel and MFCC (no video features)',
                           'silent_video':'V33 ROI contrast/brightness proxies (no audio features)'},
      'trainingEvents':int(train.sum()),
      'testEvents':int(test.sum()),
      'heldoutGroups':TEST_GROUPS,
      'heldoutAgreementWithWeakPosition':{
        'audio':round(acc_audio,3),'video':round(acc_visual,3),
        'audio_video_same_class':round(agree,3),'both_match_weak_position':both,
        'chance10class':0.1,
      },
      'importantLimitations':[
        'NOT pretrained ASR; no autonomous literal transcription or consonant recognition',
        'VAD event count equals 10 is not proof of vowel row or correct order',
        'Weak 10-vowel labels come only from user-reported fixed sequence; therefore these are not true phoneme recognition accuracies',
        'Video input uses dark/red region proxies not verified inner lip/teeth anatomy',
        'Small and uneven speaker dataset; room/acoustic variation and identity leakage possible',
        'Cross-modal agreement cannot prove correctness if both models learn the same biases',
        'Human-verified audio phone and time labels or independent Korean ASR are required before reporting reliable phoneme accuracy',
      ],
      'firstTenFromOwnerDeclaredOrder':PROVISIONAL_SYLLABLES,
      'rowSummary':ga,
      'perHeldout':held,
    }
    (outdir/'V34_CROSSCHECK_REPORT.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    with (outdir/'V34_SPEECH_VOWEL_REVIEW.csv').open('w',newline='',encoding='utf-8-sig') as f:
        writer=csv.DictWriter(f,fieldnames=list(results[0]));writer.writeheader()
        for row in results:
            writer.writerow({k:','.join(v) if isinstance(v,list) else v for k,v in row.items()})
    return report,results

if __name__=='__main__':
    p=argparse.ArgumentParser()
    p.add_argument('--wav',type=Path,default=Path('/mnt/data/song_v34_reverse/audio_16k.wav'))
    p.add_argument('--segments',type=Path,default=Path('/mnt/data/song_v34_reverse/results/V33_AUDIO_SEGMENT_REVIEW.csv'))
    p.add_argument('--outdir',type=Path,default=Path('/mnt/data/song_v34_reverse/results'))
    args=p.parse_args();report,_=do_analysis(args.wav,args.segments,args.outdir)
    print(json.dumps(report['heldoutAgreementWithWeakPosition'],ensure_ascii=False,indent=2))
    print('N:',report['trainingEvents'],report['testEvents'])
