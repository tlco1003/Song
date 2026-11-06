# SONG-Vision Face Geometry + lip-motion preview v3
2026-11-06 · feature/song-vision-self-hosted-v1

## Scope and scientific boundary
- Python module: song_vision/face_geometry.py. Takes image/video into on-device Google MediaPipe Face Landmarker, computes 478 estimated facial surface points, 52 blendshape scores and SONG-defined geometric ratios.
- Identifies eye corners, nose tip, surface chin, upper/lower lip and mouth corners. No actual bone, jaw joint, teeth roots, tongue depth or diagnostic craniofacial measurements can be inferred from a single photo.
- Separate optional OFFLINE pre-trained MediaPipe model is used ONLY as a landmark detector: this pre-trained detector is not SONG-owned training work. The ratios, signal extraction, deformation, processing gates and tests belong to SONG.
- Audio-conditioned geometry preview uses RMS amplitude to make a bounded 2D lip-warp in an already-licensed singer video. It does NOT create phoneme-correct singing mouth shapes and does not synthesize teeth, tongue, or realistic new mouth interiors.
- SONG's existing PyTorch audio-to-mouth network and synchronized-data training pipeline remain separate. Further phoneme/viseme training and identity transfer are not complete.
- No video AI provider API is called. No public uploader or chargeable generation route is enabled.

## Install in an operator's private computer/GPU environment
Python 3.11 and FFmpeg are required. In repo root:

    python -m pip install -r song_vision/requirements-geometry.txt
    python -m unittest discover -s song_vision -p 'test_*.py' -v

Download the official compatible MediaPipe Face Landmarker model into your PRIVATE local model directory. Do not commit the model or user data to Git.

Official Python instructions:
https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker/python

Google model URL (offline inference after download):
https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task

    mkdir -p song_vision/private/models
    curl -fL "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task" -o song_vision/private/models/face_landmarker.task

The model bundle's redistribution/commercial-use conditions and license notices require review before shipping it with a commercial product.

## Analyze authorized user's facial surface image

    python -m song_vision.face_geometry analyze-face \
      --image /private/authorized-face.jpg \
      --model song_vision/private/models/face_landmarker.task \
      --output-json song_vision/private/face-geometry.json \
      --annotated song_vision/private/face-landmarks.png \
      --all-landmarks

Returns 478 relative x/y/estimated-z coordinates when requested, 13 named surface points, normalized proportions and expression coefficients. The output is PERSONAL data. Store privately; do not expose via a public URL or GitHub.

## Preview warped lips on licensed singer footage

The video_edit scope consent record must be backed by actual verified permissions. Private operator-side example, ONLY after verifying consent:

    {"approved":true,"scope":"video_edit","subjectId":"authorized-singer-001"}

A model, video, isolated target vocal WAV and original final mix are required:

    python -m song_vision.face_geometry warp-video \
      --template /private/authorized-singer-video.mp4 \
      --vocals /private/new-song-vocals.wav \
      --mix /private/new-song-final.mp3 \
      --model song_vision/private/models/face_landmarker.task \
      --consent-record /private/video-edit-consent.json \
      --output song_vision/outputs/geometry-preview.mp4 \
      --seconds 10 --start 0 --strength 1.0

This renders a local MP4 plus a research quality report. The singer video should already contain a clearly visible frontal face. There is NO automatic facial identity swap here.

## Scientific references
1. 2025 Journal of Voice observational real-time MRI study of 7 musical theater singers: jaw/lip opening, tongue dorsum, uvula/laryngeal position can vary by singing quality, but these internal articulators require MRI rather than ordinary selfies. https://pubmed.ncbi.nlm.nih.gov/40382246/
2. Fang et al. (2024) Audio-to-Deep-Lip, Computers & Graphics 120, 103925: 3D landmark based speech lip synthesis; note this is speech evidence, not a song-quality guarantee. DOI https://doi.org/10.1016/j.cag.2024.103925
3. Chen et al. (2019), Magnetic Resonance in Medicine 82(2):600–613, internal tongue movement imaged by specialized MRI. DOI https://doi.org/10.1002/mrm.27745
4. Yaman et al. (2024), ECCV, synchronization loss, source-lip leakage and trained audio-video coordination are important. https://www.ecva.net/papers/eccv_2024/papers_ECCV/html/2950_ECCV_2024_paper.php
5. Google MediaPipe Face Landmarker technical model notes: https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker

## Copyright, privacy and launch readiness
Do not scrape or train on arbitrary YouTube singer footage: YouTube rights/TOS and music, performer, appearance and likeness rights need to be checked separately. https://www.youtube.com/t/terms

No consented live singer dataset or customer face data is committed. Models, originals, output MP4s, face geometry JSON, photo annotations, private evidence and weights are all outside public repository and should be encrypted/restricted. Consent JSON is only a technical gate and never substitutes for a real signed agreement. The current SONG commerce endpoints remain intentionally fail-closed.

## Quality tests
GitHub CI runs synthetic 478-point geometry, localized lip remapping, audio RMS control and a full MP4 export with a mock offline detector. No commercial quality claim is made. Real Google model weights, the quality of 478-point inference on real faces, and accurate Korean singing visemes require a separate private validation.
