# SONG-Vision v16: contextual singing face learning

2026-11-07. Branch: `feature/song-vision-self-hosted-v1`.

## Implemented execution path

`source-bound lyrics + whole-vocal spectral/dynamic trajectory + synchronized local vocal windows + reference image/surface -> trainable contextual UTF-8 Transformer -> audio/text temporal GRU -> expression coefficients + projected jaw rotation / learned surface offsets -> full-face renderer -> differentiable surface warp -> 96px sequence`.

This is executable PyTorch, trained through the generated pixels. The existing v15 `LearnedWordFeeling` encoder is integrated, with an optional
checkpoint trained on real Korean word valence/arousal ratings. Its features
join the full-context Transformer and affect generated pixels. It processes all
32-word chunks rather than silently discarding later chunks. Lexical features
do not substitute for contextual meaning. No external LLM,
word-to-expression dictionary, or volume-to-frown rule is used. The model is
initialized randomly unless explicitly warm-started from compatible v13/v14
research checkpoints. A fresh language encoder does **not** already understand
Korean words. This path makes contextual learning possible; correctness requires
varied paired lyrics, performance video and reviewed context labels.

## Files

- `song_vision/lyric_context_v16.py`: lossless Korean UTF-8 tokens, source SHA/time-bound transcript validation, reviewed word timing, full context attention, optional masked language self-supervision.
- `song_vision/contextual_face_v16.py`: audio/text fusion, whole-vocal trajectory context, temporal modeling, surface rig, pixel generation.
- `song_vision/contextual_training_v16.py`: real prepared-sequence loader, train/evaluation, optional v13/v14 warm-start, checkpoint reload, performer/audio leakage checks.
- `song_vision/contextual_audit_v16.py`: original/generated/no-lyrics comparison at exactly matching frame times, lossless PCM sample verification including the first frame offset.
- `song_vision/external_ravdess_context_v16.py`: reproducible 24-clip real singing pilot, official transcripts, same-audio comparison, encrypted checkpoint archival.
- `song_vision/test_contextual_face_v16.py`: synthetic mechanics tests; these are not real-world semantic or visual quality evidence.

## Learning and supervision

The Transformer learns context across the selected lyric/verse window. The
current word's byte interval is an additional signal only when genuine reviewed
word timings exist. Otherwise the model receives whole-context text without
inventing word timestamps. Maximum context is 1024 UTF-8 bytes; oversized input
fails explicitly and requires a reviewed verse/context window. This version is
not an unlimited-length lyric language model.

Whole-vocal context is a 16-bin trajectory of 80 Mel channels and 8 measured
acoustic cues. It is not a labeled beat grid, explicit fundamental-frequency
track, score understanding or instrumental arrangement model. Local inputs retain
210ms Mel and 610ms measured acoustic windows. Sequences default to 4 frames
(160ms at 25fps); GRU state resets between windows. Longer sequences (2..32 frames)
are supported by the dataset/model. Long-range performance continuity is not yet
validated.

Losses supervise generated face pixels/edges, 38 observed surface-motion
coefficients, 478 detector surface coordinates, true temporal changes, optional
human-reviewed contextual affect, and optional verified Korean consonant/vowel
labels. Missing labels contribute zero loss and never become fabricated targets.
Masked UTF-8 reconstruction is auxiliary self-supervision, not evidence of word
meaning. Optional contextual targets have four coordinates: portrayed valence,
arousal, tension, warmth, each in [-1,1]. They are annotations, not a medical or
psychological measurement.

Semantic coefficient corrections use the existing expression indices; they do
not directly overwrite jaw opening, mouth closure/funnel/pucker or other protected
articulation coefficients. This preserves the coefficient pathway, not a guarantee
that every rendered phoneme remains correct. Pixel/geometry errors still require
independent lip-sync evaluation.

## Geometry limits

Jaw rotation uses a surface-derived hinge proxy, not measured bone joints.
The learned 24-component skin basis is not an identified anatomical muscle set.
The .35-radian and .04-crop displacement bounds are modeling hyperparameters,
not physiological constants. Coordinates come from a monocular face detector,
not CT/MRI or true millimetres. Geometry changes feed the final pixels through a
smooth projected sampling field; the renderer is a learned 96x96 inpainting model.
Non-dynamic reference pixels are copied and are excluded from dynamic-ROI claims.

## Prepared input

Existing `prepare_manifest(..., save_acoustic_cues=True)` and
`annotate_face_surface_dataset(...)` produce the audio/video pairs. Each clip
also needs `lyrics-context-v16.json`:

