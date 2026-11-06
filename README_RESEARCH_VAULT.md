# SONG-Vision encrypted research checkpoints

**Public Git branch containing encrypted model checkpoints only**. Every `.svault` file is encrypted with X25519 + HKDF-SHA256 + AES-256-GCM; the corresponding private key is **not** stored in this repository.

The RAVDESS source is CC BY-NC-SA 4.0: https://zenodo.org/records/1188976. These backups are **noncommercial research only**; no permission to reuse the data or resulting weights in paid SONG user videos is granted.

Raw singer videos, isolated vocals, face images, training crops, user images and unencrypted model weights MUST NOT be committed here.

Per-run files are stored in `encrypted/ravdess-actor-01/` with GitHub Actions run ID and attempt number, plus a non-sensitive manifest reporting the model version and numerical metrics.

To decrypt one vault, retrieve the **owner-held private key** stored outside GitHub and run the `song_vision.research_checkpoint_vault decrypt` CLI from the development branch. If the owner loses the private key, files cannot be decrypted.

These files remain in Git history until the owner or GitHub deletes them; GitHub Actions's separate 90-day artifact copy has its own retention policy.