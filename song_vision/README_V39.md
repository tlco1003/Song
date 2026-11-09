# SONG AI v39 — single, auditable train → phone align → owner AV infer → 3D rig → MP4 → QA pipeline

This is real executable Python source layered over **existing** `owner_v37_train_real_av.py`, `owner_v37_runtime_3d.py`, `owner_v35_articulatory_3d.py`, and `render_nara_v38.py` in `tlco1003/Song/song_vision`. It **does not** mean the private Nara recording has successfully generated an MP4: the private GitHub Actions runner previously failed before executing steps. All user voice/photo/checkpoint data stay in an authorized private workspace.

## Stage contract and actual operations

1. `TRAIN` — when `--train-video` is supplied, invoke real v37 video/audio training on consented speaking footage, store private `OWNER_V37_AV_MODEL_PRIVATE.npz`, `OWNER_V37_RIG_MAPPING.json`, `OWNER_V37_TRAINING_REPORT.json`; verify the training report says real audiovisual training was performed. When omitted, load the *actual* previously trained v37 checkpoint and mapping; reject missing files and invented dummy models. **Training v37 does not learn hidden person-specific 3D tongue or bone angles.**
2. `ALIGN` — read reviewed phone boundaries `--reviewed-phones` or run/consume a genuine [Montreal Forced Aligner](https://montreal-forced-aligner.readthedocs.io/en/v3.4.0/user_guide/index.html) Korean model `.json` (`--run-mfa` with an isolated vocal stem or `--mfa-json`). MFA provides **candidate** phone timestamps from actual recorded acoustics. Preserve original IPA phone labels, word boundaries, source provenance, exact normalized lyric SHA256, and inferred candidates. Reject overlapping/out-of-bounds phones, different lyrics, missing vowel nuclei and multi-singer ambiguity. Korean sung-vocal alignment is out of the standard read-speech model's training domain. Only **explicit human-reviewed** phone timestamps may become trusted training labels.
3. `PREDICT` — the original v38 renderer calls `LearnedOwnerArticulator.predict_rig` with the **real song audio** for every frame; this drives visible lip width/opening and a calibrated **2D-to-3D jaw control proxy**, NOT medically measured jaw angles.
4. `3D` — pass each active phone's timestamp/slot to the actual v35 3D rig. `ㄴ` elevates tongue tip, `ㄱ` raises dorsum, `ㅁ/ㅂ/ㅍ` seals lips, `ㅁ/ㄴ/ㅇ` opens the nasal port in applicable positions. Vowels transition with independent tongue tip/blade/body/dorsum/root and lip protrusion. The upper jaw remains fixed while the mandible rotates. Hard-palate penetration guards are run in v38 per frame. In unknown/unverified phonetic states **do not hallucinate an observed tongue position**. Real FEM muscle force / personal 3D MRI are missing.
5. `RENDER` — v38 `Visible3DFaceRenderer` outputs actual MP4 frames from the owner's authorized still portrait and the learned controls, with source song audio combined by FFmpeg. Source audio, actual private weights and picture are mandatory (no fixture fallback outside tests). A renderer control trace is saved for independent QA.
6. `VERIFY` — `song_v39_validator` runs ffprobe for audio+video/H264, duration, size, FPS, expected frame count and a visible mouth-region temporal-change check. It reports upper-face/background motion proxies. If independent human-reviewed matching lip/jaw **normalized control** annotations are supplied, it computes external MAE against generated controls. **Without independent annotations, true lip-sync and jaw/tongue accuracy are explicitly `not_measured`; comparing an audio-driven generator to its own soundtrack cannot prove fidelity.**
7. `AUDIT` — save `SONG_V39_RUN_MANIFEST.json`, `*.validation.json`, `*.controls.json`, `*.qa.json`, plus `SONG_V39_FAILURE.json` on failure. A real output is not considered production-quality without human phoneme review and matched independently assessed visual behavior.

## Production-style commands (private environment)

### Research-only 8 s preview on original Nara song, using existing v37 weights

```bash
python song_vision/song_v39_pipeline.py \
  --lyrics 'Song-Vision-Private-Data/owner_face/Nara.tex' \
  --audio 'Song-Vision-Private-Data/owner_face/나라는사람.mp3' \
  --portrait 'Song-Vision-Private-Data/owner_face/reference/IMG_0855.jpeg' \
  --weights 'Song-Vision-Private-Data/training/v37/OWNER_V37_AV_MODEL_PRIVATE.npz' \
  --mapping 'Song-Vision-Private-Data/training/v37/OWNER_V37_RIG_MAPPING.json' \
  --training-report 'Song-Vision-Private-Data/training/v37/OWNER_V37_TRAINING_REPORT.json' \
  --preview --start 18 --seconds 8 --fps 24 --width 512 --height 512 \
  --workdir 'Song-Vision-Private-Data/private-output/v39' \
  --output 'Song-Vision-Private-Data/private-output/v39/SONG_V39_NARA_PREVIEW.mp4'
```

This **draft-only** call cannot claim phoneme-aligned lyrics. An actual successful run outputs MP4 and an audit marking the absence of personal 3D tongue ground truth. It is not a quality-approved result.

### Automatic Korean phone alignment candidates

Install MFA 3.x with `korean_mfa` acoustic and dictionary models. Use `--run-mfa --vocals-stem /private/Nara_vocals.wav --preview` and the other flags. It aligns **isolated sung vocals** only if the installed model supports the recording; the results need human review. Or pass genuine MFA JSON with `--mfa-json /private/Nara_MFA.json --preview`.

MFA JSON contains `tiers.words.entries` and `tiers.phones.entries`, each with `[start,end,label]` entries. v39 preserves the measured candidate intervals, accepts one isolated singer, and refuses inconsistent lyrics, syllable counts, or unknown mapping rather than inventing phoneme labels.

### Human-reviewed Korean phoneme alignment

The schema `SONG_AI_PHONE_ALIGNMENT_V39` has the exact Hangul lyrics SHA256 (UTF-8 NFC normalized), `source: human_verified`, `reviewedByHuman: true`, and a `syllables` array with a timed row for **every Hangul syllable**. Every row has a nested `phones` list with `slot: onset | vowel | coda`, `symbol` as Hangul jamo, and `source: human_verified`. This supports pronunciation of surface forms, including Korean phonological changes, rather than silently equating spelling to acoustics.

Numeric example **only** for hypothetical `나라`, not real Nara song timestamps:

```json
{
  "schema": "SONG_AI_PHONE_ALIGNMENT_V39",
  "source": "human_verified",
  "reviewedByHuman": true,
  "lyricsSHA256": "REPLACE_WITH_REAL_SHA256_OF_COMPLETE_NFC_LYRICS",
  "syllables": [
    {"glyph":"나","start":1.0,"end":1.5,"source":"human_verified","phones":[
      {"slot":"onset","symbol":"ㄴ","start":1.0,"end":1.1,"source":"human_verified"},
      {"slot":"vowel","symbol":"ㅏ","start":1.1,"end":1.5,"source":"human_verified"}
    ]},
    {"glyph":"라","start":1.5,"end":2.0,"source":"human_verified","phones":[
      {"slot":"onset","symbol":"ㄹ","start":1.5,"end":1.6,"source":"human_verified"},
      {"slot":"vowel","symbol":"ㅏ","start":1.6,"end":2.0,"source":"human_verified"}
    ]}
  ]
}
```

Run with `--reviewed-phones /private/Nara_verified_phones.json` and **omit** `--preview` only after every phone was independently reviewed. The engine produces MP4 but still requires visual QA, independent performance annotations and person-specific 3D measurements for any commercial accuracy claim.

### Optional owner retraining in the same command

Provide `--train-video /private/Pronunciation.mp4` and omit `--weights`, `--mapping`, `--training-report`. The private run first invokes the real v37 audio+video training model, then enters the alignment, rendering and validation stages. **A different song's phoneme labels must never be used as ground truth on speaking footage without explicit corresponding timestamps.**

## Testing

```bash
python -m pip install numpy scipy scikit-learn opencv-python-headless soundfile
python -m unittest -v test_song_v39_pipeline.py
python -m unittest -v test_render_nara_v38.py
```

v39 CI tests use synthetic WAV/movie fixtures and actual FFmpeg encoded MP4s, never pretend to be `Nara.tex` or owner-specific ML. The production entrypoint loads the original v37 private weights and original v38 face renderer without fixture functions. Private GitHub Actions must successfully run before a claim of real Nara MP4 output.

## Research and validity

- Montreal Forced Aligner 3.x [user guide](https://montreal-forced-aligner.readthedocs.io/en/v3.4.0/user_guide/index.html); [Korean MFA acoustic model v3.0.0](https://mfa-models.readthedocs.io/en/latest/acoustic/Korean/Korean%20MFA%20acoustic%20model%20v3_0_0.html), a 2024 low-noise read-speech model that has **not been validated on this particular sung recording**.
- Story, Titze and Hoffman (1996), *Vocal tract area functions from magnetic resonance imaging*, Journal of the Acoustical Society of America 100, 537–554. DOI [10.1121/1.415960](https://doi.org/10.1121/1.415960).
- Maeda (1991), *On articulatory and acoustic variabilities*, Journal of Phonetics 19, 321–331, DOI [10.1016/S0095-4470(19)30348-1](https://doi.org/10.1016/S0095-4470(19)30348-1).
- Prajwal et al. (2020), *A Lip Sync Expert Is All You Need for Speech to Lip Generation* [original paper](https://cvit.iiit.ac.in/images/Projects/Speech-to-Lip/paper.pdf). LSE-D/LSE-C metrics **are not computed by this repository** without a separately installed, validated evaluator.

Personal 3D tongue/bone truth, realistic muscle-force FEM, and accurate final Nara Korean song lipsync are **not yet demonstrated**. Keep all checkpoint, audio, images, phone alignments, identifiable output video and review annotations private by default.
