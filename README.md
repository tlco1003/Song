# SONG — 내 사연과 내 목소리로 만드는 노래

A Korean-language **local-first prototype** for writing personalized gift-song lyrics and preparing copy-ready Suno Custom Mode prompts. The older Lyria/ElevenLabs 30-second audio pipeline is legacy and disabled by default.

> **STATUS: Functional code and local UI, not verified with live paid APIs.** Singing timbre quality is experimental. Not a deployed, multi-user service.

## Requirements

- Node.js 22 or later
- **Suno Custom handoff:** no Suno API key required; manually log in at https://suno.com/create and use the generated Lyrics and Style texts
- **AI-written lyrics:** Gemini API key currently required; approved user-written lyrics can be handed to Suno without an AI lyric request
- **Future automatic Suno generation:** eligible official Suno REST API account and permitted commercial integration terms required; not yet connected
- **Legacy Lyria/ElevenLabs experiments only:** `ffmpeg`, `ffprobe`, `unzip`, appropriate provider keys and explicit `LEGACY_LYRIA_ENABLED=true`
- HTTPS required for browser mic recording when accessing remotely; localhost works over HTTP

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

1. Answer the **original five gift-song questions** and optionally select recipient age group, relative age/relationship and *actual everyday speech style* (informal, polite, mixed, or automatic).
2. Choose music genre, mood and either full-length lyric draft or a short trial. Generate with Gemini or enter your own lyrics and edit until approved.
3. Select **Suno 제작용 가사·스타일 프롬프트 준비하기** to create two copy-ready texts and open Suno Custom Mode. Nothing is sent to Suno before you paste it yourself.
4. Generate and listen to the song **inside Suno**. The SONG app is not yet automatically connected to the Suno REST API.
5. Voice cloning, advanced stem processing, hosted multi-user accounts and payment are later milestones, not functional steps in this Suno-first flow.

## Notes

- A speaking reference does not guarantee a high-quality natural *singing* result. ElevenLabs Voice Changer is speech-to-speech; preserving pitch, timing, Korean lyrics and vibrato must be tested. For higher singing quality consider replacing this adapter with a licensed singing-voice-conversion provider.
- An IVC voice may require verification; if so, generation is blocked pending verification rather than pretending success.
- Generated MP3s are temporary and auto-deleted after TTL while the server is running; voice models remain on the vendor until deleted. No registration/login: **do not deploy this MVP publicly.**
- This is unrelated to `tlco1003/whthu` and does not depend on the ChefOS codebase.

See [implementation and privacy notes](docs/IMPLEMENTATION.md).

## GitHub repository and safety

Repository: `tlco1003/Song` (user-created; GitHub repository name uses uppercase `S`). The repository was **public** when checked on 2026-10-31. Only application source, tests, documentation and `.env.example` should be committed. No API keys, recorded voices, generated media or `.song-data` files belong in Git.

The app defaults to localhost and is **not safe to deploy as a public multi-user service** until proper authentication, per-user data isolation, abuse controls, retention, consent records and vendor agreement reviews are implemented. For private source hosting, change repository visibility using GitHub repository settings.


## Suno-first product flow (November 2026)

**Primary product target:** Suno music generation, **not Google Lyria**. The default interface uses the five gift-song questions plus optional `recipientAgeGroup`, `relativePosition`, and `speechStyle`, genre/mood and lyric length. The selected speech style takes precedence over age or seniority. For example, an older parent may be addressed in natural casual Korean, and a peer may be addressed politely.

**Immediate functional integration:** `POST /api/suno-package` returns `{provider:'suno', mode:'manual-custom-handoff', apiConnected:false, title, lyrics, stylePrompt, sunoUrl, note}`. It uses the **approved user lyrics verbatim** and derives a genre-specific style prompt with natural Korean diction and dynamic development. This call does not generate audio and needs no paid music API key. The UI supplies separate copy buttons and opens https://suno.com/create for manual Custom Mode creation.

**Official automated REST integration — NOT YET CONNECTED:** Suno advertises a REST API at https://platform.suno.com/, but accessing production credentials/documentation requires an eligible Suno API account. The official Suno MCP at https://api.suno.com/mcp connects an authorized Suno account to supported AI assistants; it should not be mistaken for production permission to run a customer-facing multi-user SaaS. Confirm account access, authenticated API schema, pricing, user-data policy, permitted resale and commercial terms before implementing/launching an automated provider adapter. Avoid unofficial cookie/session wrappers.

**Legacy safety switch:** The existing Lyria/ElevenLabs 30-second experiment is retained in source for historical reproducibility but `POST /api/jobs` now returns HTTP 410 unless the operator explicitly sets `LEGACY_LYRIA_ENABLED=true`. The default SONG experience does **not** call Lyria behind the customer's back. Legacy voice registration endpoints are not part of the main Suno Custom handoff.

**Lyrics API today:** the prompt is provider-independent, but `/api/lyrics` still uses Gemini until an OpenAI GPT integration is separately completed. Live output quality with older AI models, generated Korean singing, and Suno API are not yet verified.

**Age/register contract:** all five original fields are preserved. The optional fields have safe defaults of `unknown`, `unknown`, `auto`. `recipientAgeGroup`: `unknown|under20|20s|30s|40s|50s|60s|70plus`; `relativePosition`: `unknown|older|peer|younger`; `speechStyle`: `auto|casual|polite|mixed`. Never hard-code 'older=polite' or age-to-music-genre assumptions.

Run `npm run check && npm test`, including `test/suno-handoff.test.mjs` for the age/register rules and safe Suno route.

## Personalized letter-style lyric authoring

[가사 프롬프트.md](./가사%20프롬프트.md) is the canonical instruction file. The server reads it directly at runtime from `src/lib.mjs`; it is not a document-only spec. Its rules cover first-person conversational Korean, natural reflection (e.g., '그랬었어', '그랬네', '그랬을까' when context warrants), empathy for the recipient without inventing their emotions, gratitude for concrete observed actions, a progressive emotional arc, and **restrained** adjectives.

The web UI collects `recipient`, `memory`, `message`, `gratitudeApology` and `occasion`. The lyrics request passes all five values to the server, plus `genre`, `mood` and `lyricLength` (`full` or `short`). The older free-form `story` payload is accepted only as a compatibility path. The prompt is provider-neutral and currently runs through the existing Gemini lyrics API; **OpenAI GPT API has not yet been connected**.

`full` produces an editable target 3–4-minute lyric, **not a full audio track**. Current music generation still supports 30-second songs only. The client blocks voice registration from the long-form lyric path, and the server rejects `full` music jobs. Actual paid API quality and sung Korean lyric accuracy are unverified.
