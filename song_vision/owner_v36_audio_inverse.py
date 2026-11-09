"""Owner's first 10 spoken vowels: acoustics ↔ 3D articulatory hypothesis check.

This is not recognized speech or observed tongue tracking. The initial ten
syllables are weakly ordered from the user's report, VAD times are estimates,
and LPC spectral peaks are measurement candidates with ambiguity. Matching to
v35 synthetic tract resonances cannot prove the true hidden tongue shape.
"""
from __future__ import annotations
from pathlib import Path
from dataclasses import asdict
import json,csv
import numpy as np,soundfile as sf
from scipy.ndimage import gaussian_filter1d,binary_closing
from scipy.signal import lfilter
from scipy.linalg import solve_toeplitz
from owner_v35_articulatory_3d import vowel_pose,GLIDES
from owner_v36_acoustic_articulation import airway_from_pose,formant_candidates,phoneme_signature

VOWELS=['ㅏ','ㅑ','ㅓ','ㅕ','ㅗ','ㅛ','ㅜ','ㅠ','ㅡ','ㅣ']
SYLLABLES=['아','야','어','여','오','요','우','유','으','이']


def detect_speech_segments(audio,sr,db_threshold=-40):
    if sr!=16000:raise ValueError('Expected 16kHz mono audio')
    window=int(sr*.030);hop=int(sr*.010)
    chunks=np.lib.stride_tricks.sliding_window_view(audio,window)[::hop]
    rms=np.sqrt(np.mean(chunks**2,axis=1))
    db=20*np.log10(gaussian_filter1d(rms,2)+1e-6)
    active=binary_closing(db>db_threshold,iterations=7)
    edge=np.flatnonzero(np.diff(np.r_[False,active,False]))
    spans=[(float(a*hop/sr),float(b*hop/sr)) for a,b in zip(edge[::2],edge[1::2]) if (b-a)*hop/sr>=.15]
    groups=[]
    for a,b in spans:
        if not groups or a-groups[-1][-1][1]>1.5:groups.append([])
        groups[-1].append((a,b))
    return groups


def lpc_formants_candidate(audio,sr,center_sec,order=18,duration_sec=.055):
    pos=int(center_sec*sr);half=int(sr*duration_sec/2)
    window=audio[max(0,pos-half):min(len(audio),pos+half)]
    if len(window)<300:return []
    x=lfilter([1,-.97],[1],window)*np.hamming(len(window))
    corr=np.correlate(x,x,mode='full')[len(x)-1:len(x)+order]
    # Regularized autocorrelation Toeplitz solve.
    if corr[0]<1e-7:return []
    c=corr[:order].copy();c[0]*=1.00001
    try: coeff=solve_toeplitz(c,-corr[1:order+1])
    except np.linalg.LinAlgError:return []
    roots=np.roots(np.r_[1.,coeff])
    roots=roots[np.imag(roots)>0]
    freqs=np.angle(roots)*sr/(2*np.pi)
    bandwidth=-np.log(np.maximum(np.abs(roots),1e-8))*sr/np.pi
    ok=(freqs>180)&(freqs<3700)&(bandwidth>0)&(bandwidth<450)
    return [int(round(v)) for v in np.sort(freqs[ok])]


def summarize_formants(audio,sr,begin,end):
    mid=(begin+end)/2
    # Several windows/orders. Reject agreeing poorly rather than fabricate F2.
    measures=[]
    for ratio in (.37,.48,.58,.68):
        t=begin+(end-begin)*ratio
        for order in (16,18,20):
            p=lpc_formants_candidate(audio,sr,t,order)
            if len(p):measures.append(p)
    if not measures:return {'F1candidateHz':None,'F2candidateHz':None,'confidence':'none','rawCandidates':[]}
    f1=[a[0] for a in measures if 200<=a[0]<=1200]
    F1=int(round(np.median(f1))) if f1 else None
    # Require F2 > F1+~210 (low rounded vowels can have F2 near 650)
    f2=[]
    for peaks in measures:
        if F1 is None:continue
        cp=[n for n in peaks if n>F1+220 and n<3400]
        if cp:f2.append(cp[0])
    F2=int(round(np.median(f2))) if len(f2)>=len(measures)//2 else None
    # candidate dispersion warns that multiple LPC orders disagree
    spread=(float(np.subtract(*np.percentile(f1,[75,25]))) if f1 else None)
    agree=bool(F1 is not None and spread is not None and spread<150 and
               (F2 is None or np.subtract(*np.percentile(f2,[75,25]))<350))
    return {'F1candidateHz':F1,'F2candidateHz':F2,'confidence':'estimated_not_human_verified' if agree else 'unstable',
      'F1IQRHz':round(spread,1) if spread is not None else None,'numWindows':len(measures),
      'numF2Candidates':len(f2),'rawCandidates':measures}


