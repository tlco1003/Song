# SONG-Vision multi-singer training v8: independently held-out performer

Reference date: 2026-11-06. Branch `feature/song-vision-self-hosted-v1`.

## Source and permitted uses
- Original Zenodo dataset: https://zenodo.org/records/1188976
- Livingstone & Russo (2018), PLOS ONE 13(5):e0196391 https://doi.org/10.1371/journal.pone.0196391
- CC BY-NC-SA 4.0: free research, **no commercial SONG model or paid videos**. Commercial license requires a separate agreement.
- RAVDESS is a 2018 database of professional actors singing short English phrases, **not** a full-length pop-song or Korean singing dataset. No claim of training on full song is made.
- Download source archives from the official Zenodo page only. Verify its published MD5 before extracting ANY clip.

## Official source ZIPs and recorded checksums
| Actor | Source ZIP | Official MD5 | Use |
|---|---|---|---|
| 01 male | Video_Song_Actor_01.zip | `0f7ba20f3a7278d5a662a7e30f44c942` | TRAIN |
| 02 female | Video_Song_Actor_02.zip | `8e426ef4134abe1dff4d2a8262abe8a9` | TRAIN |
| 03 male | Video_Song_Actor_03.zip | `2d686591f8760f8041d2dc75e8234828` | HELD-OUT VALIDATION |

20 separate actor recordings each: five emotions (calm, happy, sad, angry, fearful), two English statements, two repetitions, NORMAL intensity. Every selected file is mode `01` full audiovisual, channel `02` song.

## Data split and methodology
- Train: Actors 01 and 02, 40 recordings, projected 3 seconds × 25fps × 40 = about 3,000 frames (actual counts are from logs).
- Validation: Actor 03 entirely unseen during training, 20 recordings, projected about 1,500 frames.
- Strict actor-disjoint validation, not just separate video takes of the same singer as in v5-v7.
- For each MP4 recording, extract the exactly corresponding mono 16kHz WAV vocal directly with FFmpeg. Not a source separation model and no unrelated vocal overlay.
- Validate video duration/face crop coverage and temporal alignment in the existing `real_training.prepare_manifest` path.
- Train the same SONG `MaskedSingingMouthNet` from scratch, max 24 epochs, early stop after minimum 12, patience 7, minimum gain 0.0002, batch size 12.
- Analyze valMaskedMAE, copyReferenceMaskedMAE, correctVsShuffledMAEGain, audioSensitivity, and any failed gates.
- Track this as a **new independent-performer validation protocol**; compare with the prior same-actor experiment only with clear evaluation differences. No claim of apples-to-apples improvement.

## Model checkpoint MUST remain available
- Model and paired research report are encrypted using the **existing** `song_vision/research_vault_public.pem` (X25519/HKDF-SHA256/AES-256-GCM), and a recovery key held only by the owner, outside GitHub.
- Encrypted `.svault` and non-sensitive `.manifest.json` are committed to `research/song-vision-vault` under `encrypted/ravdess-actors-01-02-03/`.
- Secondary GitHub Actions artifact retention 90 days; encrypted Git branch copy remains until owner/repo deletes it. Protect the owner-held PRIVATE key.
- Originals (video, vocal, landmarks and frames) are ephemeral and NOT published to the public repo; only ciphertext and aggregate research metrics survive.
- The existing Actor-01 encrypted model from run 42202442871 is retained unchanged.
- New training does not use/reveal the owner's private key on CI, and does not unlock old models to warm-start; this is a new from-scratch 3-actor experiment.

## Exact current status
Source/license was verified from the official page. Code/CI are implemented and queued for actual execution. The GitHub Actions result is the authority for successful downloads, frame counts, epochs and checkpoint preservation. Do not claim real successful training without the success log, manifest and vault branch file.

## Code and workflow
- `song_vision/external_ravdess_multisinger.py` — source validation, performer split and workflow.
- `song_vision/test_multisinger_research.py` — offline source and no-leakage tests.
- `.github/workflows/song-vision-ravdess-multisinger.yml` — real download, actual training, encrypted backup and Git push.
- `song_vision/research_checkpoint_vault.py` — exact-allowlist research dataset check, authenticated encryption.
- `https://github.com/tlco1003/Song/actions/workflows/song-vision-ravdess-multisinger.yml`

## Scientific caveats
Even passing trainer tests only means video/audio sync and optimization code ran. A lower MAE or a positive audio sensitivity is NOT objective phoneme-to-mouth synchronization, identity consistency, video generation quality, Korean singer generalization or consent to commercial face swapping. No customer jobs are enabled.
