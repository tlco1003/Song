# SONG-Vision v15.2 — genuine Korean sentence-context learning, NOT hardcoded lyric emotions

Independent branch research stage; do not conflate spoken-word affect, movie-review polarity, and observed facial-expression emotion.

**Two genuine empirical training tasks:**
- Park & Min (2005) Korean emotion words, human valence/arousal ratings (434 words), KCI https://www.kci.go.kr/kciportal/landing/article.kci?arti_id=ART000958746. Community digitization https://huggingface.co/datasets/jonghwanhyeon/korean-emotion-lexicon, cc0 listed by republisher but original journal rights for derivative commercialization not independently verified.
- Real Korean sentence-level movie review polarity from e9t/NSMC, official train 150,000 vs official heldout test 50,000 documents, project https://github.com/e9t/nsmc and HF dataset card https://huggingface.co/datasets/e9t/nsmc (republisher shows cc-by-2.0). **Underlying movie review/site rights and commercial derivative permission not independently confirmed.** We train on a balanced subset of actual original train and test items, exclude duplicated/blank documents, and verify no exact text overlap across selected train/test.

**Implemented executable model:**
- `song_vision/korean_context_pretrain_v15.py` — `ContextualPolarityFaceMeaning`: warm-start a *self-trained* `LearnedWordFeeling` model from real human emotion-word norms; update the same word/character + bidirectional GRU contextual encoder to predict sentence review polarity using a trainable neural classification head; continue real word-normative MAE training as regularization so sentence-level reviews don't trivially destroy original lexical affect structure.
- Training data are **real Korean phrases** (not dictionaries manually mapping words to smiles). Predict 0/1 review label with a verified independent test split and report accuracy relative to 50% random/majority baseline. Also measure before/after human word-norm MAE; a heldout review score is NOT an estimate of which face should frown.
- Produces a distinct **updated word encoder checkpoint compatible with v15 `LearnedWordFeeling`** and a separate review-polarity head. The updated encoder can be restored to the v15 skin/face study, but RAVDESS has no matched Korean lyrics and therefore actual semantic word-to-singer-face learning remains disabled unless consented aligned song annotations are provided.
- `song_vision/external_context_v15.py` downloads the original NSMC train/test TSV and word-norm CSV during CI, trains and encrypts both word-only and context-updated weights. No pretrained third-party NLP or video generation model, no output lyrics, no audio synthesis.
- `song_vision/korean_context_vault_v15.py` uses owner-controlled X25519 AES-GCM research vault and explicitly authenticates **combined source metadata**; no improper RAVDESS/Seoul Corpus license swapping. `song_vision/test_korean_context_v15.py` tests actually trainable word and sentence conditions using synthetic data prior to real data execution.

**Emotional semantics are not a direct biomechanical mapping.** A sentiment-labelled review is not tenderness/longing/pain; contextual word embeddings are not verified human emotional state and can't command exact jaw, cheek or eyelid motions by themselves. Singing needs actual sung phone timing, audio prosody, artist intent and corresponding recorded face motion to train the expression-to-body relationship. **Review polarity and face motion training results are reported separately.**

Results remain research-only, no paid customer jobs or public media/audio publication.
