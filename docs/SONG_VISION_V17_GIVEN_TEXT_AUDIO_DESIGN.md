# SONG-Vision v17 — given lyrics, vocal timing/dynamics and contextual expression

User-directed input contract, 2026-11-07:

**Given lyrics + original vocal track + reference face → lyric/audio alignment → timed articulation conditioned on measured vocal dynamics → contextual expression → projected surface / generated face frames.**

The user supplies the text. The alignment task locates this known sequence in the
recording; it does not need to invent or freely transcribe the lyrics first.
A vocal stem is the intended acoustic input. Dynamics measured on a full musical
mix include accompaniment and must not be described as isolated singing strength.

## Separate responsibilities with shared time

| Path | Input | Learned responsibility |
|---|---|---|
| Known-text alignment | Given lyric units + original vocal features | Locate unit boundaries/durations on the source vocal clock |
| Timed articulation | Current unit, previous/next temporal context, duration/progress | Lip closure/opening, rounding, spread and jaw/surface changes |
| Dynamics | Relative recording level, attack/release slope, onset/brightness/flatness | Learn how dynamics modify a given articulation; no universal loudness-to-mouth multiplier |
| Contextual meaning | Word features + surrounding lyric text + audio context | Learn portrayed intent/expression; no word-to-fixed-face dictionary |
| Composition | Timed articulation + contextual expression + reference surface | Render full dynamic facial regions while preserving shared timestamps |

The existing v16 context path remains active. Its current-word attention can now
use the predicted word index from the known-text alignment. Text mismatches between
that plan and the context encoder are rejected. Predicted timings remain predicted
inputs; they are not promoted to reviewed phoneme/emotion targets.

## Implemented files

- `song_vision/text_audio_plan_v17.py`
  - Given-text Hangul spelling-unit decomposition retaining word identity.
  - Self-trainable acoustic CTC head, supervised with vocal/transcript pairs.
  - CTC-constrained Viterbi alignment with blank states and repeated-unit handling.
  - Variable durations, so a sustained vowel can occupy more frames than a consonant.
  - Confidence rejection, bounded alignment memory, explicit source-time offsets.
  - Original-vocal feature extraction, training/checkpoint save/load and inference plan.
- `song_vision/text_timed_face_v17.py`
  - Timed unit embedding and dynamics encoder with a temporal GRU.
  - Predicted current word connected to existing contextual text attention.
  - Learned motion, projected surface and texture corrections reach actual face pixels.
  - `freeze_base_for_timing_training()` supports fitting the added branch while preserving the existing base parameters.
  - Uses existing supervised face-pixel, geometry and temporal-change losses.
- `song_vision/test_text_audio_v17.py`
  - Synthetic verification of timing, repeated units, sustained vowels, source offsets,
    confidence/mismatch rejection, CTC gradients and actual generated-pixel gradients.

## Important target distinction

Hangul decomposition is **orthographic**, not an exact pronunciation model.
Assimilation, liaison, unreleased final consonants, silent onset ㅇ and singing
pronunciation variants cannot be claimed correct merely by decomposing spelling.
The sequence type retains its provenance. A reviewed pronunciation or a validated
G2P mapping can supply a `LyricUnits` sequence instead. The acoustic head's current
vocabulary covers the declared Hangul units; unsupported non-Hangul text fails
explicitly rather than silently disappearing.

A CTC blank means no emitted textual unit at that acoustic frame. It is not
proof of silence or a command to freeze the face. The existing audio/context
model remains active during such frames.

Relative dBFS level is an observation of the recording, not a calibrated measure
of vocal effort, internal muscle force, emotion or sound pressure at the singer.
The confidence threshold and correction scales are engineering parameters,
not experimentally proven physiological constants.

## Training sequence

1. Fit the acoustic alignment head on genuine vocal/given-text pairs. Word timing
   is latent during CTC training. Independently reviewed boundaries are needed
   to evaluate the resulting timing accuracy.
2. Fit timed articulation/dynamics against synchronized real face movements.
   Compare the same unit at different observed levels and durations. The model
   must learn closure, rounding and opening from examples rather than forcing
   all strong sounds to share one mouth shape.
