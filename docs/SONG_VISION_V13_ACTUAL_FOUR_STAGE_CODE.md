# SONG-Vision v13 — Articulation, prosody, emotion, fusion: implemented research code

2026-11-07. Development branch feature/song-vision-self-hosted-v1. Research vault research/song-vision-vault.

## What was actually implemented

1. song_vision/phoneme_targets_v13.py: the 13 Korean consonants ㄱㄴㄷㄹㅁㅂㅅㅇㅈㅋㅌㅍㅎ and the five requested vowels ㅏㅣㅜㅔㅗ; strict human-reviewed phone timestamps verified against original vocal SHA256. Refuses guessed alignments. Unlabelled frames have IGNORE_LABEL=-100.
2. song_vision/staged_face_v13.py: real PyTorch StagedSingingFaceNet with four *trainable*, separately frozen stages: articulation, prosody, emotion and full fusion. Explicit consonant/vowel logits, strength/context residual, eyes/brows/cheeks/perioral expression residual, combined 38D surface movement and 64px masked mouth image.
3. Stage 1 trains lip/mandible-surface proxies plus human-reviewed consonant/vowel CE if and only if annotated. Stage 2 trains measured vocal loudness/attack/sustain/frequency conditioned residual motion with consecutive-frame delta. Stage 3 trains eye/brow/cheek/skin visible movement and RAVDESS portrayed emotion label. Stage 4 unfreezes all modules, jointly trains motion and lip image with shifted-audio counterexample.
4. song_vision/external_ravdess_v13.py: verified 120 official RAVDESS audio/video takes, source MD5, train actors 01+02, independent heldout actor 03. Research checkpoint encrypted for existing owner public key and archived to new Git vault folder.
5. song_vision/test_staged_face_v13.py: synthetic full 4-stage optimization, gradient isolation, original-vocal SHA validation, missing-label reporting, preservation of existing checkpoints.
6. .github/workflows/song-vision-v13.yml: CPU-only research runner, real offline face tracker, 4-stage training, encrypted 90-day artifact backup + persistent encrypted research branch commit.

## Important scientific boundaries

The *output* is face skin movement coefficients + a cropped lip image. No music or sound synthesis. There is no photo-real full-face skin renderer, physical muscle-tension/EMG measurement or eyeball gaze tracker yet.
The 13/5 phoneme classifiers cannot learn exact phone categories from the RAVDESS English singing footage: this source has no verified Korean phoneme timestamps. In this case classification CE is skipped, phoneme accuracy remains null, and the unvalidated diagnostic flag is written. Geometric vocal-to-face motion *is* learned from the synchronized real video.
An optional human-reviewed phone JSON may be placed in each PRIVATE prepared clip folder as phones-reviewed-v13.json. It must have schemaVersion 1, alignmentMethod human_reviewed_phonemes, verified true, verifiedBy, timeBase vocal_file_seconds, vocalSha256 (64 lowercase hex matching index.json sourceVocalsSha256), durationSeconds, and continuous segments with kind rest/consonant/vowel, startSeconds, endSeconds, and symbol for phone rows.
Examples of language-specific speech, coarticulation and emotional interpretation must be externally evaluated: similar visible mouth shapes can correspond to different phonemes, and loud volume does not automatically imply eyes squint or lips opening.
RAVDESS emotion labels describe *acted portrayals*, not internal psychological emotions; only calm/happy/sad/angry/fearful classes are trained from this source. Tenderness, longing, prayerful etc. require new consented reference labels.

## Sources

Livingstone & Russo (2018), RAVDESS, PLOS ONE, https://doi.org/10.1371/journal.pone.0196391
Official RAVDESS Zenodo dataset https://zenodo.org/records/1188976 , CC BY-NC-SA 4.0; commercial SONG customer use prohibited.
Chandrasekaran et al. (2009), The Natural Statistics of Audiovisual Speech, PLOS Computational Biology, https://doi.org/10.1371/journal.pcbi.1000436
Google offline Face Landmarker: https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker

## Release gates

Never overwrite any v2-v12 archive. The v13 output uses a distinct run-numbered .svault file in research/song-vision-vault/encrypted/ravdess-four-stage-v13/. Source media and decryption PRIVATE key never enter GitHub.
Treat face metrics worse than neutral, mouth metrics worse than copied-reference, unknown phone-label accuracy, unproven cross-language synchronization and missing realistic full-face renderer as failures/limitations. Customer video jobs remain disabled.
