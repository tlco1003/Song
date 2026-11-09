"""Weak reverse phonetic cross-check: LPC F1/F2 -> closest synthetic 3D vowel.

NOT automatic Korean speech recognition, not blind recognition, not a human
annotation or evidence of the actual hidden tongue position. Because first-ten
order is supplied by the user and the tube model is uncalibrated, a score here
is only a failure-finding instrument.
"""
from pathlib import Path
import json
import numpy as np
from owner_v36_acoustic_articulation import airway_from_pose,formant_candidates
from owner_v35_articulatory_3d import BASE_VOWELS,vowel_pose,GLIDES


def review(raw:Path,out:Path):
    j=json.loads(raw.read_text())
    prototypes={v:formant_candidates(airway_from_pose(vowel_pose(v)))[:2] for v in BASE_VOWELS}
    outcomes=[];agree=0;eligible=0
    for row in j['vowels']:
        actual=row['acoustic'];f1=actual['F1candidateHz'];f2=actual['F2candidateHz']; v=row['vowel']
        expected=GLIDES[v][1] if v in GLIDES else v
        ranked=[]
        if f1 is not None and f2 is not None:
            for name,(a,b) in prototypes.items():
                # Width scales illustrative; a phonetic recognition model is absent.
                d=float(np.hypot((f1-a)/165,(f2-b)/320))
                ranked.append({'canonicalVowelCandidate':name,'normalizedDistance':round(d,3)})
            ranked.sort(key=lambda x:x['normalizedDistance'])
            eligible+=1
            if ranked and ranked[0]['canonicalVowelCandidate']==expected:agree+=1
        outcomes.append({'spokenSyllableUserDeclared':row['userReportedSyllable'],
            'vowelWeakLabel':v,'targetNucleusForGlide':expected,
            'observedLPCF1Hz':f1,'observedLPCF2Hz':f2,
            'topThreeSyntheticResonanceMatches':ranked[:3],
            'verifiedSpeechRecognition':False,'ownerTongueGroundTruthAvailable':False})
    r={'schema':'song-v36-reverse-audio-synthetic-model-diagnostic-v1',
       'isSpeechRecognitionAccuracy':False,
       'modelUncalibrated':True,'verifiedSurfacePhoneLabels':0,
       'eligibleWith2FormantCandidates':eligible,'topOneMatchesUserSequenceEndpoint':agree,
       'metricIsNOTRecognitionAccuracy':True,
       'caveat':'same speaker one token per vowel, weak user sequence labels, simulated vowel profile priors and missing F2 for some cases',
       'vowels':outcomes}
    out.write_text(json.dumps(r,ensure_ascii=False,indent=2))
    return r

if __name__=='__main__':
    p=Path(__file__).resolve().parent/'results'
    r=review(p/'SONG_V36_OWNER_AUDIO_COMPARISON_PRIVATE.json',p/'SONG_V36_REVERSE_3D_SOUND_CHECK_PRIVATE.json')
    print('eligible',r['eligibleWith2FormantCandidates'],'matches',r['topOneMatchesUserSequenceEndpoint'])
    for x in r['vowels']:
        print(x['spokenSyllableUserDeclared'],x['targetNucleusForGlide'],[(v['canonicalVowelCandidate'],v['normalizedDistance']) for v in x['topThreeSyntheticResonanceMatches']])
