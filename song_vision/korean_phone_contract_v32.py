"""All modern Hangul syllables: spelling targets, not guessed spoken phonemes.

A Unicode syllable has (19 initial, 21 medial, 28 final) composition slots.
Surface phones and timing must come from a versioned pronunciation lexicon
and user-verified forced alignment; don't treat graphemes as phonetic ground truth.
"""
from __future__ import annotations
from dataclasses import dataclass, asdict
from typing import Optional
import json, unicodedata

ONSETS=tuple('ㄱ ㄲ ㄴ ㄷ ㄸ ㄹ ㅁ ㅂ ㅃ ㅅ ㅆ ㅇ ㅈ ㅉ ㅊ ㅋ ㅌ ㅍ ㅎ'.split())
NUCLEI=tuple('ㅏ ㅐ ㅑ ㅒ ㅓ ㅔ ㅕ ㅖ ㅗ ㅘ ㅙ ㅚ ㅛ ㅜ ㅝ ㅞ ㅟ ㅠ ㅡ ㅢ ㅣ'.split())
CODAS=tuple('∅ ㄱ ㄲ ㄳ ㄴ ㄵ ㄶ ㄷ ㄹ ㄺ ㄻ ㄼ ㄽ ㄾ ㄿ ㅀ ㅁ ㅂ ㅄ ㅅ ㅆ ㅇ ㅈ ㅊ ㅋ ㅌ ㅍ ㅎ'.split())
assert len(ONSETS)==19 and len(NUCLEI)==21 and len(CODAS)==28

@dataclass(frozen=True)
class JamoSyllable:
    glyph:str
    onset:str
    nucleus:str
    coda:str
    spelling_only:bool=True


def split_hangul(text:str)->list[JamoSyllable]:
    out=[]
    for char in text:
        o=ord(char)-0xAC00
        if 0<=o<11172:
            ii=o//588; vi=(o%588)//28; fi=o%28
            out.append(JamoSyllable(char,ONSETS[ii],NUCLEI[vi],CODAS[fi]))
    return out


def enumerate_all_syllables():
    return (chr(x) for x in range(0xAC00,0xD7A4))


def create_pending_annotations(text:str, source_video:str, fps:float):
    if fps<=0:raise ValueError('FPS must be positive')
    return {'schema':'song-v32-human-phone-label-v1','sourceVideo':source_video,'fps':fps,
       'alignmentStatus':'HUMAN_REVIEW_REQUIRED',
       'notPronunciationGroundTruth':True,
       'frames':[{**asdict(a),'startFrame':None,'endFrame':None,
                  'surfacePronunciation':None,'reviewerVerified':False,
                  'occlusion':None,'confidence':None} for a in split_hangul(text)]}


def validate_for_training(annotation:dict):
    if annotation.get('alignmentStatus')!='HUMAN_VERIFIED':
        raise ValueError('Refusing unverified Korean phone timings')
    for row in annotation.get('frames',[]):
        if not row.get('reviewerVerified') or row.get('startFrame') is None or row.get('endFrame') is None:
            raise ValueError('Cannot train from guessed onset/end frames')
        if not row.get('surfacePronunciation') or row['startFrame']>=row['endFrame']:
            raise ValueError('No verified surface pronunciation and nonempty interval')
    return True


def romanized_for_display_only(text:str):
    raise NotImplementedError('Real surface-phone transcription needs a verified lexicon; do not generate from orthography')


def all_isolated_jamo_annotation_rows():
    return ([{'char':x,'position':'onset','surfacePronunciation':None,'reviewerVerified':False} for x in ONSETS]
       + [{'char':x,'position':'vowel','surfacePronunciation':None,'reviewerVerified':False} for x in NUCLEI]
       + [{'char':x,'position':'coda','surfacePronunciation':None,'reviewerVerified':False} for x in CODAS if x!='∅'])


def inventory_report():
    return {'onsetCount':len(ONSETS),'vowelCount':len(NUCLEI),
       'finalSlots':len(CODAS),'finalConsonantPatterns':len(CODAS)-1,
       'modernSyllableCount':len(ONSETS)*len(NUCLEI)*len(CODAS),
       'standalonePhoneAnnotationSlots':len(all_isolated_jamo_annotation_rows()),
       'labelsRequireHumanVerification':True,
       'graphemeSoundChangesNotInferred':True}
