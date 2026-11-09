"""Learn a 3D articulator -> 1D acoustic resonance surrogate (synthetic supervision).

IMPORTANT: labels are produced by the author's 1D tract simulator, NOT a
speaker's measured MRI tongue or real phonetic labels. A low Hz error here means
approximation of the simulator, not audio realism.
"""
from __future__ import annotations
from dataclasses import replace
from pathlib import Path
import json
import numpy as np
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.metrics import mean_absolute_error
from owner_v35_articulatory_3d import BASE_VOWELS, vowel_pose
from owner_v36_acoustic_articulation import airway_from_pose,formant_candidates

FEATURES=('jaw_rad','tip_z','blade_z','body_z','dorsum_z','root_z','lip_width','lip_open','lip_protrusion')


def make_training_set(n_per_vowel=65,seed=36):
    rng=np.random.default_rng(seed);rows=[];targets=[];sources=[]
    for vowel in BASE_VOWELS:
        base=vowel_pose(vowel)
        for j in range(n_per_vowel):
            c=base
            if j>0:
                kwargs={}
                for key in FEATURES:
                    q=getattr(base,key)
                    delta=.06 if key.endswith('_z') else (.032 if key=='jaw_rad' else .055)
                    value=float(np.clip(q+rng.normal(0,delta),
                       0 if key!='lip_width' else .07,
                       .38 if key=='jaw_rad' else .50 if key=='lip_protrusion' else .6 if key.endswith('_z') else .55))
                    kwargs[key]=value
                c=replace(base,**kwargs)
            try:
                profile=airway_from_pose(c)
                forms=formant_candidates(profile,max_count=3)
            except (ValueError,FloatingPointError):continue
            if len(forms)<2:continue
            rows.append([getattr(c,k) for k in FEATURES]);targets.append(forms[:2]);sources.append(vowel)
    return np.asarray(rows,np.float32),np.asarray(targets,np.float32),np.asarray(sources)


def train(output:Path):
    output.mkdir(parents=True,exist_ok=True)
    X,Y,labels=make_training_set();rng=np.random.default_rng(1036)
    trainmask=np.zeros(len(X),bool)
    for v in BASE_VOWELS:
        indices=np.where(labels==v)[0];rng.shuffle(indices)
        trainmask[indices[:int(len(indices)*.8)]]=True
    preds=[];metrics={};weights=[]
    for col,key in enumerate(('F1','F2')):
        model=HistGradientBoostingRegressor(max_iter=130,max_leaf_nodes=12,learning_rate=.065,l2_regularization=2.,random_state=36)
        model.fit(X[trainmask],Y[trainmask,col]);p=model.predict(X[~trainmask]);preds.append(p)
        truth=Y[~trainmask,col];base=np.full_like(truth,np.mean(Y[trainmask,col]))
        metrics[key]={'heldoutMAE_Hz':round(float(mean_absolute_error(truth,p)),2),
            'staticMeanBaselineMAE_Hz':round(float(mean_absolute_error(truth,base)),2)}
    report={'version':'v36_forward_synthetic_articulatory_acoustic_regression',
        'supervision':'synthetic_1d_tube_simulator_only',
        'features':FEATURES,'inputDimension':len(FEATURES),
        'syntheticSamples':int(len(X)),'trainCount':int(trainmask.sum()),'testCount':int((~trainmask).sum()),
        'randomPerVowelHoldout':True,
        'metrics':metrics,'actualKoreanSpeechSoundTrained':False,
        'actualOwnerTonguePositionsLearned':False,
        'simulatorPhysicalAccuracyClinicallyVerified':False,
        'note':'Surrogate learns predicted resonance changes for tongue/lips/jaw poses; cannot recover unique tongue pose from audio'}
    (output/'V36_SYNTHETIC_SOUND_LEARNING_REPORT.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
    # Synthetic data only; safe to publish, human audio remains private.
    np.savez_compressed(output/'V36_SYNTHETIC_TONGUE_TO_RESONANCE_TRAINING_DATA.npz',features=X,targets=Y,sourcePreset=labels,trainMask=trainmask)
    print(json.dumps(report,ensure_ascii=False,indent=2))
    return report

if __name__=='__main__':train(Path(__file__).resolve().parent/'results')
