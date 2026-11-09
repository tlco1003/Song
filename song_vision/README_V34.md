# SONG-Vision v34 — Cross-modal reverse pronunciation probe

## What this implementation does

An **experimental Korean vowel-only classifier**, not an automatic speech transcription service. It separates two pathways:

- **Audio-only:** waveform -> log-mel spectral envelopes / MFCCs -> vowel candidate.
- **Video-only:** v33 synchronized mouth-region color/contrast proxy measurements -> vowel candidate.

The two outputs are **independent modality models** (they share only weak, user-declared teaching labels), and are compared on a **held-out set of entire speaking groups**. Results are not verified Korean recognition accuracies because the labels come from the owner-declared `ㅏㅑㅓㅕㅗㅛㅜㅠㅡㅣ` group order, not an independent native Korean ASR or human-confirmed interval-level transcripts. The two models may share systematic label biases.

## Actual run

Input: `pronunciation_25mb.mp4`, 195.584 seconds, 169 VAD event candidates from SONG v33. Of 18 groups, eight had exactly 10 event candidates and were **provisionally** associated with the owner's reported 10-vowel order. Groups not having exactly 10 events were excluded from supervised phoneme training. This is heuristic filtering; 10 events do not establish the corresponding syllables.

Train: six full 10-event groups (60 weak-labelled samples). Heldout: 2 other 10-event groups (group 11 and 13, 20 samples). No samples from these groups were used to fit the models.

| Held-out comparison | Count | Rate |
|---|---:|---:|
| Audio candidate equals assumed position vowel | 17 / 20 | 85% |
| Silent video candidate equals assumed position vowel | 10 / 20 | 50% |
| Audio and video predict the same vowel | 9 / 20 | 45% |
| Both match assumed position vowel | 9 / 20 | 45% |

**These are weak-sequence-consistency rates, NOT validated pronunciation recognition accuracies.**

Confusion on the heldout groups: one or more predicted `ㅑ` as `ㅏ`; some `ㅛ` were classified as `ㅕ`.  Note `ㅇ` and 13 consonant rows are **not independently recognized**. No attempt is made to assert a complete heard transcript.

## To run on private inputs

```bash
python reverse_pronunciation_v34.py --wav /private/audio_16k.wav --segments /private/V33_AUDIO_SEGMENT_REVIEW.csv --outdir /private/v34-results
python -m unittest -v test_reverse_pronunciation_v34.py
```

Audio/video privacy: do not commit original speaking recordings, raw mouth patches, voice prints, or per-utterance timings to the public repository. Preserve these only in the owner's private repository or local workspace.

## Next stage before deployment

1. Human-audited syllable transcripts with time spans including repeated/split segments.
2. Independent Korean phoneme or CTC/ASR teacher for consonant and vowel candidates; do not invent any recognition output if unavailable.
3. Landmark/inner lip boundary masks independently assessed instead of brightness/color proxies.
4. Dedicated consonant-onset and coda classifiers; Korean coarticulation/phonological rules.
5. Held-out source videos, speakers, and genuinely verified labels; evaluate confusion matrices and synchronized timing.
6. Only after these gates: conditioning the face video generator on predicted phone strings and calibrated mouth/jaw/skin motion.
