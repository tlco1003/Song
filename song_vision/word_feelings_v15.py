"""SONG v15 train-FROM-SCRATCH Korean semantic/affective word representation.

Learns from observed, published human word ratings (valence, arousal), NOT
a handwritten if-word-is-'love'-then-smile rule. Sentence/lyric context is
learnable using a bidirectional GRU; conflicting emotions for identical words
are represented by separate expression-intent and singer-vocal conditions.

Published word norms: Park & Min (2005), Korean Emotion Terms, 434 terms.
Community digital transcription:
 https://huggingface.co/datasets/jonghwanhyeon/korean-emotion-lexicon
 Dataset listing CC0; underlying paper copyrighted: research-only unless
 provenance/rights independently verified for commercial reuse.

Word norms are NOT facial expression labels and NOT actual emotion diagnoses.
Do not infer live listener/singer mental health or psychological state.
"""
from __future__ import annotations

import csv
import hashlib
import io
import json
import math
import re
import tempfile
import urllib.request
from pathlib import Path

import numpy as np
import torch
from torch import nn
from torch.utils.data import DataLoader, Dataset

VERSION="song-v15-korean-contextual-semantic-affect-v1"
SOURCE="https://huggingface.co/datasets/jonghwanhyeon/korean-emotion-lexicon/resolve/main/5-level.csv"
PAPER="https://www.kci.go.kr/kciportal/landing/article.kci?arti_id=ART000958746"
VOCAB=8192
MAX_CHARS=64
MAX_WORDS=32
TEXT_FEATURES=64
SCALES=("valence","arousal")


def character_indices(text: str, maximum: int=MAX_CHARS)->list[int]:
    """Deterministic open-vocabulary chars: Korean syllables and UTF-8 words."""
    if not isinstance(text,str) or not text.strip() or len(text)>2000:
        raise ValueError("Nonempty human text within size limits required")
    result=[]
    for char in text[:maximum]:
        digest=hashlib.blake2s(char.encode("utf-8"),digest_size=4,
                               person=b"songtxt").digest()
        result.append(1+int.from_bytes(digest,"little")%(VOCAB-1))
    return result or [1]


def encode_phrase(text: str)->tuple[torch.Tensor,torch.Tensor]:
    words=text.strip().split()
    if not words or len(words)>MAX_WORDS:
        raise ValueError("Expected 1 to 32 lyric words")
    codes=torch.zeros(MAX_WORDS,MAX_CHARS,dtype=torch.long)
    real=torch.zeros(MAX_WORDS,dtype=torch.bool)
    for j,word in enumerate(words):
        vals=character_indices(word)
        codes[j,:len(vals)]=torch.tensor(vals)
        real[j]=True
    return codes,real


class LearnedWordFeeling(nn.Module):
    """Trainable word embedding, contextual sequence and separate two-factor affect.

    The output is perceived normative valence/arousal *estimate*, not
    'face expression', and may differ from the songwriter's intended emotion.
    """
    def __init__(self):
        super().__init__()
        self.char_embed=nn.Embedding(VOCAB,32,padding_idx=0)
        self.char_project=nn.Sequential(
            nn.Linear(32,64),nn.GELU(),nn.Linear(64,TEXT_FEATURES))
        self.context=nn.GRU(TEXT_FEATURES,32,batch_first=True,bidirectional=True)
        self.affect=nn.Sequential(
            nn.Linear(TEXT_FEATURES,64),nn.GELU(),
            nn.Linear(64,2),nn.Sigmoid())
        self.contextual_gate=nn.Linear(TEXT_FEATURES,TEXT_FEATURES)

    def forward(self,codes:torch.Tensor,valid_words:torch.Tensor):
        if (codes.ndim!=3 or codes.shape[1:]!=(MAX_WORDS,MAX_CHARS)
                or valid_words.shape!=codes.shape[:2]
                or (codes<0).any() or (codes>=VOCAB).any()):
            raise ValueError("Expected Korean phrase char codes [B,32,64] and word mask")
        embedded=self.char_embed(codes)
        char_mask=(codes!=0).unsqueeze(-1).to(embedded.dtype)
        words=(embedded*char_mask).sum(dim=2)/char_mask.sum(dim=2).clamp(min=1.)
        word_features=self.char_project(words)
        context,_=self.context(word_features)
        # Each word combines its learned lexical representation with
        # surrounding text. No fixed mapping from words to expressions.
        combined=word_features+torch.tanh(self.contextual_gate(context))
        combined=combined*valid_words.unsqueeze(-1).to(combined.dtype)
        scores=self.affect(combined)
        return {"wordFeatures":combined,"wordNormEstimates":scores,
                "phraseFeature":combined.sum(dim=1) /
                valid_words.sum(dim=1,keepdim=True).clamp(min=1)}


