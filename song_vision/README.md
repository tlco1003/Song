# SONG-Vision v1 — local original singing-mouth model (research prototype)

This repository contains **original trainable PyTorch model code**, not an external
video-generation API. The **model has no trained weights in Git** and cannot
produce a convincing singing video until suitable authorized data have been
prepared, training completed and the resulting quality independently evaluated.

## Architecture

- FFmpeg decodes the **isolated vocal track** locally to mono 16 kHz.
- Pure PyTorch STFT + triangular Mel filterbank produce 80-channel/10-ms features.
- OpenCV detects one mostly frontal face in a **consented singing-video** training clip.
- A 96x96 face is reduced to a 64x64 lower-face mouth region.
- The original \`SingingMouthNet\` uses a 2D image encoder, 1D vocal encoder,
  FiLM-conditioned features and 2D transpose-convolution decoder.
- Training pairs source/reference and target frames from the **same singer**.
- Rendering reuses the stage video frames and only replaces the lower-face ROI.
- FFmpeg merges the final visual result with the original music mix into an MP4.

This is a **research baseline**. It does not implement LivePortrait, MuseTalk,
a full facial foundation model, trained customer-identity transfer, or high-grade
diffusion video generation. There is no facial-recognition identification.

## Local setup (Python 3.11+ and ffmpeg on PATH)

\`\`\`sh
python -m venv .venv
. .venv/bin/activate
pip install -r song_vision/requirements.txt
python -m unittest song_vision.test_engine -v
\`\`\`

### 1. Prepare synchronized and authorized singing footage

Create a **private, operator-verified** consent JSON file for the singer:
\`{"approved": true, "scope": "train_singing", "subjectId": "singer-owner-approved"}\`.
This JSON is only an application gate: the operator must separately verify the
person's actual approval, rights, capture permissions, and retention policy.
Do not commit consent documents or face images to Git.

\`\`\`sh
python -m song_vision prepare \
  --video /private/source_singer_video.mp4 \
  --vocals /private/same_time_isolated_vocals.wav \
  --dataset song_vision/datasets \
  --clip-id consented-singer-001 \
  --seconds 30 \
  --consent-record /private/train-consent.json
\`\`\`

The audio must genuinely correspond to the video, aligned at time zero. If
there is no isolated vocal track, generate it separately or use authorized raw
vocals; instrumental-heavy inputs can degrade results.

### 2. Train original weights from scratch

\`\`\`sh
python -m song_vision train \
  --dataset song_vision/datasets \
  --checkpoint song_vision/checkpoints/singing-v1.pt \
  --epochs 30 --batch-size 16 --learning-rate 0.0003 --device cpu
\`\`\`

For CUDA hardware use \`--device cuda\` with a properly installed GPU-enabled
PyTorch build. **Training on the source video alone does not guarantee general
performance, accurate lip sync, identity stability or visual realism.**
Perform held-out singer/video evaluation before calling it successful.

### 3. Experimental 10-second MP4 inference

\`\`\`sh
python -m song_vision render \
  --template /private/stage_performance.mp4 \
  --vocals /private/song_isolated_vocals.wav \
  --mix /private/final_song.mp3 \
  --checkpoint song_vision/checkpoints/singing-v1.pt \
  --output song_vision/outputs/demo.mp4 \
  --seconds 10 --start 0 --device cpu
\`\`\`

The result writes \`demo.mp4\` and \`demo.quality.json\` locally, with the latter
explicitly marked **research_only_not_commercially_validated**. Output is gated
on at least 60% frontal-face detection, but passing this threshold is not proof
of acceptable lip-sync quality.

### Optional *experimental 2D face image compositor* (NOT neural face-swap)

\`\`\`sh
python -m song_vision render \
  --template /private/stage_performance.mp4 \
  --vocals /private/song_isolated_vocals.wav \
  --mix /private/final_song.mp3 \
  --checkpoint song_vision/checkpoints/singing-v1.pt \
  --output song_vision/outputs/experimental-face.mp4 \
  --seconds 10 \
  --identity-photo /private/authorized-customer-face.png \
  --consent-record /private/face-swap-consent.json
\`\`\`

Consent JSON for this specific path must have \`approved:true\`,
\`scope:"face_swap_prototype"\`, and a nonempty \`subjectId\`.
The operator MUST verify actual consent. **This overlays a static portrait
using OpenCV seamlessClone; it is NOT yet a trained identity-transfer neural
network. It can look visibly artificial and must not be sold as finished
face-swap AI.**

## Connection with existing SONG

\`GET /api/video-ai/readiness\` exposes a read-only engine status. Existing
song choice, server price authority, payment lockout, private music prompts,
delivery protections, and checkout behavior remain unchanged. There is
**no customer upload endpoint, no public generation job endpoint, no automatic
commercial fulfillment, no external inference provider and no secret keys**
in this v1 branch.

A **future**, separately validated self-hosted service may expose authenticated
internal generation jobs after obtaining trained weights, durable queue, media
storage, verified consent, and quantitative plus human quality checks. Until
that point \`canAcceptCustomerJobs=false\`.

## Research background (methods are not copied)

- MuseTalk (2024): https://arxiv.org/abs/2410.10122 — latent mouth inpainting.
- LivePortrait (2024): https://arxiv.org/abs/2407.03168 — identity/motion control.
- Let's Chorus (CVPR 2025): https://openaccess.thecvf.com/content/CVPR2025/html/Xie_Lets_Chorus_Partner-aware_Hybrid_Song-Driven_3D_Head_Animation_CVPR_2025_paper.html — song-driven head animation.

All quality claims about these methods belong to those publications, **not**
to SONG-Vision v1. The current checkpoint must be trained and evaluated on
authorized data before claiming any comparable capability.

## Remaining roadmap

1. Consent-backed multisinger dataset; track alignment and camera-pose labels.
2. Validation split by performer, audio-visual sync metric, identity metrics
   and controlled user scoring; prevent train/test clip leakage.
3. Learnable identity encoder, face motion retargeter, temporal video loss.
4. Production-quality face tracking / landmarks and mouth ROI alignment.
5. Private GPU inference worker, transactional paid job queue and file delivery.
6. Commercial/legal/privacy readiness review before customer sale.
