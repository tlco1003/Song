"""Korean grapheme -> parametric 3D articulatory keyframes, not audio timing.

Surface pronunciation rules and onset/coda allophones are not always derivable
from characters; unsupported codas fail closed pending approved phonetic label.
This keyframe pipeline can later accept verified text/audio phoneme timestamps.
"""
from __future__ import annotations
import json,math
from dataclasses import asdict,replace
from pathlib import Path
from owner_v35_articulatory_3d import (
    ONSETS,VOWELS,CODAS,SIMPLE_CODA,consonant_pose,vowel_pose,
    blend_controls,syllable_motion,RigControls
)


class SurfacePronunciationRequired(ValueError):
    pass


def split_syllables(text:str):
    for ch in text:
        idx=ord(ch)-0xAC00
        if 0<=idx<11172:
            initial=ONSETS[idx//588]
            vowel=VOWELS[(idx%588)//28]
            coda=CODAS[idx%28]
            yield {'glyph':ch,'onset':initial,'vowel':vowel,'coda':coda}


def coda_pose(final:str,vowel:str):
    if final not in SIMPLE_CODA:
        raise SurfacePronunciationRequired('Coda '+final+' requires a verified contextual pronunciation')
    mode=SIMPLE_CODA[final]
    src={'velar_stop':'ㄱ','alveolar_nasal':'ㄴ','alveolar_stop':'ㄷ',
         'alveolar_lateral':'ㄹ','bilabial_nasal':'ㅁ','bilabial_stop':'ㅂ',
         'velar_nasal':'ㄱ'}[mode]
    pose=consonant_pose(src,vowel)
    if final=='ㅇ':
        pose=replace(pose,velum_open=1.,oral_closure='velar',oral_stricture=1.,phase='coda_nasal')
    else:pose=replace(pose,phase='coda')
    return pose.validate()


def timeline_from_text(text:str,frame_rate=24,frames_per_syllable=18):
    """Returns trajectory with arbitrary unverified per-syllable duration.

    It MUST NOT be used as song sync ground truth. The caller should replace
    durations with reviewer-verified onset/offset times for actual footage.
    """
    if frame_rate<=0 or frames_per_syllable<8:raise ValueError('Invalid timing')
    syllables=list(split_syllables(text));timeline=[];last=None
    for i,sy in enumerate(syllables):
        frames=frames_per_syllable
        onset=consonant_pose(sy['onset'],sy['vowel'])
        vowel=vowel_pose(sy['vowel'])
        final=sy['coda']
        if final!='∅' and final not in SIMPLE_CODA:
            raise SurfacePronunciationRequired(f'{sy["glyph"]}: unsupported unverified complex coda {final}')
        coda=coda_pose(final,sy['vowel']) if final!='∅' else None
        for j in range(frames):
            p=j/(frames-1)
            if p<.22:
                pose=onset
                if last is not None:
                    pose=blend_controls(last,pose,min(1,p/.22))
            elif p<.55:
                t=(p-.22)/.33
                pose=blend_controls(onset,vowel_pose(sy['vowel'],t),t)
            elif coda is not None and p>.80:
                pose=blend_controls(vowel,coda,(p-.80)/.20)
            else:
                pose=vowel_pose(sy['vowel'],min(1,(p-.55)/.24))
            timeline.append({'frame':len(timeline),'timeSec':round(len(timeline)/frame_rate,6),
                'writtenSyllable':sy['glyph'],'onset':sy['onset'],'vowel':sy['vowel'],
                'coda':final,'controls':asdict(pose),
                'timelineHumanVerified':False,'owner3DAnatomyMeasured':False})
        last=pose
    return {'schema':'SONG_V35_TEXT_3D_KEYFRAMES','text':text,'frameRate':frame_rate,
       'synchronizedToRealAudio':False,'source':'orthographic demonstration, NOT measured phone boundaries',
       'phonologicalSurfaceRulesApplied':False,'frames':timeline}


def save_timeline(text:str,out:Path,frames_per_syllable=18):
    data=timeline_from_text(text,frames_per_syllable=frames_per_syllable)
    out.parent.mkdir(parents=True,exist_ok=True)
    out.write_text(json.dumps(data,ensure_ascii=False,indent=2))
    return data


if __name__=='__main__':
    save_timeline('엄마 난 가끔 그런 생각을 해',Path(__file__).parent/'results'/'SONG_V35_EMMA_KOREAN_TEXT_3D_KEYFRAMES.json')
