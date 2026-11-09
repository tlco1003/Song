# SONG-Vision v36 — 3D tongue → oral acoustic space → actual speech mismatch

## Actual changes

This implements a **working executable relationship** between stylized 3D articulator geometry (`v35`) and a simplified one-dimensional vocal-tract sound resonator (`v36`). On each time sample:

1. The pre-existing **XYZ tongue surface** (tip/blade/body/dorsum/root) and palate are sampled across the tract to estimate available oral airway cross-sectional area.
2. Jaw opening increases anterior cavity space. Separate lip width/opening/protrusion constrains the terminal oral area and adds a protrusion-dependent tract-length correction.
3. Alveolar/post-alveolar/velar closure applies localized narrowing; bilabial stops close the lip exit. Nasal/velum opening and glottal/aspiration/tense *controls* are kept distinct. **Actual nasal-branch transfer, voiced/voiceless consonant source noise, and VOT/F0 prediction are NOT implemented.**
4. A lossy serial-tube transfer matrix estimates resonance candidates. This is not full 3D acoustics, nor an MRI-calibrated human articulator.
5. **Synthetic forward learning executed:** 517 stylized articulator vectors (9 input controls) with synthetic tube frequencies as labels, 413 training / 104 held-out. A small gradient-boosting regressor predicts the toy simulator's F1/F2 in the held-out synthetic data. This is **not learning the owner's hidden tongue**.
6. **Actual owner recording checked:** First ten user-reported vowels from the source MP4 were weakly aligned by voice activity detection and 16 kHz LPC. The original voice and face are used on the 3D diagnostic video. Labels remain unverified by ASR/human timestamps.
7. **Reverse crosscheck:** Real F1/F2 candidates were compared with eight monophthong end-state tube prototypes. Just **2/9 eligible** weakly ordered targets matched the first-ranked candidate; this is a **model mismatch diagnostic**, not blind vowel recognition accuracy. `ㅜ` did not yield reliable F2 and is excluded.

## Key numeric caveat

The actual `이` sample gave tentative LPC F2 ~2733 Hz while the stylized v35 3D tube predicts F2 ~1560 Hz. Since the actual audio LCP formants are estimates and the tube has no human airway calibration, **this discrepancy demonstrates that the model is not yet accurate enough to drive realistic talking/singing**.  Do NOT feed this synthetic tongue pose into the owner animation as ground truth.

## Scientific basis (primary sources)

1. Story, B. H., Titze, I. R., & Hoffman, E. A. (1996). *Vocal tract area functions from magnetic resonance imaging*, JASA 100(1):537–554. DOI **10.1121/1.415960**. https://pubmed.ncbi.nlm.nih.gov/8675847/ . Measured 3D airway space is converted to section-area functions and compared to recorded speech. **Their MRI data/parameters were NOT imported as personal Korean female coordinates**.
2. Story, Titze & Hoffman (1998). *Vocal tract area functions for an adult female speaker based on volumetric imaging*, JASA 104(1):471–487. DOI **10.1121/1.423298**. https://pubmed.ncbi.nlm.nih.gov/9670539/ . Female-specific vocal tract areas; not universal voice geometry.
3. Maeda (1991), *On articulatory and acoustic variabilities*, Journal of Phonetics 19(3–4), 321–331. DOI **10.1016/S0095-4470(19)30348-1**. https://www.sciencedirect.com/science/article/pii/S0095447019303481 . Jaw and tongue can compensate acoustically; inverse tongue location is **non-unique**.
4. 안미진 (2019). *Effects of F0 and VOT on the Identification of Korean Word-Initial Oral and Nasal Stops*, 언어과학연구 (90),203–218. DOI **10.21296/jls.2019.9.90.203**. https://www.kci.go.kr/kciportal/landing/article.kci?arti_id=ART002512535 . Korean stops depend on laryngeal/acoustic parameters beyond visible lip motion.
5. *Voice quality distinctions of the three-way stop contrast under prosodic strengthening in Korean* (2024), DOI **10.13064/ksss.2024.16.1.017** https://doi.org/10.13064/ksss.2024.16.1.017 . Distinguishes lax, aspirated and fortis stops with voice quality measures; no claim user parameters were learned.
6. Anderson et al. (2015). *A comprehensive 3D biomechanically-driven vocal tract model including inverse dynamics for speech research*, Interspeech. DOI **10.21437/Interspeech.2015-518**. https://www.isca-archive.org/interspeech_2015/anderson15_interspeech.html . Research on biomechanical upper airway; this version still uses a separate stylized 3D mesh, **not** their FEM and not patient-specific reconstruction.

## Files and repro

- `owner_v36_acoustic_articulation.py`: 3D palate/tongue → 1D cross sectional areas → acoustic resonance and onset signatures.
- `owner_v36_audio_inverse.py`: real owner audio VAD + LPC candidate formants; **private file paths**.
- `reverse_crosscheck_v36.py`: compare unverified voice formants with toy synthetic vowel templates; never print 2/9 as measured ASR accuracy.
- `train_articulator_to_sound_v36.py`: train synthetic 9D articulatory-to-two-resonance approximation.
- `synthesize_v36_formant_probes.py`: original neutral synthetic harmonic sound samples; **not human Korean TTS** and not owner voice cloning.
- `render_owner_v36_acoustic_3d.py`: cutaway 3D tongue animation with original user face/audio and acoustic comparison, plus 19-consonant contact visualization.
- `test_owner_v36_acoustic.py`: acoustic/phonological contract verification.
- `results/SONG_V36_PUBLIC_VALIDATION_REPORT.json`: machine-readable model readiness and missing science.

For offline private reproduction with the authorized source:

```bash
ffmpeg -y -i '/private/Pronunciation .mp4' -vn -ac 1 -ar 16000 -c:a pcm_s16le results/pronunciation_16k.wav
python owner_v36_audio_inverse.py results/pronunciation_16k.wav results
python reverse_crosscheck_v36.py
python train_articulator_to_sound_v36.py
python synthesize_v36_formant_probes.py
python render_owner_v36_acoustic_3d.py --owner-video '/private/Pronunciation .mp4' --output results
python -m unittest discover -s . -p 'test_owner_v36_acoustic.py' -v
```

The tools need `owner_v35_articulatory_3d.py` and `render_owner_v35_3d.py` available beside them (GitHub path `song_vision/`), plus numpy, scipy, sklearn, OpenCV, PIL, soundfile, trimesh, FFmpeg.

## Strict separation of stages

- **Observed:** original user audio & video and the audio's tentative spectral peaks.
- **Simulated:** v35 general stylized tongue, palate, jaw, teeth, lips in 3D; v36 oral area acoustics and neutral harmonic sound.
- **Learned:** 9D control → synthetic acoustic output from simulator, not phoneme-labeled owner tongue data.
- **Missing:** owner-specific tongue MRI / ultrasound, 3D bone/teeth registration, nasal acoustic branch and glottal excitation, precise phonetic transcription and time-aligned audio-visual validation. A real personal 3D model must be proven against these data before use in commercial singing animation.
