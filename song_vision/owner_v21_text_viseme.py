"""SONG-Vision v21 TEXT-FIRST Korean vowel/face surface research prototype.

This is a clearly disclosed engineering rig. The tabulated jaw/lip coefficients
are heuristic starting values, NOT measurements from any cited paper or actual
facial muscle forces. /j/ glides are time-varying (ㅑ/ㅕ/ㅛ/ㅠ).

No song/lyric timing is invented: render an untimed preview explicitly or
provide confirmed intervals. Optional audio RMS affects only the magnitude of
an already-known text-driven mouth gesture; it cannot select a vowel/word.

The 2D continuous facial surface warp is NOT an anatomical muscle or bone model.
"""
from __future__ import annotations

import math
import unicodedata
from dataclasses import dataclass
from typing import Sequence

import cv2
import numpy as np

ONSETS = tuple("ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ")
VOWELS = tuple("ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ")
CODAS = ("",) + tuple("ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ")
TEN_VOWELS = tuple("ㅏㅑㅓㅕㅗㅛㅜㅠㅡㅣ")
# Visible motion targets: opening, lip rounding, lip horizontal spreading,
# protrusion, lower-face jaw descent. Values are *unfitted priors* [0,1].
# For /j/ diphthongs, two targets are interpolated (glide /j/ to nucleus).
VOWEL_PRIORS = {
    "ㅏ": (.92,.08,.35,.06,.92),  # low, unrounded
    "ㅓ": (.73,.10,.26,.06,.73),  # mid-open unrounded (varies by dialect)
    "ㅗ": (.48,.89,.12,.71,.48),  # rounded back mid
    "ㅜ": (.27,.95,.07,.92,.29),  # rounded high
    "ㅡ": (.24,.07,.40,.03,.22),  # unrounded high; narrower than ㅣ
    "ㅣ": (.27,.02,.97,.01,.26),  # front high spread
    "ㅐ": (.61,.07,.74,.03,.58),  # extended coverage, no unique-phoneme claim
    "ㅔ": (.55,.07,.76,.03,.54),
}
GLIDES = {"ㅑ":"ㅏ","ㅕ":"ㅓ","ㅛ":"ㅗ","ㅠ":"ㅜ"}
# For spelling not covered in user's first vowel set, represent combinations as
# explicit glide trajectories (not proven exact phonetic realizations).
OTHER_VOWELS = {
    "ㅒ":"ㅐ","ㅖ":"ㅔ",
    "ㅘ":"ㅏ","ㅙ":"ㅐ","ㅚ":"ㅔ",
    "ㅝ":"ㅓ","ㅞ":"ㅔ","ㅟ":"ㅣ","ㅢ":"ㅣ",
}
W_GLIDES = set("ㅘㅙㅚㅝㅞㅟ")
BILABIAL_ONSET = {"ㅁ", "ㅂ", "ㅃ", "ㅍ"}
BILABIAL_CODA = {"ㅁ", "ㅂ", "ㅄ", "ㅍ"}


@dataclass(frozen=True)
class Pose:
    opening: float = .06
    rounding: float = .08
    spreading: float = .12
    protrusion: float = .02
    jaw: float = .07

    def blend(self, other: "Pose", weight: float) -> "Pose":
        t = float(np.clip(weight, 0., 1.))
        return Pose(*(a+(b-a)*t for a,b in zip(self.values(),other.values())))

    def values(self) -> tuple[float,...]:
        return (self.opening,self.rounding,self.spreading,self.protrusion,self.jaw)


REST = Pose()
TARGETS = {k:Pose(*x) for k,x in VOWEL_PRIORS.items()}


@dataclass(frozen=True)
class Syllable:
    glyph: str
    onset: str
    vowel: str
    coda: str


@dataclass(frozen=True)
class Interval:
    syllable: Syllable
    start: float
    end: float
    source: str  # manual | auto_preview_NOT_ALIGNED


