"""Verified words + singer intention -> per-frame semantic training context.

One word may carry opposite emotional expressions in different contexts.
The same word can be tender, sarcastic, grieving or triumphant depending on
the whole lyric, performance prosody and human-specified expressive intent.

These are OPTIONAL author-confirmed per-performance labels, not silently
generated phoneme timestamps or presumed psychological diagnoses.
Each annotation binds to the EXACT source audio SHA256 and content text.
"""
from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path

import torch

from .word_feelings_v15 import MAX_WORDS, encode_phrase

VERSION="song-v15-reviewed-lyric-context-v1"
INTENT_NAMES=("valence","arousal","tension","warmth")


def load_reviewed_song_words(path:Path,actual_vocal_sha256:str)->dict:
    raw=json.loads(Path(path).read_text(encoding="utf-8"))
    if (raw.get("schemaVersion")!=1 or
            raw.get("reviewStatus")!="human_verified" or
            raw.get("sourceVocalSha256")!=actual_vocal_sha256 or
            not isinstance(raw.get("verifiedBy"),str) or not raw["verifiedBy"].strip()):
        raise ValueError("Verified original singer vocal, human review and attribution required")
    title=raw.get("title")
    lyric=raw.get("fullLyrics")
    if not isinstance(title,str) or not title.strip() or len(title)>200:
        raise ValueError("Song title required")
    if not isinstance(lyric,str) or not lyric.strip() or len(lyric)>8000:
        raise ValueError("Original lyrics required")
    digest=hashlib.sha256(lyric.encode("utf-8")).hexdigest()
    if raw.get("lyricsSha256")!=digest:
        raise ValueError("Song lyric source hash mismatch")
    segments=raw.get("words")
    if not isinstance(segments,list) or not 1<=len(segments)<=2048:
        raise ValueError("Expected reviewed sung word sequence")
    prepared=[]
    previous_end=0.
    for item in segments:
        if not isinstance(item,dict):
            raise ValueError("Invalid word segment")
        word=item.get("word")
        a,b=item.get("startSeconds"),item.get("endSeconds")
        if not isinstance(word,str) or not word.strip() or len(word)>64:
            raise ValueError("Human-reviewed word must contain actual sung text")
        if not isinstance(a,(float,int)) or not isinstance(b,(float,int)) or not (
            math.isfinite(a) and math.isfinite(b) and 0<=a<b<=900 and a>=previous_end-.005):
            raise ValueError("Invalid chronological sung word timestamp")
        # Song lyrics may repeat; word text must occur in original lyric text.
        if word not in lyric:
            raise ValueError("Reviewed word does not occur in actual submitted lyrics")
        intent=item.get("expressiveIntent")
        if intent is not None:
            if not isinstance(intent,dict) or set(intent)!=set(INTENT_NAMES):
                raise ValueError("Reviewed expression intent must contain four explicit axes")
            if any(type(intent[k]) not in (int,float) or
                   not math.isfinite(intent[k]) or not -1<=intent[k]<=1
                   for k in INTENT_NAMES):
                raise ValueError("Expression intent values must be finite within [-1,1]")
        prepared.append((word,float(a),float(b),
                         None if intent is None else
                         [float(intent[k]) for k in INTENT_NAMES]))
        previous_end=float(b)
    return {"title":title,"sourceVocalSha256":actual_vocal_sha256,
            "fullLyrics":lyric,"words":prepared,
            "verifiedBy":raw["verifiedBy"]}


def reviewed_context_at_time(verified:dict | None,second:float,
                             radius:int=3):
    """Returned fields include whether there was ACTUAL temporal human evidence.

    A word's semantic norm is NOT its performance intent; both are distinct.
    """
    if verified is None:
        codes,mask=encode_phrase("무표정")
        return {
            "codes":torch.zeros_like(codes),"wordsValid":torch.zeros_like(mask),
            "reviewedWordPresent":False,
            "intentValid":False,
            "intent":torch.zeros(4),
        }
    if not 0<=radius<=8 or not math.isfinite(second):
        raise ValueError("Invalid time or context radius")
    words=verified["words"]
    active=[i for i,(_,a,b,_) in enumerate(words) if a<=second<b]
    if len(active)>1:
        raise ValueError("Overlapping word labels not permitted in single-track version")
    if not active:
        return reviewed_context_at_time(None,second)
    index=active[0]
    start=max(0,index-radius)
    end=min(len(words),index+radius+1)
    sample=" ".join(item[0] for item in words[start:end])
    codes,mask=encode_phrase(sample)
    intent=words[index][3]
    return {
        "codes":codes,"wordsValid":mask,
        "reviewedWordPresent":True,"activeWord":words[index][0],
        "intentValid":intent is not None,
        "intent":torch.tensor(intent if intent is not None else [0.]*4,dtype=torch.float32),
    }
