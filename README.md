# SONG — 내 사연과 내 목소리로 만드는 노래

A Korean-language **local-first prototype web app** that collects a personal story, records your own voice, generates a 30-second sung song with Google Lyria and attempts to convert its lead vocal into your voice using ElevenLabs APIs.

> **STATUS: Functional code and local UI, not verified with live paid APIs.** Singing timbre quality is experimental. Not a deployed, multi-user service.

## Requirements

- Node.js 22 or later
- `ffmpeg`, `ffprobe`, `unzip` CLI tools installed
- Google Gemini API key with Lyria 3 Clip access
- ElevenLabs API key/plan granting IVC cloning, music stem separation and voice changer
- HTTPS for browser mic recording when accessing remotely; localhost works over HTTP

## Run

```bash
cp .env.example .env
# edit .env with your API keys locally (never commit)
# Node has no builtin .env auto-loader unless --env-file is used
node --env-file=.env src/server.mjs
```

Then visit **http://127.0.0.1:3000**. You can run `npm start` if environment variables are already loaded, or `node --env-file=.env src/server.mjs` to load your .env directly.

## Validate

```bash
npm run check
npm test
```

No npm dependencies or network access are needed for the app shell and tests. The real-song flow needs provider access and will generate actual API costs. **There is no demo audio or mocked success.**

## App flow

1. Enter a story of 10–1500 Korean characters, select genre and mood.
2. Record (or upload) your own speaking voice; check explicit provider consent.
3. Register an ElevenLabs IVC voice, provided the account and service support it.
4. Approve real paid job: Lyria 30s composition → ElevenLabs two-stem separation → ElevenLabs Voice Changer → local FFmpeg mix.
5. Play and download available intermediate and final MP3 assets; delete job and voice model independently.

## Notes

- A speaking reference does not guarantee a high-quality natural *singing* result. ElevenLabs Voice Changer is speech-to-speech; preserving pitch, timing, Korean lyrics and vibrato must be tested. For higher singing quality consider replacing this adapter with a licensed singing-voice-conversion provider.
- An IVC voice may require verification; if so, generation is blocked pending verification rather than pretending success.
- Generated MP3s are temporary and auto-deleted after TTL while the server is running; voice models remain on the vendor until deleted. No registration/login: **do not deploy this MVP publicly.**
- This is unrelated to `tlco1003/whthu` and does not depend on the ChefOS codebase.

See [implementation and privacy notes](docs/IMPLEMENTATION.md).

## GitHub repository and safety

Repository: `tlco1003/Song` (user-created; GitHub repository name uses uppercase `S`). The repository was **public** when checked on 2026-10-31. Only application source, tests, documentation and `.env.example` should be committed. No API keys, recorded voices, generated media or `.song-data` files belong in Git.

The app defaults to localhost and is **not safe to deploy as a public multi-user service** until proper authentication, per-user data isolation, abuse controls, retention, consent records and vendor agreement reviews are implemented. For private source hosting, change repository visibility using GitHub repository settings.
