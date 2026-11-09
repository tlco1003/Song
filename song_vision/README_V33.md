# SONG Vision v33 — Owner pronunciation audio-video initial training

## Source and provenance
- Training data: user's **Pronunciation** recording (`480×480`, `30 fps`, `195.58 s`).
- Also detected in the private user GitHub repository as `owner_face/training_videos/pronunciation_25mb.mov`. The locally supplied compressed MP4 was analyzed; exact byte identity between private MOV and local MP4 has **not** been established.
- The initial series reported by the owner is `아 야 어 여 오 요 우 유 으 이`.
- Requested sequence in this training batch: 10 bare vowels + 13 initial consonant rows × 10 vowels = **140 intended syllables**. Modern Korean has additional consonants (e.g. ㅊ, tense consonants) and complex/diphthong vowels NOT explicitly spoken or verified in this recording.

## What ran
1. Extracted 16 kHz mono audio from the MP4 with FFmpeg.
2. 10 ms short-time RMS VAD (threshold -40 dBFS) extracted 169 *speech-region candidates* across 18 groups. This is **not ASR**.
3. Joined each candidate to the *same video timestamps*, collecting 3 facial/mouth patch observations per candidate (507 samples).
4. Fitted a 12-component PCA mouth-appearance model on 135 segments; held out 34 segment samples. Reconstruction MAE: 0.0162 normalized units vs 0.0326 for the static mean (50.4% relative reduction). This metric **is not lip-sync/phoneme accuracy**.
5. Trained Ridge regression from acoustic spectral and loudness features to four **proxy** 2D mouth observables (dark opening candidate area, vertical opening candidate, red lip width and height). Held out *whole groups* 3,7,11,15 (41 utterances). Results in `V33_AUDIO_TO_MOUTH_HELDOUT.json`. These proxy targets are not accurate anatomical landmarks.
6. Built two real-source review videos (10 vowels and 18 group representatives) with original sound and visible mouth pixels; no artificial opening is drawn.

## Labeling status
- First 10 syllables were assigned to first 10 detected speech segments according to the owner's described order. This is **weak sequential supervision, not audio transcription verified by an ASR or human time-label review**.
- Subsequent 159 detected intervals have **no assumed phone label**. These include possible retakes/instructions; forcing 140 labels onto 169 uncertain regions would contaminate the training set.
- `V33_HUMAN_AUDIO_LABEL_REVIEW_TEMPLATE.csv` provides unverified fields to manually inspect. Only rows with explicitly checked, positive verified timestamps may be used for *phone-supervised* training in future stages.

## Files
- `train_pronunciation_v33.py`: audio VAD, mouth appearance prior training, 169 review candidates, full 140 syllable script
- `train_audio_to_mouth_v33.py`: acoustics->2D mouth geometry experimental Ridge model and group-heldout evaluation
- `render_pronunciation_v33.py`: original footage review clips
- `test_pronunciation_v33.py`: 5 local tests
- `V33_TRAINING_REPORT.json`: summary and non-claims
- `V33_AUDIO_SEGMENT_REVIEW.csv`: timestamp review entries
- `V33_HUMAN_AUDIO_LABEL_REVIEW_TEMPLATE.csv`: human labels pending
- `OWNER_V33_MOUTH_MOTION_PRIOR_PRIVATE.npz` / `OWNER_V33_AUDIO_TO_MOUTH_PRIOR_PRIVATE.npz`: private training weights

## Run
```bash
python train_pronunciation_v33.py --video /private/pronunciation_25mb.mp4 --output /private/results
python train_audio_to_mouth_v33.py --results /private/results
python -m unittest -v test_pronunciation_v33.py
```

## Acceptance rules (fail-closed)
- no ground-truth syllable recognition accuracy without time-aligned human verified labels;
- no anatomical (inner lip/teeth/jaw-bone) accuracy from color/darkness proxies;
- no true 3D face or vocal-muscle learning from this 2D PCA/Ridge stage;
- do not deploy generated singing lips from this experimental model until verified phone labels and frame-by-frame landmark/cavity quality tests exist;
- keep original video, detailed facial features, and learned private weights in the private dataset, never commit them publicly by default.
