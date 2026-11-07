"""SONG self-hosted Korean SENTENCE context pretraining, independently evaluated.

The v15 Korean word-ratings encoder is further trained on actual Korean
whole-sentence movie-review polarity (NSMC original train/test splits).
This teaches contextual *linguistic polarity* and some negation evidence,
NOT a unique emotion for each word, singer performance intent, psychological
state, animation correctness, or verified 3D facial biomechanics.

The review corpus is a third-party Naver site scrape; Hugging Face e9t/nsmc
lists CC BY 2.0 but original-site use/derivative commercial rights need
separate verification. This is NONCOMMERCIAL RESEARCH ONLY.
"""
from __future__ import annotations

import csv
import hashlib
import io
import json
import random
import tempfile
import urllib.request
from pathlib import Path

import numpy as np
import torch
from torch import nn
from torch.utils.data import Dataset,DataLoader

from .word_feelings_v15 import (
    LearnedWordFeeling,VERSION as WORD_MODEL_VERSION,
    fetch_original_word_norms,read_norms_csv,train_word_meanings,
    encode_phrase
)

VERSION="song-v15-Korean-lexical-context-movie-review-polarity"
BASE="https://raw.githubusercontent.com/e9t/nsmc/master"
SOURCES={
    "train":BASE+"/ratings_train.txt",
    "holdout":BASE+"/ratings_test.txt",
}
SOURCE_CARD="https://huggingface.co/datasets/e9t/nsmc"
SOURCE_LICENSING="HF-CARD-CC-BY-2.0-ORIGINAL-NAVER-SCRAPE-RIGHTS-UNVERIFIED"


def download_reviews(split:str)->tuple[bytes,str]:
    if split not in SOURCES:
        raise ValueError("Only the two published disjoint NSMC review splits are allowed")
    request=urllib.request.Request(SOURCES[split],headers={
        "User-Agent":"SONG-v15-self-hosted-research/1.0"})
    with urllib.request.urlopen(request,timeout=180) as response:
        content=response.read(25*1024*1024+1)
    if not 500000<len(content)<=25*1024*1024:
        raise ValueError("Downloaded review data is missing or unexpectedly large")
    return content,hashlib.sha256(content).hexdigest()


def select_balanced_review_contexts(source:bytes,limit_per_polarity:int,
                                     *,excluded_texts=None)->list[tuple[str,int]]:
    """Direct ORIGINAL labelled sentence records, no generated emotion labels."""
    if not 16<=limit_per_polarity<=15000:
        raise ValueError("Unsupported balanced research subset size")
    if not isinstance(source,bytes) or len(source)>25*1024*1024:
        raise ValueError("Only original review TSV bytes supported")
    exclude=excluded_texts or set()
    groups={0:[],1:[]}
    seen=set()
    reader=csv.DictReader(io.StringIO(source.decode("utf-8-sig")),delimiter="\t")
    if reader.fieldnames is None or not {"id","document","label"}.issubset(reader.fieldnames):
        raise ValueError("Original NSMC labelled TSV columns do not match published data")
    for item in reader:
        text=(item["document"] or "").strip()
        answer=item["label"]
        if (answer not in ("0","1") or not 2<=len(text)<=140 or
                text in seen or text in exclude or
                len(text.split())>32):
            continue
        label=int(answer)
        groups[label].append(text)
        seen.add(text)
    if min(len(v) for v in groups.values())<limit_per_polarity:
        raise ValueError("Not enough actual, distinct Korean sentences per class")
    rng=random.Random(42)
    for values in groups.values():
        rng.shuffle(values)
    return [(txt,label) for label in (0,1)
            for txt in groups[label][:limit_per_polarity]]


class ReviewContextDataset(Dataset):
    def __init__(self,records):
        if not records:
            raise ValueError("Korean sentence records must be nonempty")
        self.records=records

    def __len__(self):
        return len(self.records)

    def __getitem__(self,i):
        text,label=self.records[i]
        tokens,mask=encode_phrase(text)
        return tokens,mask,torch.tensor(label,dtype=torch.long)


