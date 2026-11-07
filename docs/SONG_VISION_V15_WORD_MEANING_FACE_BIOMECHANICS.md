# SONG-Vision v15 — self-trained language/meaning -> expression -> anatomy-informed facial skin

**2026-11-07. Actual executable Python, independent of third-party video-generation APIs.**
Branch `feature/song-vision-self-hosted-v1`, research vault `research/song-vision-vault`.

## Target

SONG is not simply a lip movement predictor. It must learn (a) what a lyric word means, (b) how sentence context and singer's intended delivery change its affect, (c) how phoneme articulation and vocal dynamics drive jaw/lips and (d) how learned facial muscle-control *proxies* lead to observed full-face soft-tissue movement. The final model must combine meaning, phonemes, real vocal intensity, individual static face and time-dependent emotional intent. **It does not generate vocals or synthesize voice.**

## Implemented code, not only proposals

- `song_vision/word_feelings_v15.py`: ORIGINAL train-from-scratch character/word embedding and bidirectional-GRU sentence-context encoder. Learns two human-rated word dimensions (valence and arousal) from published actual Korean emotion word records. The data source is the Korean Emotion Lexicon community digitization at https://huggingface.co/datasets/jonghwanhyeon/korean-emotion-lexicon, `5-level.csv`; credits Park & Min (2005), https://www.kci.go.kr/kciportal/landing/article.kci?arti_id=ART000958746. Dataset listing indicates CC0 for republication but the original paper copyright and commercial rights for derivative models need independent verification; all generated outputs remain research-only.
- `song_vision/lyric_intent_v15.py`: The real owner/reviewer may supply an exact-vocal-SHA256-matched annotation with full lyrics, the words sung at their ACTUAL timestamps, sentence context, and optional expressive intent per performance (valence/arousal/tension/warmth). A word repeated with opposing intentions is represented by different time/context records, **not by a fixed word->face emotion rule**. No fake lyrics or guessed word-to-audio timing.
- `song_vision/learned_face_body_v15.py`: An independently trainable self-owned `TrainableProjectedFaceRig`. Inputs 38 measured face-motion features, 4 iris xy, 8x61 vocal dynamics, 64D learned semantic vector, source 478 projected face landmarks, and optional reviewed performance intent. It learns 14 **surrogate** facial action controls including orbicularis oris, zygomaticus, buccinator, corrugator, orbicularis oculi, mentalis, jaw. These are learned latent controls, **NOT measured muscle EMG**.
- The rig incorporates rigid upper-face anchor constraints, a dynamic lower-jaw **image-plane hinge surrogate**, locally smooth projected soft tissue displacement and neighbor-smoothing regularization. It learns directly from actual reference and target 478-point **same-person** facial surfaces. `projected_tissue_warp` differentiably warps the consented portrait surface using the predicted mesh. This is a 2D soft-tissue morph, not CT-based skeletal simulation, volumetric FEM or measured 3D skin elasticity.
- `song_vision/external_semantic_face_v15.py`: A real-data study runs two distinct stages (Korean published human word-rating learning; licensed RAVDESS singing face-motion and physical-proxy training with performer-disjoint holdout), quantifies heldout facial skin motion vs unchanged reference and same-clip 320ms shifted vocal, and retains three **separately encrypted** research checkpoints.
- `song_vision/research_vault_v15.py`: encryption using owner-held X25519 public key + HKDF/AESGCM. It keeps RAVDESS CC BY-NC-SA 4.0 distinct from Korean lexicon source `COMMUNITY-CC0-ORIGINAL-PAPER-RIGHTS-UNVERIFIED`. The old study weights are never overwritten or discarded.
- `song_vision/test_semantic_body_v15.py`: actual PyTorch train/gradient tests, repeated-word opposite intent tests, legitimate vocal SHA/lyric SHA checks, and skin mesh warping / real data pathway synthetic tests.

## Crucial current validation gap

