"""Runtime bridge: learned owner audio -> observed face -> constrained 3D rig.

Owner sound-to-visible 2D coefficients ARE trained on real synchronized footage.
Tongue/velum and TMJ joint center remain v35 scientific priors; never report as
observed subject-specific 3D anatomy. Explicit onset/vowel are weak/external,
not invented ASR transcripts; if unknown, output unknown tongue identity.
"""
from __future__ import annotations
import json,math
from dataclasses import replace,asdict
from pathlib import Path
import numpy as np
from owner_v37_train_real_av import acoustic_features,TARGETS,TEN_VOWELS
from owner_v35_articulatory_3d import (vowel_pose,consonant_pose,blend_controls,
                                       tongue_mesh,jaw_lines,teeth_points)
# airway_from_pose lives in v36; use explicit separate import.
from owner_v36_acoustic_articulation import airway_from_pose, formant_candidates


def _clip(value,lo,hi):return float(np.clip(value,lo,hi))


class LearnedOwnerArticulator:
    def __init__(self,model_path:Path,mapping_path:Path):
        self.model=np.load(model_path,allow_pickle=False)
        self.mapping=json.loads(mapping_path.read_text(encoding='utf-8'))
        self.dim=len(self.model['inputMean'])
        if self.mapping.get('anatomicalTmjAngleMeasured') is not False:
            raise ValueError('Owner calibration provenance must remain explicit')

    def predict_visible_from_audio(self,audio:np.ndarray,sr:int,start:float,end:float):
        feat=acoustic_features(audio,sr,start,end)
        if feat.shape!=(self.dim,):raise ValueError('Audio feature dimension mismatch')
        standardized=(feat-self.model['inputMean'])/self.model['inputStd']
        result={}
        for name in TARGETS:
            if name+'_coef' not in self.model:
                result[name]=None;continue
            if not bool(self.model[name+'_enabled'][0]):
                result[name]=None;continue
            delta=float(np.dot(self.model[name+'_coef'],standardized)+self.model[name+'_intercept'][0])
            estimated=delta*float(self.model[name+'_std'][0])+float(self.model[name+'_mean'][0])
            result[name]=_clip(estimated,0,1)
        return result

    def weak_vowel_proposals(self,audio:np.ndarray,sr:int,start:float,end:float,top=3):
        if 'weakVowelCoef' not in self.model:return []
        f=acoustic_features(audio,sr,start,end)
        standardized=(f-self.model['inputMean'])/self.model['inputStd']
        logit=self.model['weakVowelCoef']@standardized+self.model['weakVowelBias']
        p=np.exp(logit-logit.max());p=p/(p.sum()+1e-12)
        order=np.argsort(-p)[:top]
        return [{'candidate':TEN_VOWELS[int(self.model['weakVowelClasses'][i])],
                 'modelProbabilityWeakLabel':round(float(p[i]),4),
                 'validatedPhoneProbability':False} for i in order]

    def predict_rig(self,audio,sr,start,end,*,vowel:str|None=None,onset:str|None=None,explicit_prompt=False):
        visible=self.predict_visible_from_audio(audio,sr,start,end)
        jawv=visible['oralCandidateHeightRatio']
        if jawv is None:raise ValueError('Refusing 3D jaw inference without validated audio-visual aperture regression')
        m=self.mapping
        normalized=_clip((jawv-m['apertureHeightRatioP10'])/max(m['apertureHeightRatioP90']-m['apertureHeightRatioP10'],.01),0,1)
        inferred_jaw=m['minJawRad']+(m['maxJawRad']-m['minJawRad'])*normalized
        if vowel is None:
            return {'observedVisiblePredictions':visible,'vowelCandidates':self.weak_vowel_proposals(audio,sr,start,end),
                'jawRotationProxyRad':round(float(inferred_jaw),5),'tonguePose':None,'noUnverifiedTongueReconstruction':True,
                'onset':None,'unverifiedPhonemeIdentity':True,'actualOwnerJawAngleObserved':False}
        target=vowel_pose(vowel)
        # Blend modeled jaw with learned owner face aperture, with vowel-specific
        # constraints. Prior is an author preset and must not be called learned.
        inferred_jaw=_clip(.55*inferred_jaw+.45*target.jaw_rad,0,.37)
        if vowel=='ㅜ':inferred_jaw=min(inferred_jaw,.064)
        if vowel=='ㅗ':inferred_jaw=min(inferred_jaw,.104)
        # visible width is hue-based candidate; do not equate its magnitude to bone size
        lwidth=visible.get('vermillionCandidateWidthRatio')
        if lwidth is None: width=target.lip_width
        else:
            width=_clip(.48*target.lip_width+.52*(.12+.40*lwidth),.06,.55)
        aperture=_clip(.5*target.lip_open+.5*(.37*normalized),0,.4)
        control=replace(target,jaw_rad=float(inferred_jaw),lip_width=width,lip_open=aperture,
                        observed_owner_tongue=False).validate()
        # For explicit consonant onset, keep contact closure from the v35 prior;
        # source voice does NOT independently verify the onset identity.
        if onset:
            c=consonant_pose(onset,vowel,release_progress=0.)
            # Use lip width/jaw from owner audio only when consonant isn't fully sealed
            if c.oral_closure=='bilabial':
                control=replace(c,jaw_rad=control.jaw_rad,observed_owner_tongue=False).validate()
        airway=airway_from_pose(control)
        return {'observedVisiblePredictions':visible,'vowelCandidates':self.weak_vowel_proposals(audio,sr,start,end),
             'rigControls':asdict(control),'jawRotationProxyRad':round(float(control.jaw_rad),5),
             'simulatedResonanceCandidatesHz':formant_candidates(airway),
             'owner2DAudioVisualModelUsed':True,'tongueCoordinatesFromResearchPrior':True,
             'actualOwnerJawAngleObserved':False,'actualOwnerTongueMeasured':False,
             'phonemeIdentityHumanVerified':False,
             'phonemeWasProvidedAsPrompt':bool(explicit_prompt),
             'source':'real_owner_audio2D_model_plus_v35_3D_prior_NOT_anatomical_truth'}
