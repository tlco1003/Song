# SONG AI v38 — actual engine-generated MP4 from `Nara.tex` and `나라는사람.mp3`

## Goal and boundary

This is a **single executable inference pipeline**. It directly ingests an authorized owner's exact-text lyrics (`.tex` is treated as UTF-8 plain text), music audio (`.mp3`), still face photo, **actual private v37 owner-trained weights**, and the v35 3D articulatory rig, then renders MP4 using **its own per-frame code**. It does not ship an assistant-made reference movie and call that an AI output.

At each video frame:

1. Decode the original music and read the user's entire exact Hangul text.
2. Select a Hangul syllable, initial consonant, medial vowel and coda **only from an alignment contract**. No automatic lyric transcriptions are claimed.
3. Call **`LearnedOwnerArticulator.predict_rig`** on the real music waveform with the actual v37 private checkpoint. The audio model predicts visible mouth size, lip width and a *jaw angle control proxy*.
4. Use the **v35 3D articulator** (`RigControls`, `consonant_pose`, `tongue_mesh`, `lips_mesh`, `teeth_points`). Compute the hidden tongue's 3D surface and apply the hard-palate contact guard **every frame**, including when the tongue is not visible.
5. Apply jaw-hinge-linked movement to the lower 3D photo-textured face surface while preserving the upper face/background. Draw a projected 3D oral opening, lip ring and upper/lower teeth from the model. The oral interior is **synthetic**, not the individual's clinically measured mouth or a trained photoreal neural renderer.
6. Encode its generated 3D-rigged frames to H.264 MP4 with the actual source MP3 sound and save a provenance and quality-report JSON.

The renderer is **real executable code**, but it is a **research prototype**, not a proven photorealistic model and not a biomechanically accurate personal 3D head. It cannot reconstruct unseen tongue or cranial nerves from a still photo. A pre-existing microphone may occlude the lip region in some chosen photos; the model cannot realistically remove it.

## Input and GitHub locations verified 2026-11-09

- Private lyrics: `tlco1003/Song-Vision-Private-Data/owner_face/Nara.tex`
- Private music: `tlco1003/Song-Vision-Private-Data/owner_face/나라는사람.mp3`
- Private learned weights: `training/v37/OWNER_V37_AV_MODEL_PRIVATE.npz`
- Private jaw mapping: `training/v37/OWNER_V37_RIG_MAPPING.json`
- Actual original model report: `training/v37/OWNER_V37_TRAINING_REPORT.json`
- Private user reference image: `owner_face/reference/IMG_0855.jpeg` (frontality and visibility must still be verified on the actual source)
- Public SONG source: `tlco1003/Song/song_vision/`

### Run only in an authorized private workspace

```bash
python -m pip install numpy scipy soundfile scikit-learn opencv-python-headless trimesh
export PYTHONPATH="$PWD/Song/song_vision"
python Song/song_vision/render_nara_v38.py \
  --lyrics 'Song-Vision-Private-Data/owner_face/Nara.tex' \
  --audio 'Song-Vision-Private-Data/owner_face/나라는사람.mp3' \
  --portrait 'Song-Vision-Private-Data/owner_face/reference/IMG_0855.jpeg' \
  --weights 'Song-Vision-Private-Data/training/v37/OWNER_V37_AV_MODEL_PRIVATE.npz' \
  --mapping 'Song-Vision-Private-Data/training/v37/OWNER_V37_RIG_MAPPING.json' \
  --training-report 'Song-Vision-Private-Data/training/v37/OWNER_V37_TRAINING_REPORT.json' \
  --draft-preview --start 18 --seconds 8 --fps 24 --width 512 --height 512 \
  --output 'Song-Vision-Private-Data/private-output/SONG_V38_NARA_OWNER_ENGINE_PREVIEW.mp4'
```

Do **not** omit `--weights` or substitute untrained fake coefficients. Missing actual owner checkpoint, unreadable still photo, invalid face detection or missing verified timing without explicit `--draft-preview` all fail closed.

### Verified timing format required before accuracy claims

The program explicitly distinguishes a user-authorized **draft** and a **human-verified** syllable alignment. Without verified timing, `--draft-preview` only estimates uniform syllable positions across the nominal song span; it is **not forced alignment**, phone recognition, or actual Nara lyric-to-song synchronization.

A verified file must have:

```json
{
  "schema": "SONG_AI_VERIFIED_SYLLABLES_V1",
  "syllables": [
    {"glyph": "어", "start": 12.01, "end": 12.27, "source": "human_verified"},
    {"glyph": "렸", "start": 12.27, "end": 12.56, "source": "human_verified"}
  ]
}
```

The two entries above are **schema examples, not measured timestamps**. The complete file must have one ordered entry for *every* Hangul syllable in the exact `Nara.tex`; do not pass this two-row example for the whole song. The code rejects overlaps, missing entries, incorrect glyphs and inferred times impersonating manually verified labels.

## Training versus inference

- v37's `OWNER_V37_AV_MODEL_PRIVATE.npz` has **already trained on the owner's real speaking audio and corresponding face frames**. v38 **loads and uses these trained weights**; rendering Nara audio does **not automatically retrain the model**.
- Hidden tongue, oral cavity and tooth geometry are v35 **physics-inspired control priors**, not privately learned 3D anatomy.
- This code does not claim real Korean phoneme recognition, facial muscle force modeling, lifelike dentition or subject-specific tongue motion.
- Future supervised phoneme model learning requires *human verified Nara lyric timing + owner audiovisual controls*. No user data is used to silently invent phoneme labels.

## Tests and real run status

`python -m unittest -v song_vision.test_render_nara_v38` runs synthetic **software-interface tests** (all fixtures are explicitly marked not owner models). This validates 3D rig calls, codec output, lyric text preservation, fail-closed timing and missing-weights handling. It does **not** validate real owner checkpoint quality or true MP3-to-lyrics alignment.

Run the private workflow `.github/workflows/render-nara-v38.yml` to run the genuine Nara source through the engine. Its output is a **private Actions artifact**; publishing to a public home page is a separate approval and privacy task. The private repository's GitHub Actions jobs had previously failed before any steps started (seen 2026-11-09), so treat render status as **not executed** until a successful workflow and actual output-file validation are observed.

## Research references and limitations

- Story, Titze & Hoffman (1996), *Vocal tract area functions from magnetic resonance imaging*. JASA 100, 537–554, DOI 10.1121/1.415960.
- Anderson et al. (2015), *A comprehensive 3D biomechanically-driven vocal tract model including inverse dynamics for speech research*. Interspeech, DOI 10.21437/Interspeech.2015-518.
- Maeda (1991), *On articulatory and acoustic variabilities*. Journal of Phonetics 19(3–4), 321–331, DOI 10.1016/S0095-4470(19)30348-1.

None of these papers provide the user's individual 3D tongue or jaw parameters. A static image and an MP3 cannot uniquely determine the hidden tongue's true shape.