def syllables(text: str) -> tuple[Syllable,...]:
    """Explicit orthographic Hangul parsing, not a phonetic G2P claim.

    Individual vowel Jamo are allowed for isolated vowel tests. Existing
    Hangul syllables are unpacked into onset/vowel/coda. Unknown letters do
    not silently become a different phone. Punctuation/spaces are ignored.
    """
    if not isinstance(text,str): raise TypeError("Lyrics must be a text string")
    out=[]
    for ch in unicodedata.normalize('NFC',text):
        if ch in VOWELS:
            out.append(Syllable(ch,"ㅇ",ch,""));continue
        code=ord(ch)-0xAC00
        if 0<=code<11172:
            o,rem=divmod(code,21*28);v,c=divmod(rem,28)
            out.append(Syllable(ch,ONSETS[o],VOWELS[v],CODAS[c]));continue
        if ch in " \n\t\r,.!?;:·—-…'\"()[]":continue
        raise ValueError(f"Unrecognized Hangul lyric symbol {ch!r}, refusing to guess phonetic text")
    if not out:raise ValueError("No recognized Hangul syllables/vowels")
    return tuple(out)


def validated_intervals(text: str, events: Sequence[dict]) -> tuple[Interval,...]:
    """Caller MUST supply verified syllable start/end and matching exact text.

    These intervals are trusted only as declared by caller. The engine does
    not assert true alignment unless `source='manually_verified'`.
    """
    parts=syllables(text)
    if len(events)!=len(parts):raise ValueError("One timed interval per Hangul syllable required")
    result=[];prev=0.
    for part,item in zip(parts,events):
        if item.get('glyph')!=part.glyph:raise ValueError('Timed syllable does not match actual text')
        start,end=item.get('start'),item.get('end')
        if not all(type(x) in (int,float) and math.isfinite(x) for x in (start,end)):
            raise ValueError('Valid numeric timestamps required')
        if start<prev-1e-9 or end<=start:raise ValueError('Intervals must be ordered and non-overlapping')
        if item.get('source')!='manually_verified':
            raise ValueError('Only explicitly reviewed segments can be labelled aligned')
        result.append(Interval(part,float(start),float(end),'manually_verified'))
        prev=end
    return tuple(result)


def preview_intervals(text: str, each_seconds: float=.85, offset: float=0.) -> tuple[Interval,...]:
    """For visual tests ONLY. No matching with a supplied song is asserted."""
    if not (.20<=each_seconds<=4 and math.isfinite(offset) and offset>=0):
        raise ValueError('Invalid preview spacing')
    return tuple(Interval(p,offset+i*each_seconds,offset+(i+1)*each_seconds,
                          'auto_preview_NOT_ALIGNED') for i,p in enumerate(syllables(text)))


def vowel_pose(vowel: str, fraction:float) -> Pose:
    """Continuous articulation for glide->nucleus, not one frozen y-vowel."""
    if not math.isfinite(fraction):raise ValueError('Nonfinite normalized time')
    f=float(np.clip(fraction,0.,1.))
    if vowel in TARGETS:return TARGETS[vowel]
    if vowel in GLIDES:
        # /j/ starts towards [i], then transitions to low/mid/round nucleus.
        # The 0.35 glide share is a preview parameter; must be learned per singer.
        t=np.clip(f/.35,0.,1.)
        return TARGETS['ㅣ'].blend(TARGETS[GLIDES[vowel]],smooth(t))
    if vowel in OTHER_VOWELS:
        start='ㅜ' if vowel in W_GLIDES else ('ㅡ' if vowel=='ㅢ' else 'ㅣ')
        t=np.clip(f/.35,0.,1.)
        return TARGETS[start].blend(TARGETS[OTHER_VOWELS[vowel]],smooth(t))
    raise ValueError(f"No visible viseme profile for {vowel}")


def smooth(x:float)->float:
    y=float(np.clip(x,0,1));return y*y*(3-2*y)


