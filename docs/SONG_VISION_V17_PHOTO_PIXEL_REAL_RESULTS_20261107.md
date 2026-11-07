# SONG-Vision v17 — actual photographic pixel-memory study, 2026-11-07

## Execution and actual artifact files

- GitHub Actions: https://github.com/tlco1003/Song/actions/runs/42350262499
- Status: **completed / success**.
- Research video artifact: `song-v17-real-singer-comparison-42350262499-a1` (ID 13564974195); 30-day retention.
- Encrypted research model artifact: `song-v17-encrypted-model-42350262499-a1` (ID 13564814843); 90-day retention. Durable encrypted backup also stored in research/song-vision-vault.
- Research-only preview `SONG_v17_same_audio_real_singer_comparison.mp4`: 72 frames, 25fps, 2.88s; RECORDED / V16 BASE / V17 PHOTO MEMORY; same source singer WAV clock; 46,080 decoded 16kHz PCM samples verified identical to source **before** AAC conversion.
- GitHub-song preview `NARA_v17_photo_pixel_memory_RESEARCH_ONLY.mp4`: 250 frames, 25fps, 10s, source `docs/media/nara.mp3`, starting at 25.0s; portrait photo reference / audio-driven face / learned previous-frame memory.
- NARA source audio SHA256: `d6f01b16b86c772d92f58770fb7859bca7028906da3ca0738395129b0a79a574`.
- Reference avatar for NARA is a noncommercial RAVDESS research actor from **another** source, not the person who sang NARA. The NARA original song has no source face recording, and none is required to generate a photo-avatar preview.

## Precisely comparable heldout image errors

Identical actor-disjoint evaluation (Actors 01+02 training, Actor 03 holdout), 16 genuine audiovisual singing training clips, 8 holdout clips, **576 heldout video frames**, dynamic facial ROI, 96×96 source crop. Lower is better.

| Prediction | Dynamic ROI pixel MAE |
|---|---:|
| Static reference copied to every frame | **0.0659589** |
| v16 same study | 0.1039725 |
| v17 timed face before photo memory | 0.1039721 |
| v17 + photo memory, epoch 1 | 0.0892612 |
| v17 + photo memory, epoch 2 | 0.0752775 |
| v17 + photo memory, epoch 3 | **0.0744623** |

The photo-memory module improves the raw v17 dynamic ROI MAE by approximately **28.38%** on this controlled split, but remains approximately **12.89% worse than static copying**. This is **NOT a quality PASS**, not phoneme-accurate lip-sync, and not a production photo-real face generator. Training convergence or observed frame variation alone is insufficient.

## Frame-by-frame architecture and code

- `song_vision/photo_pixel_memory_v17.py`: differentiable 96px reference-photo + preceding generated frame + predicted acoustic face conditioning. Predicts a local inverse pixel flow from frame motion changes and a learned masked dynamic-region pixel correction. Maintains explicit recurrent state across inference chunks; no target frame is used as an inference input. Research image/velocity loss uses genuine video frames only during training.
- `song_vision/test_photo_pixel_memory_v17.py`: gradients, finite outputs, dynamic-region identity preservation, reset, and equality between continuous and streamed chunks. Python research smoke tests **passed**: https://github.com/tlco1003/Song/actions/runs/42350262701.
- `song_vision/real_singing_v17.py`: trains a genuine English-grapheme RAVDESS CTC head (16 source-song/transcript pairs; 32 optimizer steps), v16 reference model, v17 timed face branch and photo pixel memory. Evaluates holdout then encodes and uploads **two** original-song/source-video research MP4 previews.
- `song_vision/research_vault_v15.py`: registered research-only English RAVDESS provenance so owner-encrypted v17 checkpoint can be archived successfully.

The source MP3 is a full music mix with accompaniment, not a separated singer-only vocal stem. NARA does **not** have independent, human-reviewed Korean phone boundaries. The NARA preview explicitly sets its Korean CTC confidence to zero and uses an audio-feature-conditioned face path; it is not proof of accurate Korean pronunciation. The source report's fixed text `targetSource=given_lyrics_orthographic_hangul_not_verified_phone_boundaries` is a generic/incorrect provenance label **for this English experiment**; the actual training examples are English orthographic graphemes. The field should be parameterized in a follow-up code fix, not treated as Korean training evidence.

### Observed visual limitations

The 96×96 video currently has visibly **blurred facial features and rectangular dynamic-region artifacts** when enlarged; a changing frame is not proof of natural facial expression. `NARA` reports 249/249 changing frame transitions and a small mean per-pixel transition difference of 0.00058358, but these numbers are movement diagnostics, not meaningful Korean lip-sync, emotion or identity metrics.

Improve spatial detail, mask geometry, surface correspondence, and heldout comparisons with real facial textures before asserting naturalism. Genuine mouth opening includes previously occluded teeth/tongue pixels, which a single closed-mouth still cannot provide by pixel displacement alone. Those missing regions require supervised synthesis and realistic video evidence, not simply repeated storage or faster playback.

## Rights and deployment

RAVDESS (Livingstone & Russo, 2018): https://zenodo.org/records/1188976 ; **CC BY-NC-SA 4.0**. Do **not** put the face previews or weights in customer/paid SONG flows. The original-source actor's face footage is in a research-only owner artifact, not the public paid app. All commercial capability gates remain false. Separate commercial-use face training data with appropriate identity/likeness permissions are required.
