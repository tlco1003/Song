# SONG-Vision self-hosted AI research connection — 2026-11-06

Branch: `feature/song-vision-self-hosted-v1`.

The user requested **a first-party model**, not AKOOL/Sync Labs/API wiring.
This branch adds local `song_vision/` original PyTorch audio-conditioned
mouth-patch generation + data preparation + training + local MP4 renderer.
No external video model, SaaS inference or remote user upload is required.

Read-only SONG integration: `GET /api/video-ai/readiness`.

Commercial status is **explicitly unavailable**. No trained weights, consented
training footage, proven visual quality, independent lip-sync validation,
per-customer train-free identity model or production GPU worker are supplied.

The customer-facing `audio_video` option, original pricing, commerce
fail-closed logic, payment checks and current browser-only local preview are
not modified or bypassed.

See `song_vision/README.md` for exact `prepare`, `train`, and `render`
commands and clear limitations.
