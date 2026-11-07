# SONG-Vision v14 — real Korean phone labels + full-face generated-video comparison

Date 2026-11-07. Branch `feature/song-vision-self-hosted-v1`. All human face/video/audio experiments are restricted to verified noncommercial source licenses. Paid customer inference remains disabled.

## 1. Verified Korean phone ground truth (separate AUDIO-ONLY pretraining)

Primary dataset **Seoul Corpus**, official OpenSLR SLR113 https://www.openslr.org/113/, license **CC BY-NC 2.0**; publication Yun et al., *The Korean Corpus of Spontaneous Speech*, Phonetics and Speech Sciences (2015), DOI https://doi.org/10.13064/KSSS.2015.7.2.103. Research reports 40 Korean talkers; initial forced-alignment phoneme boundaries were checked and corrected by human researchers. Original TextGrids and original FLAC sound used together.
Unlike previous v13, there is actual published human-corrected Korean phone timing. Its 18 exact code mappings as listed in the publication Table 3: k0=ㄱ,nn=ㄴ,t0=ㄷ,ll=ㄹ,mm=ㅁ,p0=ㅂ,s0=ㅅ,ng=ㅇ,c0=ㅈ,kh=ㅋ,th=ㅌ,ph=ㅍ,hh=ㅎ,aa=ㅏ,ii=ㅣ,uu=ㅜ,ee=ㅔ,oo=ㅗ. **ng is coda [ŋ], not silent syllable-initial orthographic ㅇ.** Unmapped combinations such as ㅐ/ㅊ/ㅋ strong or other variants are explicitly excluded rather than falsely mapped.
Implemented `song_vision/korean_seoul_phones_v14.py`: official HTTPS archive downloads, privacy-preserving extraction, Praat phoneme tier validation, source audio decoding/resampling, actual timed Mel samples, train on two distinct speakers and validate on a third speaker, checkpoint and per-class counts/accuracy. These are **Korean speech**, not singing or videos; no phoneme-to-face association is claimed from this dataset alone.
`song_vision/staged_face_v13.py` now optionally warm-starts its articulation encoder and consonant/vowel classifiers from a trusted, privately restored Seoul phone checkpoint while maintaining v13 mouth/eye/skin branches; singing-video phoneme accuracy still requires aligned singing phoneme annotations.
Seoul phone checkpoint is encrypted to new distinct archive by `song_vision/seoul_research_vault_v14.py`, with **correct Seoul license CC BY-NC 2.0**; do not relabel it as RAVDESS CC BY-NC-SA. A noncommercial CC-BY-NC 2.0 model must not be used to serve paid SONG customers.

## 2. Real whole-face area renderer (experimental 96×96 image output)

`song_vision/full_face_renderer_v14.py` adds original trainable `FullFaceVocalRenderer`. Inputs are 96px reference face, the exact original 80x21 vocal Mel at time t, 8x61 vocal intensity/attack context, 38 visible surface-motion coefficients from v13 and four observed/predicted eye-centre motion proxies. Outputs a full **96×96 image** that learns to inpaint dynamic face regions, including brows/eyes, cheek and zygomatic skin area, nose/lip and chin/jaw while explicitly copying nondynamic reference boundaries.
Reference and target must be frames from **different times** in the same authorized performer video. Every generated frame is supervised with the true same-time video frame, not with imagined landmarks. Pixel loss is measured in dynamic regions only; excluded copied background cannot inflate the model quality score.
The research renderer is **not photorealistic**, not capable of reliable high-resolution 4K/1080p facial texture, does not predict 3D facial muscles/bones, and the existing site paid job route remains disabled.

## 3. Paired same audio audit and counterfactual

`song_vision/paired_face_audit_v14.py` takes original WAV attached to held-out actor video, verifies its SHA256 against preparation index, reconstructs measured audio features and verifies they match the stored feature arrays. It fixes one reference face frame, renders the remaining frames with the **exact original sung vocal at each 25fps timestamp**, and compares them with the real heldout video at the exact same timestamps.
For each real video frame it measures area-normalized MAE: generated face vs ground truth, static reference vs ground truth, and deliberately 320ms shifted vocal vs ground truth, separated mouth/chin, eyes/brows, cheek/zygomatic tissue. **Quality only improves when correct audio beats shifted audio AND the generator beats a static reference**. Small error alone is insufficient.
It generates a **private side-by-side comparison** (original recording vs generated) and `.mkv` with source PCM audio via lossless stream copy, plus an unmodified source WAV sidecar, verifies the audio samples are identical to the source prefix. These identity/voice files are deliberately confined to the temporary CI research directory and **not uploaded to a publicly accessible GitHub repo**. The manifest includes aggregate metrics and checksums, not video frames.

## 4. Genuine external training and weights

`song_vision/external_ravdess_full_face_v14.py` obtains licensed official RAVDESS actor 01/02/03, normal and strong expressive recordings (120 total, actor03 holdout). Trains v13 four face motion stages, then a separate whole-face renderer, then runs the same-original-audio audit on one heldout video. Generates two **new** encrypted checkpoints; old v2–v13 checkpoint hashes remain unchanged. Research vault public key X25519 and AES-GCM are used; owner private decryption key stays outside GitHub.
Workflow `.github/workflows/song-vision-v14-fullface.yml` executes synthetic shape/gradient/real WAV checksum checks before real singer study and securely stores new ciphertext in `research/song-vision-vault/encrypted/ravdess-v14-fullface-original-sound/`.
Workflow `.github/workflows/song-vision-v14-seoul.yml` independently trains actual Korean phone heads from Seoul hand-corrected ground truth, then encrypts separately in `research/song-vision-vault/encrypted/seoul-corpus-v14-korean-speech-phones/`. That public source audio archive is ~2.5 GiB; downloads/training may fail if the provider is unreachable; a successful pipeline needs actual job log and archived checkpoint, not merely a workflow definition.

## 5. Truth-in-validation

Fully working Python unit tests prove computation and synthetic training paths but do not prove actual Korean singing performance. Korean phoneme *speech* generalization is tested on a separate speaker, not on an unseen singer. Full-face singing visual quality and lip/eye/cheek motion must be evaluated separately against untouched heldout singer frames and with genuine same-audio/misaligned-audio comparisons.
Research metrics can produce FAIL. No 'identical singer video' claim unless human-reviewed perceived synchronization, lip/viseme accuracy, image/skin quality, audio integrity, temporal stability and unseen-performer generalization all pass. Paid release prohibited under both data sources and unvalidated research status.
