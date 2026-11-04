# SONG — 사연을 편지 같은 가사로, Suno로 노래로

## SONG 제휴 신청용 소개 웹사이트

- **정적 소개 화면:** [docs/index.html](./docs/index.html)
- **GitHub Pages 최초 공개 설정:** [GitHub Pages 배포 안내](./docs/GITHUB_PAGES_배포안내.md)
- **공개 예정 URL:** https://tlco1003.github.io/Song/ (Pages 배포 성공 확인 후에만 실제 사이트 주소로 사용)
- **목적:** Suno API Interest Form의 Website/Company URL 제출용. 회사가 설립·등록되지 않았다면 `SONG Project`라고 사실대로 소개한다.
- **중요:** 이는 홍보용 정적 사이트이며, 실제 GPT/Suno 노래 생성 앱이 배포되었다는 뜻은 아니다.

> **2026-11-04 Suno 지원 회신 반영:** 현재 소비자 계정용 셀프서비스 공개 Suno API 키 발급은 제공되지 않으며, 공식 신청은 https://sunomusic.typeform.com/apiform 입니다. Suno MCP는 **개인 AI 어시스턴트의 창작용**으로 안내됐으며 SONG 같은 제3자 고객용 유료 웹앱에 사용하는 권한은 아닙니다. REST API 및 Voices 등록·인증·가창 지원 범위는 **B2B 제휴 검토 및 서면 계약** 대상입니다. 지원 회신은 Suno의 *AI 고객지원 도우미가 작성*했으므로 승인·계약 확약으로 해석하지 않습니다.  
> **[지원 회신과 정정된 실행 지침](./docs/SUNO_공식지원답변_API_제휴신청_2026-11-04.md)**

**현재 개발 목표:** 사용자의 짧은 사연 → OpenAI GPT 작사 → 가사 검토·수정 → Suno 공식 B2B API 제휴 승인 후 작곡. **개인용 Suno MCP는 개발자 단독 시연용이며 상용 제품 연동으로 간주하지 않는다.**

**중요:** 이 저장소는 개발용 웹앱이다. GPT API 및 Suno OAuth 자격 증명이 없으면 실제 외부 생성은 실행되지 않는다. 서버 배포와 실사용 계정에서의 라이브 생성 성공은 별도로 검증해야 한다. Gemini는 사용하지 않는다.

## 공식 API·MCP·내 목소리(Voices) 구현 문서

**[Suno API / MCP / 내 목소리 연동 조사·실행 지시서](./docs/SUNO_API_MCP_VOICES_내목소리_연동지시서.md)**

- 공식 REST 개발자 포털: https://platform.suno.com/ — 일반 유료 구독과 API 접근권은 별개
- 공식 Suno MCP: https://api.suno.com/mcp — 계정 OAuth 인증, 본인 Suno 크레딧 사용
- Suno Voices: https://suno.com/ko/voices — 본인 음성을 등록하고 인증한 후 내 음색으로 가창
- **Suno MCP 공식 페이지는 개인 계정에서 이미 등록된 자기 Voice를 작곡에 사용하는 기능을 소개한다.** 다만 신규 Voice 프로필의 MCP 등록·검증 API 스키마는 아직 검증되지 않았다.
- **현재 SONG의 Voice UI와 Voice 지정 생성은 미구현.** 이 문서에 확인된 기능·미확인 기능·검증 체크리스트를 구분해 보관했다.
- **사업상 중요:** Suno 현행 이용약관의 경쟁 서비스·재판매 제한이 SONG의 유료 고객용 서비스에 적용될 수 있다. 사업용 API 및 Voice 이용에 대한 **Suno의 별도 서면 허가**가 확인되기 전에는 공개 상용 출시 금지.

## 확인된 Suno 공식 MCP