class NormRatings(Dataset):
    def __init__(self,rows):
        if len(rows)<8:
            raise ValueError("Insufficient actual human word evaluations")
        self.rows=rows

    def __len__(self):
        return len(self.rows)

    def __getitem__(self,i):
        word,target=self.rows[i]
        codes,mask=encode_phrase(word)
        return codes,mask,torch.tensor(target,dtype=torch.float32)


def read_norms_csv(raw:bytes)->tuple[list[tuple[str,np.ndarray]],dict]:
    if len(raw)>3*1024*1024 or len(raw)<1000:
        raise ValueError("Unexpected Korean word norm data size")
    decoded=raw.decode("utf-8-sig")
    source=csv.DictReader(io.StringIO(decoded))
    required={"lexicon","valence","arousal"}
    if source.fieldnames is None or not required.issubset(source.fieldnames):
        raise ValueError("Original dataset lacks rated Korean words")
    rows=[]
    seen=set()
    mins=[float("inf")]*2
    maxes=[float("-inf")]*2
    for entry in source:
        word=entry["lexicon"].strip()
        if not 1<=len(word)<=24 or word in seen or not re.search("[가-힣]",word):
            continue
        try:
            v,a=float(entry["valence"]),float(entry["arousal"])
        except (TypeError,ValueError):
            continue
        if not(math.isfinite(v) and math.isfinite(a) and
               0<=v<=7 and 0<=a<=7):
            raise ValueError("Human affect ratings have unexpected scale")
        rows.append((word,np.asarray((v,a),dtype=np.float32)))
        seen.add(word)
        for i,x in enumerate((v,a)):
            mins[i]=min(mins[i],x)
            maxes[i]=max(maxes[i],x)
    if len(rows)<300:
        raise ValueError("Not enough real Korean rated words to learn word semantics")
    for i in range(2):
        if maxes[i]-mins[i]<.5:
            raise ValueError("Invalid affect rating distribution")
    # Explicitly empirical scale from this particular source, not a claim
    # that ratings represent universal percentages or clinical measurements.
    normal=[(word,(value-np.asarray(mins,dtype=np.float32)) /
             (np.asarray(maxes,dtype=np.float32)-np.asarray(mins,dtype=np.float32)))
            for word,value in rows]
    return normal,{"rawScoreMins":mins,"rawScoreMaxes":maxes,
                   "observedWordCount":len(rows)}


def fetch_original_word_norms()->tuple[bytes,str]:
    req=urllib.request.Request(SOURCE,headers={"User-Agent":"SONG-research-text/1.0"})
    with urllib.request.urlopen(req,timeout=90) as response:
        if response.status!=200:
            raise ValueError("Original norm dataset unavailable")
        data=response.read(3*1024*1024+1)
    if len(data)>3*1024*1024:
        raise ValueError("Oversized source file")
    return data,hashlib.sha256(data).hexdigest()


