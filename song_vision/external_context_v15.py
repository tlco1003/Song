"""Real Korean sentence-context training for SONG word-feeling AI.

Two genuine corpus tasks, independently evaluated:
 1. human-rated Korean emotion word valence/arousal,
 2. genuine Korean movie review text polarity with disjoint official splits.
This DOES NOT infer the singer's inner emotions or train word-to-face muscle
movement; real time-aligned emotional singing video is a separate stage.
Both raw text sources stay in temporary memory/storage, not public GitHub.
"""
from __future__ import annotations
import argparse
import json
import os
import tempfile
from pathlib import Path

from .word_feelings_v15 import (
    fetch_original_word_norms,train_word_meanings
)
from .korean_context_pretrain_v15 import (
    download_reviews,train_contextual_korean,
    SOURCE_LICENSING,SOURCE_CARD
)
from .research_vault_v15 import seal_study_model
from .korean_context_vault_v15 import seal_context_model

STUDY="song-v15-real-Korean-word-norms-and-sentence-context-pretraining"


def run(*,public_key:Path,archive_dir:Path,
        word_epochs:int=8,sentence_epochs:int=3)->dict:
    if not public_key.is_file():
        raise FileNotFoundError("Owner X25519 public research key required")
    if archive_dir.exists() and any(archive_dir.iterdir()):
        raise FileExistsError("Never overwrite existing word/corpus research weights")
    if not 1<=word_epochs<=30 or not 1<=sentence_epochs<=20:
        raise ValueError("Unsupported research epoch controls")
    with tempfile.TemporaryDirectory(prefix="song-v15-korean-sentences-private-") as tmp:
        root=Path(tmp)
        raw_norms,norm_sha=fetch_original_word_norms()
        word_only=root/"word-only-research.pt"
        word_report=train_word_meanings(raw_norms,word_only,epochs=word_epochs)
        reviews_train,train_sha=download_reviews("train")
        reviews_holdout,hold_sha=download_reviews("holdout")
        combined=root/"words-plus-sentence-context.pt"
        report=train_contextual_korean(
            reviews_train,reviews_holdout,raw_norms,
            word_only,combined,
            epochs=sentence_epochs,train_each=2500,holdout_each=400)
        run_id=os.getenv("GITHUB_RUN_ID","owner-private")
        attempt=os.getenv("GITHUB_RUN_ATTEMPT","1")
        label=f"{run_id}-a{attempt}"
        word_name=f"song-v15-human-word-affect-{label}.svault"
        context_name=f"song-v15-word-and-context-{label}.svault"
        word_enc=seal_study_model(
            word_only,word_only.with_suffix(".report.json"),
            public_key,archive_dir/word_name,
            dataset="KOREAN-EMOTION-WORD-RATINGS",run_id=label)
        combined_enc=seal_context_model(
            combined,combined.with_suffix(".report.json"),
            public_key,archive_dir/context_name,run_id=label)
        summary={
            "study":STUDY,"lexicalSourceHash":norm_sha,
            "originalNSMCTrainHash":train_sha,
            "originalNSMCHeldoutHash":hold_sha,
            "sourceCard":SOURCE_CARD,
            "sourceLicenseStatus":SOURCE_LICENSING,
            "realTrainingWords":word_report["trainingWords"],
            "realWordValidation":word_report["bestValenceArousalMAE"],
            "humanWordMeanBaseline":word_report["baselineMAE"],
            "realContextMetrics":report["bestMovieReviewHoldout"],
            "contextAccuracyIsNotSongEmotionAccuracy":True,
            "actualKoreanSungWordToFaceLearned":False,
            "realMuscleForceMeasured":False,
            "wordNormResearchArchive":word_enc,
            "independentContextResearchArchive":combined_enc,
            "commercialUseAllowed":False,
            "canAcceptPaidJobs":False,
        }
        (archive_dir/(f"song-v15-context-{label}.manifest.json")).write_text(
            json.dumps(summary,ensure_ascii=False,indent=2,sort_keys=True),
            encoding="utf-8")
        print("SONG_V15_REAL_KOREAN_WORD_CONTEXT_RESULT="+
              json.dumps(summary,ensure_ascii=False,sort_keys=True),flush=True)
        return summary


def main():
    parser=argparse.ArgumentParser(description="Self-hosted original Korean word+sentence semantics study")
    parser.add_argument("--research-only-acknowledgement",action="store_true")
    parser.add_argument("--owner-public-key",required=True,type=Path)
    parser.add_argument("--archive-dir",required=True,type=Path)
    parser.add_argument("--word-epochs",type=int,default=8)
    parser.add_argument("--context-epochs",type=int,default=3)
    args=parser.parse_args()
    if not args.research_only_acknowledgement:
        parser.error("Original Korean source licenses must be reviewed before commercial reuse")
    run(public_key=args.owner_public_key,archive_dir=args.archive_dir,
        word_epochs=args.word_epochs,sentence_epochs=args.context_epochs)


if __name__=="__main__":
    main()