```json
{
  "schemaVersion": 1,
  "text": "앞뒤 문맥을 포함하는 실제 가사",
  "vocalSha256": "exact-64-character-lowercase-source-WAV-sha256",
  "timeBase": "vocal_file_seconds",
  "durationSeconds": 12.0,
  "transcriptSource": "human_reviewed",
  "source": "annotation record / provenance",
  "alignmentMethod": "human_reviewed_word_intervals",
  "words": [],
  "expressionIntervals": []
}
```

The SHA placeholder above is explanatory and intentionally rejected as data.
A word record specifies `text`, Unicode-character `charStart`/`charEnd`, and
`startSeconds`/`endSeconds`. Its text must exactly equal the source substring.
For optional expression intervals, set `expressionSource` to
`human_reviewed_context` and include records with `startSeconds`, `endSeconds`,
`values` (four numbers). With no reviewed timings/affect, leave lists empty.
Do not label corpus performance emotions as lyric meanings.

```bash
python -m song_vision.contextual_training_v16 \
  --dataset /private/prepared --checkpoint /private/new-context-v16.pt \
  --epochs 2 --batch-size 2 \
  --motion-checkpoint /private/previous-v13.pt \
  --word-checkpoint /private/word-feelings-v15.pt
python -m unittest song_vision.test_contextual_face_v16 -v
```

`load_contextual` restores the checkpoint; `forward_batch` returns actual full-face
frames, motion, surface points, jaw proxy, learned surface activations, portrayed
affect and phone logits. `audit_contextual` writes a private three-panel video
and verifies that its decoded audio equals the exact corresponding source PCM
samples. All targets stay outside inference inputs.

## Evaluation and honest outcomes

Evaluation compares heldout generated frames with: static reference copy,
lyrics disabled, source audio shifted 320ms, and genuinely different transcripts.
The wrong-transcript comparison disables word intervals on **both** sides to
isolate context. A split with only one distinct text returns null instead of
calling identical text a negative. Output sensitivity is distinct from correctness.
Performer or original-audio overlap blocks training. Lyric overlap is reported;
it prevents interpreting actor holdout as unseen-meaning validation.

The real pilot first trains the existing v15 Korean lexical ratings module
then trains its contextual encoder on 5,000 genuine Korean movie-review sentences
with 800 distinct official-split holdout sentences (existing v15 NSMC trainer),
and warm-starts the resulting encoder into the integrated v16 model, keeping those lexical
weights frozen while the contextual/pixel connection learns. Korean word ratings
are not sung-word emotional-expression labels; their separate heldout accuracy
and baseline are reported. Source rights remain research-only/unverified for
commercial reuse.

The real pilot uses 16 training + 8 heldout-actor RAVDESS videos: happy/sad,
normal/strong, two statements, first repetition, actors 01/02 train, 03 holdout.
There are only TWO neutral source statements. They test integration of real
sound/video/text, not broad semantic understanding or Korean singing. They have
no reviewed word alignments or meaning targets. This dataset cannot establish
that the model understands a new wedding song. Raw recordings and comparison
videos remain temporary/private; only encrypted model states and aggregate
metrics are archived in the existing owner vault branch.

Prior v14 real experiment (run 42335262425) finished successfully as an execution,
but quality failed the static-copy baseline: dynamic ROI MAE 0.074321 versus
0.0532552 for reference copy. Correct audio beat shifted audio (0.0759394), which
shows timing sensitivity, not faithful visual reconstruction. The v16 architecture
must be judged by its own completed metrics, not by version number or CI success.

## Primary research references and what they support

- Livingstone & Russo, 2018-05-16. RAVDESS. https://doi.org/10.1371/journal.pone.0196391 . Actual audio/video performance labels and two neutral statements. Not a diverse lyric-meaning corpus.
- Daněček et al., SIGGRAPH Asia 2023. EMOTE: Emotional Speech-Driven Animation with Content-Emotion Disentanglement. https://arxiv.org/abs/2306.08990 . Supports separating speech content and emotional expression. Does not validate this v16 model or confer learned lyric understanding.
- Peng et al., ICCV 2023. EmoTalk. https://openaccess.thecvf.com/content/ICCV2023/html/Peng_EmoTalk_Speech-Driven_Emotional_Disentanglement_for_3D_Face_Animation_ICCV_2023_paper.html . Research on disentangling acoustic content and emotional expression.
- Li et al., SIGGRAPH Asia 2017. Learning a model of facial shape and expression from 4D scans (FLAME). https://doi.org/10.1145/3130800.3130813 . Articulated jaw/eyes plus learned surface expressions are a useful precedent. This implementation does not load FLAME or claim its anatomical/scan fidelity.

