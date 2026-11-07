"""Strict Korean lyric/vowel and manual phone-ground-truth gates.

Automatic singing alignment may propose cues, but it must never certify that
Korean phone onsets, offsets, or visuals were verified unless independent
manual annotations are present. No fake phoneme labels are created from the
owner's unlabeled speaking clips.
"""
from __future__ import annotations
import json,re
from dataclasses import dataclass
from pathlib import Path

KOREAN_VOWELS=set('ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ')

@dataclass(frozen=True)
class VerifiedPhoneCue:
    source_file:str
    source_sha256:str
    glyph:str
    vowel:str
    onset_s:float
    offset_s:float
    annotator:str
    approval_status:str
    
    def __post_init__(self):
        if self.vowel not in KOREAN_VOWELS:
            raise ValueError('Unknown Korean vowel')
        if self.onset_s<0 or self.offset_s<=self.onset_s:
            raise ValueError('Invalid phoneme time range')
        if not re.fullmatch(r'[0-9a-f]{64}',self.source_sha256):
            raise ValueError('Missing exact recorded-source checksum')
        if not self.source_file or not self.glyph or not self.annotator:
            raise ValueError('Missing phoneme provenance')
        if self.approval_status!='human_verified':
            raise ValueError('Cannot certify machine guessed or unreviewed timing')


def load_verified_phones(json_path:Path):
    obj=json.loads(json_path.read_text(encoding='utf-8'))
    if not obj.get('source_user_authorized'):
        raise ValueError('User recording authorization required')
    cues=[VerifiedPhoneCue(**row) for row in obj['cues']]
    if not cues:raise ValueError('No human-verified phoneme examples')
    for a,b in zip(cues,cues[1:]):
        if a.source_file==b.source_file and a.offset_s>b.onset_s:
            raise ValueError('Overlapping phoneme time cues')
    return cues


def create_annotation_template(source_file:str,sha256:str):
    return {'source_user_authorized':True,
      'status':'LABELS_REQUIRED_NOT_TRAINED',
      'notes':'Confirm real sung/speaking time with frame/audio annotation before human_verified.',
      'unverified_example_not_for_training':{
        'source_file':source_file,'source_sha256':sha256,'glyph':'아','vowel':'ㅏ',
        'onset_s':None,'offset_s':None,'annotator':'','approval_status':'PENDING_HUMAN_REVIEW'},
      'cues':[]}
