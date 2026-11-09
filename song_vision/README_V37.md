# SONG-Vision v37 — actual owner AV learning → 3D jaw/lips controller (experimental)

## What was actually trained

**Input:** owner-authorized `Pronunciation .mp4`, duration 195.583 s, 480×480 pixels, 30 fps, audio included.

A real *source-video/audio-trained* feature model, not a synthetic-only v35/v36 prior:

1. FFmpeg extracts 16kHz mono owner speech. RMS VAD extracts 169 **speech interval candidates** in 18 groups. This is not automatic transcription.
2. For each interval, one time-matched 480×480 source frame is detected/aligned with OpenCV Haar and sampled at the interval midpoint.
3. Six candidate visual channels (dark oral area, inner dark width/height, red-lip width/height, apparent chin shadow edge) are extracted from observed pixels. These are NOT clinically validated anatomic landmarks or true 3D measures.
4. Per-interval audio log-frequency power-band cepstral summaries and dynamics are extracted (35 features). A regularized Ridge is trained for each 2D channel; training uses **128 events**, and **41 heldout events from four whole groups (3,7,11,15)** are reserved for evaluation.
5. A 12D PCA learns 2D mouth appearance variations. A **weakly** supervised 10-vowel audio probe uses groups with ten energy segments. No phone labels were independently verified.
6. The trained real audio→visible controls drive the **existing v35 3D jaw hinge** and visible lip aperture/width in `owner_v37_runtime_3d.py`. A sample `ㅏ` event drives a visibly different jaw angle from `ㅜ`. Its maxilla/upper teeth remain rigid in model space.
7. Unseen/internal tongue posture continues to use explicit **v35 phonetic prior** (tip/blade/body/dorsum/root, consonant contact/velum). It is NOT recovered from the owner's hidden 3D anatomy, ultrasound, EMG or imaging. Inference without a supplied vowel **returns `tonguePose: null`**, never invents a tongue observation.
8. `owner_v37_cli.py` connects model training to secured/local inference. Website GitHub Pages shows a preview only; no private Python model runs client-side. Live commercial deployment remains gated.

## Held-out results, real owner data, same-video groups

| Visual target proxy | Train / heldout events | 2D MAE model | Static mean MAE | Relative error reduction |
|---|---:|---:|---:|---:|
| Dark oral area | 128 / 41 | 0.02097 | 0.02839 | 26.14% |
| Oral dark width | 128 / 41 | 0.09319 | 0.11082 | 15.91% |
| Oral dark height | 128 / 41 | 0.09875 | 0.11529 | 14.35% |
| Candidate visible vermilion width | 128 / 41 | 0.03706 | 0.08921 | 58.45% |
| Candidate visible vermilion height | 128 / 41 | 0.04577 | 0.10359 | 55.82% |
| Candidate chin contour position | 120 / 40 | 0.01151 | 0.01739 | 33.84% |

The 2D mouth-texture PCA's heldout reconstruction MAE was 0.024787 vs static mean 0.044437. These metrics are not Korean speech recognition or generated video realism accuracy. Single-camera, same-person, same-video test does not prove generalization to other singers/lighting.

**Weak ten-vowel probe:** 20 heldout events, only **35% agreement with assumed sequential labels**. Since no independent human/ASR phoneme reference exists, this is *not* phoneme recognition accuracy. Phone-supervised training and automatic lyrics sync must not be enabled based on this.

## Anatomy and sound honesty

- **Actual observed:** source frame pixels, candidate mouth/chin 2D features, owner audio intervals and spectral features.
- **Actually learned:** audio-to-observed-visible 2D mapping, 2D mouth texture basis, and weak sequence classifier.
- **Computationally controlled:** v35 normalized 3D jaw hinge, upper/lower teeth, lip opening/width, 3D tongue, palate, consonant occlusions. Jaw rotation values are video-calibrated *control proxies*, not measured TMJ radians.
- **Not personally learned:** hidden tongue 3D geometry, individual jawbone, muscles, epiglottis, personal palate, 3D acoustic airway area, nasality, validated vowel or consonant timestamps.
- v36 resonance simulator is a **toy forward model** and had large mismatches to owner's audio. Do not fit a hidden tongue as unique truth from LPC F1/F2; the acoustic inverse problem is non-unique (Maeda 1991).

## Scientific reference

- Story, Titze & Hoffman (1996), *Vocal tract area functions from magnetic resonance imaging*, JASA 100:537–554, DOI 10.1121/1.415960. https://pubmed.ncbi.nlm.nih.gov/8675847/
- Story, Titze & Hoffman (1998), *Vocal tract area functions for an adult female speaker*, JASA 104:471–487, DOI 10.1121/1.423298. https://pubmed.ncbi.nlm.nih.gov/9670539/
- Maeda (1991), *On articulatory and acoustic variabilities*, Journal of Phonetics 19:321–331, DOI 10.1016/S0095-4470(19)30348-1.
- Anderson et al (2015), *A comprehensive 3D biomechanically-driven vocal tract model including inverse dynamics*, Interspeech, DOI 10.21437/Interspeech.2015-518.

These sources motivate anatomical constraints but **do not license invented subject-specific tongue/jaw labels**.

## Reproduce locally, not on public GitHub Actions

```bash
python -m pip install numpy scipy scikit-learn opencv-python soundfile Pillow trimesh
python owner_v37_cli.py train --video '/private/Pronunciation .mp4' --output '/private/v37'
python owner_v37_cli.py infer --wav '/private/v37/_owner_audio_local_only.wav' \
  --weights '/private/v37/OWNER_V37_AV_MODEL_PRIVATE.npz' \
  --mapping '/private/v37/OWNER_V37_RIG_MAPPING.json' \
  --start 2.27 --end 2.83 --vowel 'ㅏ' --onset 'ㅇ' \
  --output '/private/v37/rig_aa_preview.json'
python render_owner_v37_training_review.py --video '/private/Pronunciation .mp4' \
  --results '/private/v37' --output '/private/v37/SONG_V37_REAL_OWNER_TRAINED_JAW_AND_3D_TONGUE_REVIEW.mp4'
python -m unittest -v test_owner_v37_training.py
```

Private outputs: `OWNER_V37_AV_MODEL_PRIVATE.npz`, event-level facial feature JSON, 16k waveform, reviewer overlays. Keep in `tlco1003/Song-Vision-Private-Data` or another permissioned store; never commit to `tlco1003/Song`.

## Next objective

Before face-rig can be approved for real singing: verified timestamps for Korean consonant/vowel coarticulation; manually annotated outer/inner lip, jaw and face landmarks; calibrated forward/side head pose; owner-specific 3D reconstruction where possible and scientific uncertainty for invisible tongue; strict heldout comparison of render vs actual owner video. The rig currently runs offline (Python) and exposes a CLI, not a commercial server endpoint or finished generated-facial-video service.
