# SONG MVP architecture & constraints (2026-10-30)

## Proven API integrations (verify current contract before production)

| Stage | Provider | Endpoint / behavior |
| --- | --- | --- |
| 30-second song with singing | Google Gemini Interactions Lyria 3 Clip | `POST https://generativelanguage.googleapis.com/v1beta/interactions`, `model=lyria-3-clip-preview`, output audio in `interaction.output_audio` or `steps` |
| Sample voice instant clone | ElevenLabs IVC | `POST https://api.elevenlabs.io/v1/voices/add`, multipart `files` and `name` |
| Voice / music stem separation | ElevenLabs | `POST https://api.elevenlabs.io/v1/music/stem-separation`, multipart `file`, `stem_variation_id=two_stems_v1` returns ZIP |
| Timbre replacement | ElevenLabs Voice Changer | `POST https://api.elevenlabs.io/v1/voice-changer/{voice_id}/stream`, multipart `audio`, `model_id=eleven_multilingual_sts_v2` |
| Mix / QC | Local FFmpeg | duration tolerance guard and `amix`, limiting |

## Official documentation

- https://ai.google.dev/gemini-api/docs/music-generation
- https://elevenlabs.io/docs/api-reference/voices/ivc/create
- https://elevenlabs.io/docs/api-reference/music/separate-stems
- https://elevenlabs.io/docs/api-reference/speech-to-speech/stream
- https://elevenlabs.io/docs/api-reference/voices/delete

## Explicitly NOT claimed

- No assertion that speech-to-speech preserves sung pitch/vibrato perfectly. This needs Korean singing listening tests.
- Not a self-trained singing model. It orchestrates third-party APIs.
- No paid API end-to-end verification without keys/permissions.
- Not production ready: no registered users, database, queues, tenant-level isolation or production deployment. Do not expose publicly.
- No automatic proof of copyright clearances, rights to uploaded voices or commercial use. Review provider agreements and Korea privacy law.

## Security posture

- Binds to 127.0.0.1 by default. External HOST requires APP_ACCESS_TOKEN but that alone is NOT multi-user security.
- Explicit checked consent for the recording and vendor transfer, audio format and body size validation.
- Paid API usage requires explicit click; rate limits 15/hour/IP, concurrent jobs cap 2; user data not logged by application.
- Voice recordings are passed directly to ElevenLabs, not saved locally. Provider may retain data per its policies.
- Generated audio persists only to `.song-data/<random-uuid>/` with restricted permissions; deleted on request or after retention TTL when the cleanup interval runs. Server restart does not currently auto-clean stranded assets; delete `.song-data` as needed.
- External voice profiles are separately deleted via ElevenLabs API; requires the original voice ID. The browser caches the voice ID in its tab session.
- Apps accessible via internet require auth, encryption, consent storage, signed asset URLs, rate limits per user, cost caps, background queue and DPA reviews.

## Next release milestones

1. Real API smoke test using the user's own account/API keys (do not commit keys).
2. Verify stem ZIP naming, cloned voice verification flags, speech-to-speech conversion quality on Korean vocals.
3. Move long-running jobs to persistent queue / database and all media to private object storage.
4. Implement user accounts and scoped access control; voice deletion and automated vendor retention management.
5. Add explicit payment ledger/cost limits, opt-in retention controls, exports, provider rights review, and FTO check.