def pose_at(intervals:Sequence[Interval], seconds:float,
            energy:float|None=None)->tuple[Pose,dict]:
    """Text decides mouth identity; optional RMS modulates only jaw/open strength.

    Without confirmed per-syllable intervals, the status remains PREVIEW and
    must not be used to claim synchronized singing. No lyrics inferred by audio.
    """
    if not math.isfinite(seconds) or seconds<0:raise ValueError('Invalid time')
    if energy is not None and (not math.isfinite(energy) or not 0<=energy<=1):
        raise ValueError('Audio energy must be normalized [0,1]')
    row=next((x for x in intervals if x.start<=seconds<x.end),None)
    if row is None:return REST,{'status':'REST','glyph':'','alignmentVerified':False}
    f=(seconds-row.start)/(row.end-row.start)
    pose=vowel_pose(row.syllable.vowel,f)
    # Closure starts prior to the following vowel nucleus, not imposed
    # throughout the entire consonant+vowel syllable.
    onset_fraction=.13
    if row.syllable.onset in BILABIAL_ONSET and f<onset_fraction:
        pose=Pose(.015,pose.rounding,.22,pose.protrusion,.015).blend(pose,smooth(f/onset_fraction))
    # End lip-closure for a pronounced bilabial coda is approximated; actual
    # liaison / resyllabification requires a Korean G2P + alignment stage.
    if row.syllable.coda in BILABIAL_CODA and f>.82:
        end=smooth((f-.82)/.18)
        pose=pose.blend(Pose(.025,pose.rounding,.18,pose.protrusion,.03),end)
    # Blend adjacent syllable anticipatory posture in the last ~12%; no
    # phoneme-time assertion. Must never invert ㅛ/ㅗ etc.
    idx=intervals.index(row)
    if idx+1<len(intervals) and f>.88 and intervals[idx+1].start-row.end<.03:
        following=intervals[idx+1]
        nxt=vowel_pose(following.syllable.vowel,0.)
        if following.syllable.onset in BILABIAL_ONSET:
            nxt=Pose(.02,nxt.rounding,nxt.spreading,nxt.protrusion,.02)
        pose=pose.blend(nxt,smooth((f-.88)/.12)*.20)
    # Loudness affects movement magnitude, not vowel choice / linguistic token.
    if energy is not None:
        scale=.86+.28*energy  # max 14% articulation range vs nominal
        pose=Pose(*[float(np.clip(z*scale,0,1)) if k in (0,4) else z
                   for k,z in enumerate(pose.values())])
    return pose,dict(status='VERIFIED_TEXT_INTERVAL' if row.source=='manually_verified' else 'PREVIEW_UNALIGNED',
                     glyph=row.syllable.glyph,onset=row.syllable.onset,
                     vowel=row.syllable.vowel,coda=row.syllable.coda,
                     glide=row.syllable.vowel in GLIDES,
                     alignmentVerified=row.source=='manually_verified',
                     segmentStart=row.start,segmentEnd=row.end)


