"""Experimental audio->mouth geometry regression, no phoneme or 3D claim.

Each row represents the same timestamp's spoken-audio and observable mouth
appearance; test split holds out entire recording groups, not random frames.
Predictions are *not* considered usable when worse than static training mean.
"""
from pathlib import Path
import argparse,json
import numpy as np,soundfile as sf
from scipy.signal import stft
from scipy.fftpack import dct
from sklearn.linear_model import Ridge
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import mean_absolute_error

TARGETS=['oralDarkCandidateAreaPx','oralCandidateHeightPx','lipRedCandidateWidthPx','lipRedCandidateHeightPx']

def audio_features(a,sr,st,en):
    x=a[max(0,int(st*sr)):min(len(a),int(en*sr))]
    if len(x)<500:x=np.pad(x,(0,500-len(x)))
    # Focus on vowel-like steady-state middle, preserving consonant edge energies.
    middle=x[int(len(x)*.25):int(len(x)*.75)]
    if len(middle)<400:middle=x
    _,_,z=stft(middle,fs=sr,nperseg=512,noverlap=256)
    pow=np.mean(np.abs(z)**2,axis=1)
    frequencies=np.linspace(0,sr/2,len(pow))
    bands=np.geomspace(80,7900,25)
    bandpower=[]
    for lo,hi in zip(bands[:-1],bands[1:]):
        band=(frequencies>=lo)&(frequencies<hi)
        bandpower.append(float(np.mean(pow[band])) if np.any(band) else 1e-10)
    logpow=np.log10(np.array(bandpower)+1e-10)
    ceps=dct(logpow,norm='ortho')[:13]
    chunks=np.array_split(x,3)
    rms=[float(np.sqrt(np.mean(c**2))) for c in chunks]
    return np.r_[ceps,np.log10(np.array(rms)+1e-6),np.log10(len(x)/sr+1e-2)]


def train(root:Path):
    report=json.loads((root/'V33_AUDIO_SEGMENT_REVIEW.json').read_text())
    data=[x for x in report['segments'] if x.get('featureValid')]
    wav,sr=sf.read(root/'pronunciation_audio_16k.wav')
    X=np.array([audio_features(wav,sr,x['startSec'],x['endSec']) for x in data],dtype=np.float32)
    Y=np.array([[x[key] for key in TARGETS] for x in data],dtype=np.float32)
    groups=np.array([x['group'] for x in data])
    # Hold out complete utterance groups, not adjacent frames.
    test=np.isin(groups,[3,7,11,15]);train=~test
    scaler=StandardScaler().fit(X[train]);Xtr=scaler.transform(X[train]);Xt=scaler.transform(X[test])
    y_mean=Y[train].mean(axis=0)
    y_std=Y[train].std(axis=0)+1e-3
    model=Ridge(alpha=100.0).fit(Xtr,(Y[train]-y_mean)/y_std)
    pred=model.predict(Xt)*y_std+y_mean
    mae=np.mean(np.abs(Y[test]-pred),axis=0)
    base=np.mean(np.abs(Y[test]-y_mean),axis=0)
    success=mae<base
    output={
     'type':'v33_acoustic_feature_to_2D_oral_candidate_ridge',
     'trainSpeechEvents':int(train.sum()),'heldoutSpeechEvents':int(test.sum()),
     'heldoutGroups':sorted(set(groups[test].tolist())),
     'results':{k:{'mae':round(float(a),4),'staticMeanMAE':round(float(b),4),'betterThanStatic':bool(s),'improvementPct':round(float((1-a/b)*100),2) if b>0 else None} for k,a,b,s in zip(TARGETS,mae,base,success)},
     'canDeployAsLipSync':False,
     'reason':'regression targets are unverified 2D image proxies; vowel identity/timing is not independently labeled and cheek/jaw 3D are absent'
    }
    (root/'V33_AUDIO_TO_MOUTH_HELDOUT.json').write_text(json.dumps(output,ensure_ascii=False,indent=2),encoding='utf-8')
    np.savez_compressed(root/'OWNER_V33_AUDIO_TO_MOUTH_PRIOR_PRIVATE.npz',weights=model.coef_,intercept=model.intercept_,scaler_mean=scaler.mean_,scaler_scale=scaler.scale_,target_mean=y_mean,target_std=y_std)
    return output

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--results',type=Path,required=True)
    args=parser.parse_args();print(json.dumps(train(args.results),ensure_ascii=False,indent=2))