class ContextualPolarityFaceMeaning(nn.Module):
    def __init__(self):
        super().__init__()
        self.words=LearnedWordFeeling()
        self.review_polarity_head=nn.Sequential(
            nn.Linear(64,48),nn.GELU(),nn.Linear(48,2))

    def forward(self,word_char_codes,word_mask):
        semantic=self.words(word_char_codes,word_mask)
        return {
            "reviewPolarityLogits":self.review_polarity_head(semantic["phraseFeature"]),
            "wordNorms":semantic["wordNormEstimates"],
            "contextFeature":semantic["phraseFeature"],
        }


def _review_accuracy(model,loader):
    model.eval()
    checked=hits=0
    with torch.no_grad():
        for code,mask,labels in loader:
            estimates=model(code,mask)["reviewPolarityLogits"].argmax(dim=1)
            hits+=int((estimates==labels).sum())
            checked+=len(labels)
    return hits/checked if checked else None


def _holdout_norm_mae(net,rows):
    net.eval()
    scores=[]
    with torch.no_grad():
        for word,truth in rows:
            codes,mask=encode_phrase(word)
            pred=net(codes.unsqueeze(0),mask.unsqueeze(0))
            score=pred["wordNormEstimates"][0,0,:]
            scores.append(float(torch.abs(score-torch.tensor(truth)).mean()))
    return sum(scores)/len(scores)