def face_warp(face:np.ndarray,pose:Pose,reference:Pose=REST)->tuple[np.ndarray,dict]:
    """2D whole-face continuous skin deformation: jaw, lips, cheeks, malar and lower lids.

    Mechanistic relationship is an editable *rig*, NOT individually recorded
    zygomatic, buccinator, mentalis or orbicularis muscle displacements.
    Speech-driven eyelid/cheek effects are small; blinking/emotional expression
    needs separate measured/semantic control rather than vowel stereotypes.
    """
    if face.dtype!=np.uint8 or face.ndim!=3 or face.shape[2]!=3 or min(face.shape[:2])<128:
        raise ValueError('uint8 BGR face crop >=128px required')
    if not all(math.isfinite(v) and 0<=v<=1 for v in pose.values()):
        raise ValueError('Invalid pose')
    h,w=face.shape[:2]
    yy,xx=np.mgrid[0:h,0:w].astype(np.float32)
    X=xx/w;Y=yy/h
    delta=np.array(pose.values())-np.array(reference.values())
    op,ro,spread,pro,jaw=delta
    dX=np.zeros((h,w),np.float32);dY=np.zeros((h,w),np.float32)
    # x,y, (horizontal/vertical displacement controlled by features), radius,
    # anatomy-inspired correlated local skin anchor fields. Values in face units.
    anchors=[
       (.50,.692,.00,-.009*op+.006*jaw,.17,.070,'upperLip'),
       (.50,.780,.00,.039*jaw,.20,.10,'lowerLip'),
       (.50,.894,.00,.043*jaw,.27,.13,'chin'),
       (.31,.738,-.022*spread+.015*ro,.013*jaw,.18,.13,'mouthLeft'),
       (.69,.738,+.022*spread-.015*ro,.013*jaw,.18,.13,'mouthRight'),
       (.25,.631,-.011*spread+.007*ro,.008*jaw,.20,.14,'cheekLeft'),
       (.75,.631,+.011*spread-.007*ro,.008*jaw,.20,.14,'cheekRight'),
       (.26,.553,-.006*spread,.004*jaw,.17,.12,'malarLeft'),
       (.74,.553,+.006*spread,.004*jaw,.17,.12,'malarRight'),
       (.32,.452,-.0018*spread,.0013*jaw,.16,.065,'lowerEyeLeft'),
       (.68,.452,+.0018*spread,.0013*jaw,.16,.065,'lowerEyeRight'),
    ]
    for cx,cy,dx,dy,rx,ry,_ in anchors:
        kernel=np.exp(-.5*(((X-cx)/rx)**2+((Y-cy)/ry)**2)).astype(np.float32)
        dX+=dx*kernel;dY+=dy*kernel
    # Rounding/pucker moves the skin of upper and lower vermilion towards
    # centre, rather than moving entire facial skin indiscriminately.
    lip=np.exp(-.5*(((X-.5)/.23)**2+((Y-.745)/.086)**2)).astype(np.float32)
    dX+=np.clip((.50-X)*(.15*ro+.08*pro),-.03,.03)*lip
    dY+=np.clip((.745-Y)*(.055*ro),-.009,.009)*lip
    # Locked perimeter attenuation: no motion at the facial crop boundary.
    boundary=np.clip(np.minimum.reduce([X/.18,(1-X)/.18,Y/.20,(1-Y)/.16]),0,1).astype(np.float32)
    dX*=boundary;dY*=boundary
    out=cv2.remap(face,(xx-dX*w).astype(np.float32),(yy-dY*h).astype(np.float32),
                  interpolation=cv2.INTER_CUBIC,borderMode=cv2.BORDER_REFLECT_101)
    return out,{'skinModel':'2D_correlated_surface_warp_NOT_measured_muscles',
                'areaTargets':['upperLip','lowerLip','chin','cheekLeft','cheekRight',
                               'malarLeft','malarRight','lowerEyeLeft','lowerEyeRight'],
                'maxHorizontalPixels':round(float(np.max(np.abs(dX*w))),3),
                'maxVerticalPixels':round(float(np.max(np.abs(dY*h))),3)}


def region_differences(before:np.ndarray,after:np.ndarray)->dict:
    if before.shape!=after.shape:raise ValueError('Images must share shape')
    h,w=before.shape[:2];diff=np.abs(before.astype(np.float32)-after.astype(np.float32))
    boxes={'mouth':(.33,.68,.67,.85),'jaw':(.29,.83,.71,.95),
       'leftCheek':(.17,.58,.36,.74),'rightCheek':(.64,.58,.83,.74),
       'leftMalar':(.17,.51,.34,.61),'rightMalar':(.66,.51,.83,.61),
       'leftLowerEye':(.23,.43,.39,.49),'rightLowerEye':(.61,.43,.77,.49),
       'edge':(.00,.00,.07,.07)}
    o={}
    for name,(x0,y0,x1,y1) in boxes.items():
        region=diff[int(y0*h):int(y1*h),int(x0*w):int(x1*w)]
        o[name]=round(float(region.mean()),6)
    return o