"""Source-scoped encrypted archive for Korean word norms plus NSMC context.

This wraps the existing SONG-v15 X25519 + AES-256-GCM vault without
mislabeling movie-review source material as RAVDESS singing footage.
Use only inside the explicitly approved noncommercial research runner.
"""
from __future__ import annotations
from pathlib import Path
from . import research_vault_v15 as vault

SOURCE_ID="KOREAN-WORD-NORM-AND-NSMC-REVIEW-CONTEXT"
SOURCE_DETAIL={
    "license":"WORD_REPUBLISH_CC0_NSMC_REPUBLISH_CC_BY_2_ORIGINAL_RIGHTS_UNVERIFIED",
    "url":"https://huggingface.co/datasets/e9t/nsmc",
    "otherSource":"https://huggingface.co/datasets/jonghwanhyeon/korean-emotion-lexicon",
    "commercialRightsForDerivativeWeightsConfirmed":False,
}


def seal_context_model(model:Path,report:Path,public_key:Path,
                       output:Path,run_id:str)->dict:
    # This source is supported ONLY through this trusted fixed-scoped wrapper.
    vault.SOURCES[SOURCE_ID]=SOURCE_DETAIL
    return vault.seal_study_model(model,report,public_key,output,
                                  dataset=SOURCE_ID,run_id=run_id)
