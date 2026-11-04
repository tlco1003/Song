# WITHU — 마음을 노래로 전하는 선물곡 서비스 (코드 저장소: Song)


> **브랜드 변경:** 2026-11-04부터 대외 서비스명은 **WITHU**. 이전 대화·Suno 지원 메일·일부 내부 경로에 남아 있는 `SONG`은 기존 프로젝트를 가리키며, GitHub 저장소 경로 `tlco1003/Song`은 의도적으로 유지한다. 사이트 방문자에게는 WITHU가 표시된다. 회사 사업자 등록이나 상표등록이 완료됐다는 뜻은 아니다.

## WITHU 결제·이메일·뮤직비디오 작업 (2026-11-04)

- **현재 고객 화면:** `create.html`에서 완성 가사를 확정하면 Suno 외부 제작 사이트로 직접 이동하지 않고, **`checkout.html` 주문·결제 준비 화면**으로 연결한다.
- **주문 UI:** MP3 노래 선물 / MP3+MP4 뮤직비디오, 수신 이메일 2회 확인, 처리 동의, 최종 가사/스타일 확인.
- **현재 결제 상태:** 상업 라이선스·PG·이메일·지속 주문 저장·영상 제작 검증 미완료이므로 결제 버튼은 **의도적으로 비활성화**되어 있다. 가격·작곡 완료·메일 발송을 허위로 안내하지 않는다.
- **서버 안전 설정:** `GET /api/commerce/readiness`는 현재 모든 상업 준비 플래그를 false로 반환, `POST /api/commerce/orders`는 503 반환. 개발 중 고객 결제를 받지 않는다.
- **개발 계약/자동화 설계:** [결제·자동 작곡·이메일·뮤직비디오 구현 계획](./docs/WITHU_결제_자동작곡_이메일_뮤직비디오_구현계획.md). 정식 계약과 API 기술 문서가 오면 상업용 provider, PG 승인/환불, 대기열, 영상 API, 파일 저장, 이메일 송신을 차례로 연결해야 한다.
- **영상 방향:** 노래 가사·박자 타임라인에서 장면별 영상을 생성하고 MP3를 별도 합성. 10초 짜리 4컷 뮤직비디오와 전체 길이 영상은 서로 다른 상품/원가로 다룬다.

## WITHU 직접 음악 만들기 및 엄마 노래 영상 (2026-11-04)

- 새 고객용 음악 준비 화면: [docs/create.html](./docs/create.html). 링크는 공개 홈페이지에서 **노래 만들기**로 표시한다.
- 사연 다섯 질문·말투·장르·분위기를 입력하고 가사 텍스트를 직접 편집할 수 있다.
- **GPT 작사:** 별도 인증된 Node 서버가 정상 연결된 경우에만 `POST /api/lyrics` 호출. GitHub Pages 단독 상태에서는 아직 자동 작사 불가이며, 직접 가사 입력·수정과 음악 스타일 준비/복사는 가능하다.
- **현재 고객 버튼:** 완료된 가사/스타일을 세션에서 임시 전달하고 `checkout.html` 주문 확인 화면으로 이동. 결제 버튼과 자동 작곡은 준비 중으로 비활성화. API 없이 Suno로 직접 이동하는 기존 방식은 고객용 기본 흐름에서 제거했다.
- **엄마 노래 소개 영상:** 사용자가 업로드한 MP4를 Git에서 파일명 변경하여 **`docs/media/mother-song.mp4`**로 정식 게시했다(16,265,579 bytes). 실제 Pages 배포·브라우저 재생은 별도 확인한다.
- 엄마 노래 동영상은 실제 수신자의 감동 후기라고 단정하지 않는다. 작품/선물 영상으로 소개하며 후기는 실제 동의 자료만 게시한다.
- 별도 서버 배포 구성은 기존 `Dockerfile`, `render.yaml`과 정적 경로 허용목록으로 준비. 사업용 음악 API 실제 연결과 고객 인증·저장소·결제는 추가 구현 필요.

## WITHU 제휴 신청용 소개 웹사이트

