# SONG Implementation — GPT + official Suno MCP (2026-11-03)

> **2026-11-04 Suno 지원 회신 반영:** 현재 소비자 계정용 셀프서비스 공개 Suno API 키 발급은 제공되지 않으며, 공식 신청은 https://sunomusic.typeform.com/apiform 입니다. Suno MCP는 **개인 AI 어시스턴트의 창작용**으로 안내됐으며 SONG 같은 제3자 고객용 유료 웹앱에 사용하는 권한은 아닙니다. REST API 및 Voices 등록·인증·가창 지원 범위는 **B2B 제휴 검토 및 서면 계약** 대상입니다. 지원 회신은 Suno의 *AI 고객지원 도우미가 작성*했으므로 승인·계약 확약으로 해석하지 않습니다.  
> **[지원 회신과 정정된 실행 지침](./SUNO_공식지원답변_API_제휴신청_2026-11-04.md)**

## Product contract
SONG collects five recipient-centered answers:
1. 상대방을 어떻게 부르나요?
2. 그 사람과의 추억의 장소나 있었던 일이 있나요?
3. 그 사람에게 해주고 싶은 말이 있나요?
4. 미안했던 일이나 고마웠던 일을 이야기해주세요.
5. 어떤 상황에 보내는 노래인가요?

Additional fields: `recipientAgeGroup`, `relativePosition`, `speechStyle`, `genre`, `mood`, `lyricLength`.
A user's explicit everyday speech register (informal/polite/mixed) overrides stereotypes about older or younger recipients.

## Personal developer prototype pipeline (NOT licensed production integration)
`input validation -> 가사 프롬프트.md -> OpenAI GPT Responses API -> editable lyrics -> Suno style prompt -> manual Suno consumer creation OR isolated personal MCP trial`. **For customer-facing SONG production: B2B API access, commercial terms, and Voices API scope remain blocked pending written Suno approval.**

- `src/providers.mjs`: OpenAI GPT for lyrics and `https://api.suno.com/mcp` (the **official** Suno MCP URL) for songs.
- `src/server.mjs`: `POST /api/lyrics`, `POST /api/suno-package`, `POST /api/suno-mcp/create`.
- The final stage only executes after the user explicitly approves credit spending, data transfer and the private server has `APP_ACCESS_TOKEN`. Missing OAuth token fails before any music-generation call.
- Manual Suno Custom Mode remains available without OAuth token.
- Gemini, Lyria and the old ElevenLabs speech conversion flow have been removed from live API paths. Older unused helper code may remain for regression reference; it is not called by the server.

## OAuth scope and commercial boundaries
Suno confirms that MCP supports all account tiers, with music generation charged in Suno credits. A paid Suno subscription grants certain commercial usage rights for qualifying tracks but does not automatically authorize a multi-user commercial web app to share a single creator's credentials.

The personal Suno login on Claude Code or ChatGPT is **not** the same credential stored by this standalone web service. Authenticating the standalone web service requires an OAuth authorization-code + PKCE flow with appropriate client registration, credential protection, refresh and revocation. This is **not implemented**. An app developer must first establish the authorized OAuth path and correct contractual terms. Do not copy web session cookies or credentials from another client.

An authenticated, validated personal `SUNO_MCP_ACCESS_TOKEN` can be supplied to the development server as an environment secret; never commit it or provide it in a chat. The backend then uses OpenAI's documented remote MCP tool `{type:'mcp',server_url:'https://api.suno.com/mcp',authorization:<OAuth token>}` with user-initiated authorization. Only an actual MCP tool call is considered progress. A fake MP3 is never produced.

## Verification still required
- Live OpenAI text generation with the user's API account.
- Live Suno OAuth token acquisition using the official supported consent flow, and actual `mcp_call` return semantics.
- Exact sung lyrics, accent and Korean diction.
- Suno return link/media mapping, download/stems, voice personalization, track licensing and ownership terms.
- Per-user auth, billing, credit restrictions, data retention, consent records and token vault before public deployment.

## Official docs
- https://help.suno.com/en/articles/14551425
- https://help.suno.com/en/articles/14486145
- https://help.suno.com/en/articles/14551361
- https://developers.openai.com/api/docs/guides/text
- https://developers.openai.com/api/docs/guides/tools-connectors-mcp