The RAVDESS actors sing short English lines, and **the dataset contains no independently reviewed word-by-word Korean lyric emotional-intent timestamps**. The Korean lexicon can teach how rated Korean word meanings correlate with valence/arousal; RAVDESS videos can teach how audio/prosody and acted facial expressions correlate. They **do not automatically teach a causal word-to-unique-facial-muscle transformation**. The `semanticReviewedFrameCount` metric MUST be 0 without real matched lyric annotations, and report flags `NO_WORD_TIMED_FACIAL_SEMANTIC_TRAINING_DATA`. This model is not yet independently validated to express '보고 싶었어' as longing versus joy; real consenting singer video with same lyric performed in distinct emotional styles is required to directly supervise that association.

Likewise, images of skin cannot measure precise skull topology, masseter force or 3D tension. Under the current 478-point projection, learned muscle controls are anatomy-*informed* functional proxies only. Achieving physically valid 3D jaw and skin stress simulation requires licensed scans, face meshes, measured muscle/skin properties, lip-tooth contact constraints, and separate evaluation. See Lucero & Munhall (1999), https://doi.org/10.1121/1.428108 ; Wu et al. (2014), https://doi.org/10.1109/TVCG.2014.2339835 ; Nazari et al. (2011), https://doi.org/10.1123/mcj.15.1.141 .

Psycholinguistic basis for separate but interacting lexical content and prosody: Nygaard & Queen (2008), https://doi.org/10.1037/0096-1523.34.4.1017 ; Pell et al. (2011), https://doi.org/10.1080/02699931.2010.516915 .

## End-to-end real study contract

1. Train semantic word/context encoder against actual valence/arousal norms. Hold out 20% distinct word items; report validation MAE **vs constant-mean baseline** and preserve source SHA. Semantic loss is not singer-expression accuracy.
2. Train earlier v13 on actual synchronized face + original vocal with separate actor03 holdout (RAVDESS CC BY-NC-SA).
3. Train projected skin rig from same-video source/target 478 landmark positions, with same verified vocal. Because RAVDESS lacks word-time annotations, semantics are explicitly gated off for the face-training examples.
4. Compare correct-original-vocal facial skin projection with static source and original song shifted 320ms within the SAME clip. Report both landmark and dynamic image ROI error. **If model is worse than static baseline or does not beat shifted vocal, quality fails.**
5. Save word, face motion and skin rig weights as three unique immutable ciphertext files in research/song-vision-vault; do not publish actor images/video/vocals or plaintext licensed word data.

## Future genuine same-word cross-emotion training input

A reviewed `lyrics-reviewed-v15.json` in the PREPARED PRIVATE clip folder must have:

```json
{
  "schemaVersion": 1,
  "reviewStatus": "human_verified",
  "verifiedBy": "actual-reviewer-id",
  "sourceVocalSha256": "actual-64-character-hex-sha256-of-original-vocal-file",
  "title": "실제 원곡명",
  "fullLyrics": "보고 싶었어 정말 보고 싶었어",
  "lyricsSha256": "actual-sha256-of-fullLyrics-utf8",
  "words": [
    {"word": "보고", "startSeconds": 0.1, "endSeconds": 0.3, "expressiveIntent": {"valence": 0.6, "arousal": 0.3, "tension": -0.2, "warmth": 0.8}},
    {"word": "싶었어", "startSeconds": 0.3, "endSeconds": 1.0, "expressiveIntent": {"valence": -0.5, "arousal": 0.2, "tension": 0.5, "warmth": 0.2}}
  ]
}
```

Note that example sha fields are placeholders and deliberately invalid for execution. The word mood scores are the *performer's annotated expressive intention*, **not an assertion of true mental state**.

## Current operational status

Workflow `.github/workflows/song-vision-v15-semantic-body.yml` runs Python tests before data downloading, then real academic research. Existing customer path `canAcceptPaidJobs=false`, no commercial inference. A successful GitHub Workflow is NOT a pass for phoneme-level singer synchronization or physically valid real-skin motion.