def train_word_meanings(raw_csv:bytes,checkpoint:Path,*,epochs=10)->dict:
    if not 1<=epochs<=50 or checkpoint.exists():
        raise ValueError("Invalid real word norm train params or checkpoint exists")
    rows,source_stats=read_norms_csv(raw_csv)
    rng=np.random.default_rng(42)
    indexes=rng.permutation(len(rows))
    cutoff=int(len(rows)*.8)
    train_rows=[rows[i] for i in indexes[:cutoff]]
    val_rows=[rows[i] for i in indexes[cutoff:]]
    network=LearnedWordFeeling()
    torch.set_num_threads(min(torch.get_num_threads(),2))
    torch.manual_seed(42)
    opt=torch.optim.AdamW(network.parameters(),lr=.001)
    train=DataLoader(NormRatings(train_rows),batch_size=24,shuffle=True)
    valid=DataLoader(NormRatings(val_rows),batch_size=24,shuffle=False)
    naive=torch.from_numpy(np.mean([x[1] for x in train_rows],axis=0)).float()
    naive_mae=float(np.mean([np.abs(x[1]-naive.numpy()).mean() for x in val_rows]))
    history=[]
    best=float("inf")
    for epoch in range(1,epochs+1):
        network.train()
        for codes,mask,truth in train:
            predicted=network(codes,mask)["wordNormEstimates"][:,0,:]
            loss=(predicted-truth).abs().mean()
            opt.zero_grad(set_to_none=True)
            loss.backward()
            nn.utils.clip_grad_norm_(network.parameters(),1.)
            opt.step()
        network.eval()
        total=seen=0.
        with torch.no_grad():
            for codes,mask,truth in valid:
                val=(network(codes,mask)["wordNormEstimates"][:,0,:]-truth).abs().mean()
                total+=float(val)*len(codes)
                seen+=len(codes)
        val_error=total/seen
        entry={"epoch":epoch,"validationNormMAE":round(val_error,6),
               "trainingWords":len(train_rows),
               "independentHeldoutWords":len(val_rows),
               "constantMeanBaselineMAE":round(naive_mae,6)}
        history.append(entry)
        print("SONG_V15_WORD_FEELING_TRAIN_EPOCH="+json.dumps(entry),flush=True)
        if val_error<best:
            best=val_error
            checkpoint.parent.mkdir(parents=True,exist_ok=True)
            torch.save({
                "modelVersion":VERSION,
                "stateDict":{k:v.detach().cpu() for k,v in network.state_dict().items()},
                "sourceDataset":"KoreanEmotionLexiconDigitization",
                "sourceSha256":hashlib.sha256(raw_csv).hexdigest(),
                "sourceLicenseStatus":"CHECK_ORIGINAL_RESEARCH_RIGHTS_BEFORE_COMMERCIAL",
                "versionedAffectScale":source_stats,
                "commerciallyValidated":False,
                "status":"research_only_word_affect_norm_model",
                "epoch":epoch,
            },checkpoint)
    report={
        "modelVersion":VERSION,
        "status":"research_only_not_lipsync_validated",
        "source":SOURCE,"primaryPaper":PAPER,
        "sourceSha256":hashlib.sha256(raw_csv).hexdigest(),
        "trainingWords":len(train_rows),"holdoutWords":len(val_rows),
        "baselineMAE":round(naive_mae,6),
        "bestValenceArousalMAE":round(best,6),
        "bestEpoch":min(history,key=lambda x:x["validationNormMAE"])["epoch"],
        "history":history,
        "datasetStats":source_stats,
        "wordNormsNotActualSingerEmotion":True,
        "actualSentenceEmotionOrVideoTrained":False,
        "rightsForCommercialDerivativeModelConfirmed":False,
        "canAcceptPaidJobs":False,
        "checkpointSha256":hashlib.sha256(checkpoint.read_bytes()).hexdigest(),
    }
    checkpoint.with_suffix(".report.json").write_text(
        json.dumps(report,ensure_ascii=False,indent=2),encoding="utf-8")
    return report