def evaluate_first_ten(audio_path:Path,out_dir:Path):
    out_dir.mkdir(parents=True,exist_ok=True)
    audio,sr=sf.read(audio_path)
    if audio.ndim!=1:raise ValueError('mono required')
    groups=detect_speech_segments(audio,sr)
    if not groups or len(groups[0])!=10:
        raise RuntimeError('First VAD group is not exactly 10; do not silently force phoneme order')
    rows=[]
    for i,(a,b) in enumerate(groups[0]):
        v=VOWELS[i];m=summarize_formants(audio,sr,a,b)
        baseline=airway_from_pose(vowel_pose(v,1))
        f=formant_candidates(baseline)
        # Hidden tract inverse is nonunique; only compare the known candidate's formants.
        rows.append({'index':i,'userReportedSyllable':SYLLABLES[i],'vowel':v,
            'startSec':round(a,3),'endSec':round(b,3),
            'labelVerifiedByIndependentASR':False,
            'actual3DTongueMeasured':False,
            'acoustic':m,'modelPredictedResonanceCandidatesHz':f,
            'predictionPhysicallyCalibratedToSpeaker':False,
            'observedFrameSource':'Pronunciation .mp4'})
    report={'schema':'song-v36-acoustic-articulatory-review-v1',
        'source':audio_path.name,'audioDurationSec':len(audio)/sr,
        'numberOfVADGroups':len(groups),'totalSpeechCandidateSegments':sum(map(len,groups)),
        'firstGroupVowels':SYLLABLES,
        'firstGroupHumanVerifiedTimings':False,
        'lpcFormantsAreAudioEstimates':True,
        'model3DAirwayIsAuthorPresetNotPersonalMedicalMeasurement':True,
        'blindASRorVoiceToPhoneClassificationPassed':False,
        'inverse3DTongueRecoveryPerformed':False,
        'vowels':rows}
    (out_dir/'SONG_V36_OWNER_AUDIO_COMPARISON_PRIVATE.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
    with open(out_dir/'SONG_V36_OWNER_AUDIO_FORMANT_REVIEW.csv','w',newline='',encoding='utf-8-sig') as f:
        columns=['index','userReportedSyllable','vowel','startSec','endSec','F1candidateHz','F2candidateHz','LPCconfidence','tubeF1Hz','tubeF2Hz','independentPhoneVerified']
        w=csv.DictWriter(f,fieldnames=columns);w.writeheader()
        for r in rows:
            res=r['modelPredictedResonanceCandidatesHz']
            obs=r['acoustic']
            w.writerow({'index':r['index'],'userReportedSyllable':r['userReportedSyllable'],'vowel':r['vowel'],
            'startSec':r['startSec'],'endSec':r['endSec'],'F1candidateHz':obs['F1candidateHz'],
            'F2candidateHz':obs['F2candidateHz'],'LPCconfidence':obs['confidence'],
            'tubeF1Hz':res[0] if res else None,'tubeF2Hz':res[1] if len(res)>1 else None,
            'independentPhoneVerified':False})
    return report

if __name__=='__main__':
    import sys
    r=evaluate_first_ten(Path(sys.argv[1]),Path(sys.argv[2]))
    for a in r['vowels']:
        print(a['userReportedSyllable'],a['startSec'],a['endSec'],a['acoustic']['F1candidateHz'],a['acoustic']['F2candidateHz'],a['modelPredictedResonanceCandidatesHz'][:2],a['acoustic']['confidence'])