The architecture choices, sequence sizes, priors and loss weights here are
engineering hypotheses. No cited paper proves that these exact settings solve
semantic singing expression. Semantic generalization, physical muscle estimation,
photorealism and commercial use remain unvalidated in checkpoint/report metadata.

Existing v15 word/rig code added concurrently on this branch was preserved.
The integrated temporal/pixel extension is versioned v16 to distinguish it.

NSMC positive/negative movie-review accuracy is not lyric-emotion or face-expression accuracy.
The original source rights are marked unverified for commercial reuse in the combined archive.

## Verified execution record

Implementation commit: `322f2f35b96c0af3ae17e2228f37fe077dcb4cc2`.

- Local complete Python suite: **102 tests passed** after incorporating the branch's existing Korean-context fixture correction.
- Local Node suite: **159 tests passed**; `npm run check` passed.
- GitHub Python CI: https://github.com/tlco1003/Song/actions/runs/42342803034 — success.
- GitHub Node CI: https://github.com/tlco1003/Song/actions/runs/42342803037 — success.
- Additional synthetic integration probe: 24 heldout comparison frames with genuinely different lyrics; combined-source checkpoint encryption passed.
- Generated-pixel gradients reached the existing v15 word GRU as well as the v16 contextual encoder, surface rig and image renderer. This proves the modules are computationally connected, not that their expression predictions are accurate.
- Same-source audio audit test passed with a nonzero 640-sample source offset; exact corresponding PCM samples, not merely a matching filename, were checked.

The existing separate Korean-context experiment finished successfully:
https://github.com/tlco1003/Song/actions/runs/42342733947 . It trained on
5,000 genuine sentences and evaluated 800 distinct official-split holdout
sentences. Best movie-review polarity accuracy was **0.6625**, against a
balanced-class baseline of **0.5**. Word-only pretraining used 347 rated training
words; its heldout normalized valence/arousal MAE was **0.178696**, against the
constant-mean baseline **0.190078**. These are results of that separate v15 run,
not results of the integrated v16 face experiment, and not song-emotion accuracy.

Integrated v16 actual-source experiment completed **successfully as an execution**:
https://github.com/tlco1003/Song/actions/runs/42342803065 . The encrypted
checkpoint and aggregate manifest were confirmed present on the owner vault
branch. See `docs/SONG_VISION_V16_REAL_RESULT_20261107.json` for the exact
aggregate results. The source media and private comparison video were not published.

### Completed integrated v16 experiment: quality verdict

| Evaluation | Actual result | Interpretation |
|---|---:|---|
| Korean review polarity, 5,000 train / 800 holdout | 0.65875 vs 0.5 baseline | Some learned review-context signal; not song-emotion accuracy |
| Korean word ratings, 347 train / 87 holdout | MAE 0.176470 vs mean baseline 0.190078 | Modest improvement on normative word ratings |
| Heldout face dynamic-ROI MAE, 576 frames | 0.0979977 vs static-copy 0.0659589 | FAIL: generated pixels worse than static reference |
| Without lyrics, same heldout faces | MAE 0.1034964 | Lyrics-present path performs better than removing text |
| Wrong distinct lyrics advantage test | gain -0.0000035 | FAIL: correct text is not better than different text |
| Source audio shifted 320ms | MAE 0.0978004 | FAIL: correct timing is not better than shifted audio |
| Eyes/brows / cheeks / mouth ROI MAE | 0.0795262 / 0.0989546 / 0.1120759 | Raw region errors; no naturalness claim |
| Private paired same-audio video | 72 frames, 46,080 PCM samples identical | PASS: time-aligned original sound preserved; not lip-sync quality proof |
| Model preservation | encrypted file SHA256 c6cc2571dac5e4d1f071be22d501ed9be0038346a143afbb7b34a8c086630a80 | PASS: archived independently of older models |

**Implementation, training, audiovisual audit and archival completed. Face quality,
correct lyric-meaning-to-expression correspondence and lip-sync accuracy did not
pass.** A no-text ablation gain cannot establish correct semantic interpretation:
the wrong-text control does not improve in the correct direction. Two English
source statements overlap between train and validation, and reviewed contextual
meaning targets and Korean singing phone targets are absent. There are zero
human-reviewed contextual-affect frames in this real face study. The classifier's
Korean review accuracy must not be presented as facial-expression accuracy.

The model remains a 96px research renderer with four-frame state windows, a
projected jaw/surface prior rather than measured anatomy, and no commercial or
photorealistic quality approval. The next scientifically meaningful improvement
requires diverse synchronized Korean sung lyrics, reviewed word timing and
contextual performance labels; merely increasing epochs on these two statements
would not establish meaning generalization. The pipeline already accepts those
annotations without replacing missing labels with invented ones.