- **WITHU 정적 소개 화면:** [docs/index.html](./docs/index.html)
- **음악·후기 플레이어와 관리자용 게시:** [WITHU 음악 및 후기 영상 게시방법](./docs/WITHU_음악_후기_게시방법.md)
- **오리지널 3곡:** 고객 화면에서 외부 브랜드 임베드를 제거했다. 현재 `nara.mp3`, `taehwan.mp3`, `jeongmi.mp3` 파일은 미게시이며, GitHub에 MP3를 올려야 자체 음악 플레이어가 재생된다. 세 곡의 가사에는 구간 지시를 제거하고 3줄 높이의 자동 이동(현재 근사 진행률 기반)을 적용했다.
- **실제 후기 영상:** 업로드된 실제 동의 영상만 표시. 현재 동영상 자료 미제공.
- **방문자 파일 선택:** 이 브라우저에서만 미리 듣기/미리보기. 영구 게시에는 GitHub 관리자 파일 업로드, 일반 고객 공개 게시에는 별도 인증·저장 서버가 필요.
- **GitHub Pages 최초 공개 설정:** [GitHub Pages 배포 안내](./docs/GITHUB_PAGES_배포안내.md)
- **공개 예정 URL:** https://tlco1003.github.io/Song/ (브랜드는 WITHU, 저장소 이름은 Song으로 유지; Pages 배포 성공 확인 후 사용)
- **목적:** Suno API Interest Form의 Website/Company URL 제출용. 회사가 설립·등록되지 않았다면 `SONG Project`라고 사실대로 소개한다.
- **중요:** 이는 홍보용 정적 사이트이며, 실제 GPT/Suno 노래 생성 앱이 배포되었다는 뜻은 아니다.

> **2026-11-04 Suno 지원 회신 반영:** 현재 소비자 계정용 셀프서비스 공개 Suno API 키 발급은 제공되지 않으며, 공식 신청은 https://sunomusic.typeform.com/apiform 입니다. Suno MCP는 **개인 AI 어시스턴트의 창작용**으로 안내됐으며 SONG 같은 제3자 고객용 유료 웹앱에 사용하는 권한은 아닙니다. REST API 및 Voices 등록·인증·가창 지원 범위는 **B2B 제휴 검토 및 서면 계약** 대상입니다. 지원 회신은 Suno의 *AI 고객지원 도우미가 작성*했으므로 승인·계약 확약으로 해석하지 않습니다.  
> **[지원 회신과 정정된 실행 지침](./docs/SUNO_공식지원답변_API_제휴신청_2026-11-04.md)**

**현재 개발 목표:** 사용자의 짧은 사연 → OpenAI GPT 작사 → 가사 검토·수정 → Suno 공식 B2B API 제휴 승인 후 작곡. **개인용 Suno MCP는 개발자 단독 시연용이며 상용 제품 연동으로 간주하지 않는다.**

**중요:** 이 저장소는 개발용 웹앱이다. GPT API 및 Suno OAuth 자격 증명이 없으면 실제 외부 생성은 실행되지 않는다. 서버 배포와 실사용 계정에서의 라이브 생성 성공은 별도로 검증해야 한다. Gemini는 사용하지 않는다.

## WITHU 별도 HTTPS 서버 배포 준비 (현재 코드 기준)

- **Render Blueprint:** 루트 [render.yaml](./render.yaml)과 [Dockerfile](./Dockerfile)을 사용해 Node.js 서버를 따로 배포할 수 있도록 준비했다. 아직 실제 Render 서비스는 개설하지 않았다.
- **서버 기본 화면:** `/` 는 프리미엄 WITHU 음악/가사 사이트, `/studio` 는 추후 정식 작사·작곡 기능용 웹앱 화면을 보여준다.
- **공개 정적 경로:** CSS, JS, 공개 음악/가사, 동의받은 후기 영상만 허용. 서버의 작사 지침·내부 문서·API 키 파일은 웹 경로로 열리지 않도록 허용목록으로 제한한다.
- **음원 재생:** MP3/MP4 요청은 `Range`(206 Partial Content)를 지원해 모바일 Safari에서 구간 이동을 처리할 수 있다.
- **Health check:** `GET /healthz` 는 민감정보 없이 상태만 반환한다.
- **서버 비밀키:** Render 환경변수에서 입력하며 Git/Docker 이미지에 기록하지 않는다.
- **Suno B2B 서비스:** 아직 승인된 제휴 API 인증·엔드포인트·Voice 규격을 받지 못했으므로 상용 음악 생성 어댑터는 미구현이다. 개인용 MCP를 공개 서버에서 사용하지 못하도록 막아둔다.
- **저장소 공개 위험:** 현재 `tlco1003/Song`은 Public이다. 방문자 화면에서 GitHub 링크를 지워도 소스와 커밋 이력은 공개된다. 상업용 내부 코드는 **Private 백엔드 저장소**로 분리하고, 공개 페이지에는 홍보용 정적 파일만 게시해야 진정한 정보 보호가 된다.

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