3. Train contextual expression with genuine sentence/lyric context and paired
   visible performance or reviewed expressive-intent targets. Korean review
   polarity remains auxiliary language pretraining, not sung-expression truth.
4. Tune the combined model with source-audio/face synchronization, true temporal
   changes, regional face errors and independent heldout performers/lyrics.

The new alignment training function saves separate weights and refuses to
overwrite previous checkpoints. It reports training loss and explicitly leaves
word/phone timing accuracy unvalidated without an independent timing set.
It does not claim success based on training loss alone.

## Callable interfaces

```python
from pathlib import Path
from song_vision.text_audio_plan_v17 import (
    train_given_text_aligner, plan_given_text_vocal,
)
from song_vision.contextual_training_v16 import load_contextual
from song_vision.text_timed_face_v17 import TextTimedSingingFaceNet

# Genuine recording/transcript pairs; this trains a new alignment model.
report = train_given_text_aligner(
    [(Path('/private/vocal-verse.wav'), '실제로 부른 가사')],
    Path('/private/new-alignment-v17.pt'),
    epochs=2,
)

# video_seconds is the actual source vocal clock for the requested face frames.
plan = plan_given_text_vocal(
    Path('/private/vocal-verse.wav'),
    '실제로 부른 가사',
    video_seconds,
    Path('/private/new-alignment-v17.pt'),
)

# base_batch is a v16 batch prepared from this same vocal/reference/context.
base, _ = load_contextual(Path('/private/context-v16.pt'))
model = TextTimedSingingFaceNet(base)
model.freeze_base_for_timing_training()
timing = {
    key: plan[key].unsqueeze(0)
    for key in ('unitIds', 'wordIndices', 'prosody', 'confidence')
}
timing['lyricsText'] = plan['lyricsText']
output = model(base_batch, timing)
```

`video_seconds` and `base_batch` above are application-provided frame times and
prepared inputs, not fabricated examples of validated real timings. The added
face branch is newly initialized and must be trained before quality inference.
The example is the training/integration contract, not a claim that two epochs
or one source clip are sufficient.

## Verification criteria

- Alignment: word/unit boundary error and confidence calibration against reviewed
  source timing; no equal-length word division.
- Articulation: lip closure, rounding/opening and temporal motion against real
  frames, stratified by unit, duration and measured vocal dynamics.
- Meaning: same word in different contexts, correct vs different lyrics, and
  heldout whole songs/performers. Different output alone is not understanding.
- Combined output: correct audio vs time-shifted audio, correct lyrics vs wrong
  lyrics, static-copy baseline, eyes/cheeks/mouth errors and human video review.

No new real-song accuracy result is claimed for v17. The v16 real experiment's
failed static-copy/audio/lyric controls remain valid historical findings. This
change makes the supplied-text timing and dynamics contract explicit in executable
code; it does not erase the need for diverse paired singing/meaning data.

## Primary research informing the design

- Ayllón et al., Interspeech 2019, *A Strategy for Improved Phone-Level
  Lyrics-to-Audio Alignment for Speech-to-Singing Synthesis*.
  https://www.isca-archive.org/interspeech_2019/ayllon19b_interspeech.html
  Supports treating known lyrics/audio alignment as a dedicated singing task.
  This implementation uses its own trainable CTC architecture, not their HMM
  implementation, and does not claim their performance.
- Daněček et al., SIGGRAPH Asia 2023, *EMOTE: Emotional Speech-Driven Animation
  with Content-Emotion Disentanglement*. https://arxiv.org/abs/2306.08990
  Supports separating speech-content and emotional-expression control. It does
  not prove that this new model understands lyrics or generates accurate singing.

## Verification for this change

Local complete Python suite: **108 executions passed**. Node suite: **159 passed**.
The six new synthetic tests cover given Korean text/word identity, repeated-unit
CTC and sustained-duration timing, nonzero source-time offsets, confidence and
text-mismatch rejection, alignment training/save/reload, and gradients from timed
unit/dynamics inputs to generated pixels. These tests establish the implemented
contract and computational learning paths, not real singing accuracy.