def train_contextual_korean(
    actual_reviews_train:bytes,actual_reviews_holdout:bytes,
    actual_word_norm_csv:bytes,pretrained_words:Path,updated_word_checkpoint:Path,
    *,epochs:int=3,train_each:int=2500,holdout_each:int=400)->dict:
    if not 1<=epochs<=20 or updated_word_checkpoint.exists():
        raise ValueError("Invalid context training params or destination already exists")
    if not pretrained_words.is_file():
        raise FileNotFoundError("Actual previously trained word norms model needed")
    original=torch.load(pretrained_words,map_location="cpu",weights_only=True)
    if (original.get("modelVersion")!=WORD_MODEL_VERSION or
            original.get("status")!="research_only_word_affect_norm_model" or
            original.get("commerciallyValidated") is not False):
        raise ValueError("Unsupported pretrained word-norm research model")
    train_rows=select_balanced_review_contexts(actual_reviews_train,train_each)
    seen=set(text for text,label in train_rows)
    heldout_rows=select_balanced_review_contexts(
        actual_reviews_holdout,holdout_each,excluded_texts=seen)
    if seen.intersection(text for text,label in heldout_rows):
        raise ValueError("Movie review train/test text overlap not permitted")
    norms,stats=read_norms_csv(actual_word_norm_csv)
    rng=np.random.default_rng(42)
    permutation=rng.permutation(len(norms))
    train_word_norms=[norms[i] for i in permutation[:int(.8*len(norms))]]
    heldout_word_norms=[norms[i] for i in permutation[int(.8*len(norms)):]]
    torch.manual_seed(42)
    torch.set_num_threads(min(torch.get_num_threads(),2))
    model=ContextualPolarityFaceMeaning()
    model.words.load_state_dict(original["stateDict"],strict=True)
    starting_word_mae=_holdout_norm_mae(model.words,heldout_word_norms)
    opt=torch.optim.AdamW(model.parameters(),lr=.0005)
    train=DataLoader(ReviewContextDataset(train_rows),batch_size=24,shuffle=True)
    validation=DataLoader(ReviewContextDataset(heldout_rows),batch_size=24)
    history=[];best_score=-1.
    for epoch in range(1,epochs+1):
        model.train()
        word_rng=np.random.default_rng(42+epoch)
        for codes,mask,label in train:
            result=model(codes,mask)
            main=nn.functional.cross_entropy(result["reviewPolarityLogits"],label)
            # Continual normative word learning prevents the sentence task
            # from overwriting ALL of the original valence/arousal knowledge.
            sampled=word_rng.choice(len(train_word_norms),size=12,replace=False)
            norm_codes=[];norm_masks=[];norm_targets=[]
            for item in sampled:
                word,target=train_word_norms[int(item)]
                c,m=encode_phrase(word)
                norm_codes.append(c);norm_masks.append(m)
                norm_targets.append(torch.from_numpy(target.copy()))
            norm=model(torch.stack(norm_codes),torch.stack(norm_masks))["wordNorms"][:,0,:]
            norm_loss=(norm-torch.stack(norm_targets)).abs().mean()
            loss=main+.20*norm_loss
            opt.zero_grad(set_to_none=True)
            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(),1.)
            opt.step()
        correctness=_review_accuracy(model,validation)
        norm_error=_holdout_norm_mae(model.words,heldout_word_norms)
        record={
            "epoch":epoch,"heldoutMovieReviewPolarityAccuracy":round(correctness,5),
            "originalWordNormHoldoutMAE":round(norm_error,6),
            "reviewPolarityMajorityBaseline":.5,
            "trainedDistinctSentences":len(train_rows),
            "unseenDistinctSentences":len(heldout_rows),
        }
        history.append(record)
        print("SONG_V15_REAL_KOREAN_SENTENCE_CONTEXT_EPOCH="+json.dumps(record),flush=True)
        # Context class accuracy first; word norm stability as tie breaker.
        score=correctness-.05*norm_error
        if score>best_score:
            best_score=score
            updated_word_checkpoint.parent.mkdir(parents=True,exist_ok=True)
            torch.save({
                "modelVersion":WORD_MODEL_VERSION,
                "stateDict":{k:v.detach().cpu() for k,v in model.words.state_dict().items()},
                "reviewPolarityHeadStateDict":{
                    k:v.detach().cpu()
                    for k,v in model.review_polarity_head.state_dict().items()},
                "sourceDataset":"KoreanAffectWordNormsPlusNSMCReviewContext",
                "status":"research_only_word_affect_norm_model",
                "commerciallyValidated":False,
                "sourceLicenseStatus":SOURCE_LICENSING,
                "textContextTrainingTasks":("normative_word_valence_arousal",
                                            "whole_review_positive_negative"),
                "epoch":epoch,
            },updated_word_checkpoint)
    winner=max(history,key=lambda rec:rec["heldoutMovieReviewPolarityAccuracy"]-
               .05*rec["originalWordNormHoldoutMAE"])
    report={
        "modelVersion":WORD_MODEL_VERSION,
        "status":"research_only_not_lipsync_validated",
        "sourceDatasets":[
            "Korean Emotion Lexicon re-digitization 434 human rated emotion words",
            "Naver Sentiment Movie Corpus genuine 0/1 movie-review documents",
        ],
        "nsmcSource":SOURCE_CARD,
        "nsmcLicenseStatus":SOURCE_LICENSING,
        "wordNormSource":"https://huggingface.co/datasets/jonghwanhyeon/korean-emotion-lexicon",
        "realMovieReviewLabelsNotSongEmotionLabels":True,
        "realWordRatingsNotMuscleTargets":True,
        "actualLyricsToFacialMotionPairsLearned":False,
        "bestMovieReviewHoldout":winner,
        "wordRatingMAEBeforeReviewContextTraining":round(starting_word_mae,6),
        "history":history,"canAcceptPaidJobs":False,
        "commercialUseAllowed":False,
        "modelWeightsSha256":hashlib.sha256(updated_word_checkpoint.read_bytes()).hexdigest(),
    }
    updated_word_checkpoint.with_suffix(".report.json").write_text(
        json.dumps(report,ensure_ascii=False,indent=2),encoding="utf-8")
    return report