- 공식 연결 주소: `https://api.suno.com/mcp`
- 공식 안내: [How to connect Suno MCP](https://help.suno.com/en/articles/14551425)
- 공식 기능: [What is Suno MCP?](https://help.suno.com/en/articles/14551361) — 가사 기반 노래, Covers, Extends, Mashups, Speech, 오디오 업로드, 크레딧 조회
- 공식 요금 FAQ: [Suno MCP FAQ](https://help.suno.com/en/articles/14486145) — 무료/유료 플랜 모두 연결 가능; 음악 생성에 해당 Suno 계정 크레딧 사용

### 빠르게 사용자 본인의 Suno 계정 연결하기

**Claude Code**
```sh
claude mcp add --transport http suno https://api.suno.com/mcp
# Claude Code 세션에서 /mcp 실행 → Suno 로그인 → 승인
```

**ChatGPT**  
Plugins → Add → Add custom MCP server → 이름 `Suno` → 서버 URL `https://api.suno.com/mcp` → Create as a plugin → Connect Suno → 본인 계정 인증.

위 절차는 **각 AI 조력자에서 개인 Suno 계정으로 음악을 만드는 기능**을 연결한다. 고객들이 사용하는 SONG 서버에 로그인 토큰을 자동으로 제공하는 것은 아니다.

## SONG 소스 구성

- `가사 프롬프트.md`: 5개 질문과 나이대·관계·평소 반말/존댓말을 감안한 편지형 작사 정책. 구형 모델도 이해하도록 단계별 기승전결, 상대방 행동에 대한 구체적 감사, 마음 헤아리기, 1인칭 회상과 조심스러운 수식 규칙.
- `src/lib.mjs`: 입력 검증, 작사 프롬프트 조립, Suno Style of Music 편곡 지침 생성.
- `src/providers.mjs`: **OpenAI Responses API**로 가사 생성, **공식 Suno MCP**를 OpenAI remote MCP 도구로 호출하는 어댑터. Gemini 및 비공식 Suno 래퍼는 호출하지 않는다.
- `src/server.mjs`: 인증과 사용량 제한, `/api/lyrics`, `/api/suno-package`, `/api/suno-mcp/create` 엔드포인트.
- `public/index.html`, `public/app.js`: 5개 고객 질문, 받는 사람의 나이대·관계·말투, 음악 장르/분위기, 가사 편집, Suno 수동 복사 및 공식 MCP 생성 요청 화면.
- `test/`: 입력 보존, 적절한 존댓말, API 호출 사양, 실패 처리와 인증 검사.

## 개발용 실행

Node.js **22+** 필요.

```sh
cp .env.example .env
# .env에 자신이 발급받은 OpenAI API 키를 설정
node --env-file=.env src/server.mjs
```

브라우저: http://127.0.0.1:3000

```sh
npm run check
npm test
```

### 환경변수

- `OPENAI_API_KEY`: 필수 (GPT 가사 작성 및 OpenAI를 통한 MCP 호출)
- `OPENAI_LYRICS_MODEL`: 기본 `gpt-6-astra`; 실제 OpenAI 계정에서 접근 가능한 모델로 변경 가능
- `OPENAI_SUNO_MODEL`: 기본 `gpt-6-astra`
- `SUNO_MCP_ACCESS_TOKEN`: 본인 Suno 계정에서 **정식 OAuth로 획득한 액세스 토큰**. 아직 SONG 웹앱에서 OAuth 로그인 화면/콜백을 구현하지 않았으므로 Suno 앱이나 ChatGPT/Claude에 로그인한 것만으로 생기지 않는다. 임의의 세션 쿠키·비공식 토큰을 추출해 쓰지 않는다.
- `APP_ACCESS_TOKEN`: 개발 서버 비밀 접근 토큰. **Suno MCP 유료 작업은 이 값이 없으면 실행되지 않는다.**
- `HOST`, `PORT`: 개발 서버 주소·포트

### 음악 생성 동작과 안전

1. GPT로 가사를 만들거나 사용자가 가사를 직접 작성한다.
2. 가사를 확정하면 그 **원문을 그대로** Suno 작곡 지시에 싣는다. Style of Music은 장르·분위기·말투와 가사 흐름에서 생성한다.
3. 서버에 정식 OAuth 토큰이 설치된 **개인 개발 환경**에서만 `Suno MCP로 노래 생성하기` 버튼 사용 가능. 크레딧 사용·사연 전송에 대한 사용자 체크와 확인창이 있다.
4. OpenAI Responses API의 `type: "mcp"`, `server_url: "https://api.suno.com/mcp"` 도구를 통해 호출한다. 실제 Suno MCP tool call이 확인되지 않으면 오류를 반환하고, 가짜 MP3나 완료 메시지를 만들지 않는다.
5. 호출 후 결과를 받아보고 Suno 라이브러리에서 실제 곡·한국어 가사 일치·상업 라이선스를 확인한다.
6. 서버에 토큰이 없는 경우 두 텍스트를 복사해 Suno Custom 모드에서 직접 제작할 수 있다.

**현재 구현 한계:** 사용자의 Suno OAuth 로그인/토큰 갱신/토큰 폐기, 다중 사용자 계정 분리·권한 관리, 실제 MP3 URL 회수·자동 다운로드, 사용자 목소리 훈련·가창 변환은 아직 미구현이다. 특히 고객용 상업 SaaS에서 운영자의 단일 Suno 유료 계정을 공유하는 것이 허용되는지 별도의 계약/약관 확인이 필요하다.

프로젝트에는 고객 음성 파일, API 비밀키, OAuth 토큰을 Git에 커밋하지 않는다. 서버는 아직 공개 서비스용 인증·사용자 데이터 격리를 구현하지 않았다. 기존 YOONGYOYA/ChefOS 저장소와 무관하다.

## 공식 참고

- [Suno MCP 연결 방법](https://help.suno.com/en/articles/14551425)
- [Suno MCP FAQ](https://help.suno.com/en/articles/14486145)
- [Suno MCP 기능 소개](https://help.suno.com/en/articles/14551361)
- [OpenAI Responses text generation](https://developers.openai.com/api/docs/guides/text)
- [OpenAI remote MCP](https://developers.openai.com/api/docs/guides/tools-connectors-mcp)
