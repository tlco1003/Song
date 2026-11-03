# SONG — 공식 Suno API · MCP · 내 목소리(Voices) 연동 조사 및 실행 지시서

> 확인일: 2026-11-03 (Asia/Seoul)  
> 적용 저장소: `tlco1003/Song`  
> 목표: **사용자가 자신의 사연을 GPT로 가사화하고, 본인이 녹음·인증한 목소리로 Suno에서 노래를 만드는 웹앱**  
> 상태: 공식 기능 **확인** / SONG 내 Voice 프로필 생성·선택·가창 **미구현·미검증** / 외부 사용자의 유료 서비스 제공 권한 **확인 필요**

## 0. 중요: 개인용 음악 생성과 SONG 상업 사업은 권한이 다르다

Suno 유료 플랜은 본인 계정에서 생성하는 음악의 일부 상업 활용 권리를 제공하지만, 그 자체로 타인 고객에게 **Suno 기반 유료 음악 생성 서비스**를 운영할 권한이나 공식 REST API 개발자 권한을 보장하지 않는다.

**Suno 이용약관에는 Suno와 경쟁하는 음악 생성 제품·서비스를 개발·운영하기 위해 Output 또는 Voice Model을 쓰는 행위 등에 대한 제한이 있다.** 또한 생성곡 상업 사용에는 Suno가 허용한 다운로드 경로로 받은 결과물 등 별도 조건이 적용된다. 따라서 SONG처럼 고객이 돈을 내고 노래를 주문하는 웹서비스를 공개하기 전에는 **Suno 측 서면 사업용 API/재판매/내목소리 사용 권한**을 확보해야 한다. 어떤 방식으로 제공하면 계약상 허용되는지 미리 확인한다. 이것은 법률 자문이 아니며 전문 법률 검토가 필요하다.

1차 목표는 개발자 본인 계정으로, 정식 기능을 통해 **개인 테스트**한다. 무단 계정 공유·타인 명의 Voice 생성·세션 쿠키 자동화·비공식 제3자 API 우회는 금지한다.

공식 약관: https://suno.com/terms  
공식 API 포털: https://platform.suno.com/

## 1. 공식 API와 인증 경로 — 이 둘을 혼동하지 말 것

| 경로 | 실제 공식 URL | 무엇을 하는가 | 인증/접근 | 확인된 범위 |
| --- | --- | --- | --- | --- |
| **Suno MCP (Beta)** | `https://api.suno.com/mcp` | ChatGPT, Claude, Claude Code 등 MCP 클라이언트와 Suno 계정을 연결해서 음악 생성·업로드·편집 | Suno 계정 OAuth 로그인. 별도 API 키 불필요. 생성에 Suno 크레딧 사용 | 공식 안내 및 제품 페이지에서 검증 |
| **Suno REST API 플랫폼** | `https://platform.suno.com/` | 외부 앱 서버에서 사용하는 음악 생성 REST API 계정 관리 | Suno 계정과 연동된 Google 로그인 또는 이메일 코드, **API 접근 권한은 별도** | 공식 로그인 페이지 확인. 공개 페이지에서는 키 발급·음성 관련 엔드포인트 상세 규격 미확인 |
| **Suno Voices** | `https://suno.com/ko/voices` | 자신의 Voice 프로필을 등록해 본인 음색으로 가창 생성 | Suno 사용자 계정, **본인 확인**, 지역/연령 조건 | 공식 제품 페이지·도움말 검증 |

**발급·연결을 어디서 하나?**
- 개인용 Suno MCP는 https://suno.com/mcp 에서 연결 안내를 보고 `https://api.suno.com/mcp`를 MCP 클라이언트에 등록한 뒤 **Connect Suno**를 눌러 인증한다.
- Claude Code: `claude mcp add --transport http suno https://api.suno.com/mcp` → Claude Code 세션의 `/mcp` → Suno 로그인·동의.
- ChatGPT: **Plugins → Add → Add custom MCP server** → `Suno` / `https://api.suno.com/mcp` → **Create as a plugin → Connect Suno**.
- 웹앱의 별도 REST API 개발자 계정은 https://platform.suno.com/ 에서 접근 여부를 확인한다. 이미 유료 플랜이어도 REST API 권한은 자동으로 주어지는 것이 아니다. 접근 불가라면 Suno 공식 사업·파트너 채널에 신청한다.
- `suno-api.io` 등 제3자 URL은 **Suno 공식 회사 도메인이 아니다.** SUNO REST 키를 찾는다며 제3자 키를 등록하지 말 것.

공식 자료:
- https://suno.com/mcp
- https://help.suno.com/en/articles/14551425
- https://help.suno.com/en/articles/14486145
- https://help.suno.com/en/articles/14551361
- https://platform.suno.com/

## 2. 공식 Voices: 내 목소리 등록 절차 (현재 Suno 앱에서 사용 가능)

**공식적으로 확인된 순서**
1. 사용자가 Suno `Create`(https://suno.com/create)에서 `Add Voice` → `Create Voice`를 선택한다.
2. 직접 **노래하거나 말하는 음성을 녹음**, 기존 자기 음성 파일을 업로드, 또는 자기 목소리가 들어간 라이브러리 곡을 선택한다.
3. 공식 도움말의 녹음·업로드 길이는 **15초~4분**이며 그중 좋은 **최대 2분**을 선택할 수 있다. 가능한 **반주 없는 조용한 녹음**이 품질에 유리하다. 반주가 있는 음성은 Suno에서 스템 분리할 수 있다.
4. Suno가 표시하는 문장을 사용자가 직접 읽어 **본인 확인**한다. 음성 동일성뿐 아니라 표시된 문장 발화도 검증한다. 자동으로 우회하거나 타인의 목소리를 등록하지 않는다.
5. 선택적 프로필 항목: 보컬 실력 수준(`skill level`), 프로필 이름·이미지. 자신의 음성 사용 권리가 있음을 확인하고 저장한다.
6. `Create`에서 기존 Voice를 선택하고 **가사, Style of Music, 제목**을 입력한 뒤 Voice 호환 모델을 선택해 생성한다. `Audio Influence`를 조정해 유사도를 비교한다.
7. 앱·지역·계정·모델에 따라 버튼이나 사용 가능 모델이 달라질 수 있다. Voice 모델 버전은 **실제 Suno UI와 최신 가이드 기준으로 검증**한다. 오래된 FAQ의 v5.5 권장과 최신 v6 모델 안내가 혼재하므로 버전을 코드에 하드코딩하지 않는다.

**제한·주의**
- Voices 기능은 공식 도움말상 **만 18세 이상**만 사용 가능하며 지역별 제공이 다를 수 있다.
- 제품 페이지는 Pro·Premier와 Free 일부 제한적 접근을 안내한다. 유료 플랜이라도 사용자 계정에서 실제로 사용 가능한지 확인해야 한다.
- Voice 프로필은 본인만 새 노래 생성에 사용하는 것이 원칙이다. 다만 **생성곡을 공유하면서 리믹스/커버를 허용**하면 목소리가 포함된 결과물이 다른 사람의 리믹스에 쓰일 수 있으므로 공개·리믹스 설정을 주의한다.
- **녹음 → 고급 가수처럼 자동 발성 향상**은 공식적으로 보장된 것이 아니다. 음색 유사도, 고음, 한국어 발음, 호흡, 악곡 표현력을 실제 음원으로 청취·평가해야 한다.
- 15초만으로 누구나 전문 가수 수준의 가창을 얻는다고 광고하지 않는다. 장르나 발음에 맞춰 여러 녹음 샘플과 출력 결과를 비교한다.

공식 자료:
- https://suno.com/ko/voices
- https://help.suno.com/en/articles/11362369
- https://help.suno.com/en/articles/11362433

## 3. 공식 MCP에서 Voices에 대해 **확실히 확인된 것**과 아직 모르는 것

공식 Suno MCP 제품 페이지(https://suno.com/mcp)는 **"Use your Voice"** 기능으로, Suno에 **이미 등록된 Voices를 AI로 만든 곡에 적용**할 수 있다고 안내한다. 이는 SONG의 핵심 목표와 맞는다.

그러나 다음은 현재 공개 문서만으로 **확인되지 않았다**:
- MCP로 **새 Voice 만들기**(녹음 업로드 → 본인 인증 → 프로필 생성)의 전체 과정을 자동화할 수 있는지
- MCP의 구체적인 Voice 관련 **툴 이름, 입력 파라미터, Voice ID/선택 스키마**
- 외부 REST API의 Voice 생성·선택 엔드포인트와 상업 이용 계정별 허용 범위
- SONG 사용자 각각의 OAuth를 통한 다중 사용자 Voice 자산 접근 정책
- Suno MCP의 음악 생성 성공 응답에 Voice 사용 정보가 어떤 필드로 반환되는지

**이 규격들은 공식 인증된 MCP 클라이언트에서 도구 목록(`tools/list`)을 조회하고 테스트 결과를 기록하기 전까지 코드에 이름이나 인자를 지어 넣지 않는다.** 사용자가 기존에 인증된 자신의 Voice를 선택하여 만드는 경로를 첫 프로토타입으로 하고, 신규 Voice 등록은 일단 Suno 앱에서 직접 수행하는 수동 단계로 둔다.

## 4. SONG 목표 파이프라인 (GPT 작사 + 공식 Suno MCP + Voice)

1. **사연 입력:** 기존 다섯 질문을 유지. `recipient`, `memory`, `message`, `gratitudeApology`, `occasion`, `recipientAgeGroup`, `relativePosition`, `speechStyle`, `genre`, `mood`, `lyricLength`.
2. **OpenAI GPT 작사:** `가사 프롬프트.md`의 편지 말투·기승전결·상대 수고에 대한 감사·심정 헤아리기·절제된 수식을 적용. Gemini 사용 금지.
3. **승인된 가사:** 사용자가 특정 가사를 수정·확정한다. 모델이 마음대로 사연의 사실을 바꾸거나 호칭을 변경하지 않는다.
4. **음악 스타일 설계:** 장르와 가사 구조에 따라 악기, 선율·강약, 보컬 표현을 설계하고 Suno Style of Music을 구성한다. 가사 원문과 별도 필드로 유지한다.
5. **가창 선택:** `suno-default-voice` / `my-verified-suno-voice`. 후자는 **Suno 본인 인증이 완료된 Voice만 선택**. Voice 이용 불가 시 조용히 기본 보컬로 변경하지 않고 이용자에게 알린다.
6. **개인 인증 테스트:** 사용자 Suno 계정에 연결된 공식 MCP로 실제 이용 가능한 Voices 목록·선택 방법을 확인하고 승인된 Voice를 선택해 작곡한다. 크레딧이 소모될 수 있음을 분명히 고지한다.
7. **결과 확인:** 생성 상태, Suno 라이브러리 곡 ID/링크, 선택 Voice 사용 여부, 실제 가사 일치 정도, 발음과 음색 유사도, 오디오 재생·다운로드 가능 여부를 별도 체크한다. 반환되지 않은 값은 만들어내지 않는다.
8. **상업화 단계:** 각 고객이 자신의 Suno 계정과 Voice를 연결할 수 있는 허가된 OAuth 경로 및 사업용 API 계약을 확보한 이후 서버 자동화를 구현한다. 본인 계정 하나를 여러 고객이 공유하는 방식은 권리 확인 전 사용 금지.

**현재 코드 상태:** `src/providers.mjs`에는 GPT 작사 + 공식 Suno MCP 음악 생성 경로가 있다. `public/app.js`에는 아직 사용자 Voice 선택·등록·인증 UI가 없고, `src/lib.mjs` / MCP 호출에도 특정 Voice 지정 규격이 연결되지 않았다. **작곡 버튼이 존재한다고 내 목소리 기능이 완성된 것은 아니다.**

## 5. 클로드 코드 / 엔지니어 실행 지시 (증빙 없는 가짜 완료 금지)

### P0 — 도구·계정·법적 접근 확인
- 공식 Suno MCP 사용 가능 계정으로 Claude Code `/mcp` 로그인. **가용 tool 이름·설명·입력 스키마**를 인증된 MCP 세션에서 조회해 저장한다. 보안 토큰은 절대 로그/문서/커밋하지 않는다.
- Voice 조회/선택이 실제로 존재하는지, 선택한 Voice로 음악 생성이 가능한지 **본인 Voice로** 확인한다.
- REST 플랫폼(https://platform.suno.com/) 로그인 후 **실제 API 접근·API 키/테스트 자격·Voice 스키마**를 확인한다. API 키가 보이지 않으면 '권한 미확보'로 보고한다.
- SONG의 유료 상업 서비스화 가능 여부, 고객별 Voice 처리·데이터 보존·생성곡 재판매/다운로드에 대한 Suno **서면 사업용 허가**를 확인한다.
- P0 실패 시 P1을 가짜 MCP 예제로 완료 처리하지 않는다.

### P1 — 인증 및 음성 기능 설계
- Suno 계정 OAuth 연결·해제(실제 제공 범위에서), Voice 목록 및 선택 UI, 본인 확인 상태, 만 18세 이상 확인 흐름, 지역 미지원 안내를 설계한다.
- 신규 Voice 등록 API가 확인되지 않은 상태에서는 Suno `Create → Add Voice`로 이동하여 **사용자가 직접 등록·인증**하도록 안내하는 기능만 구현한다.
- 고객별 데이터 분리, 음성 샘플/프로필 보관 및 삭제·동의 이력, OAuth 상태 재확인, 서버 비밀 보관, 과금 제한을 설계한다.
- 같은 입력에서 `기본 AI 보컬`과 `인증된 내 목소리 보컬`을 비교하도록 한다. Voice 선택 미지원이라면 실패를 안내한다.

### P2 — 실제 생성·QA
- 본인 목소리로 한국어 발라드 한 곡을 만들어 본다. 동일 가사로 기본 보컬 곡도 생성해 비교한다.
- 대상 검증: 단어·받침 정확성, 악기 소리와 보컬 균형, 음색 유사도, 고음 왜곡, 호흡, 비브라토, 선택한 Voice의 실제 적용 여부, 크레딧 소모.
- 실제 생성 오디오·Suno 라이브러리 링크·사용된 도구 이름·모델·실패 로그(개인정보·토큰 제거)로 PASS / FAIL을 결정한다.
- 보유 모델 기능이 변경되거나 해당 지역에서 Voices가 제공되지 않을 경우, 기능을 비활성화하고 변경사항을 문서화한다.

## 6. 반드시 별도 확인할 질문 (Suno에 문의)

1. SONG과 같은 **고객 대상 유료 맞춤 노래 생성 웹서비스**에 공식 REST API/MCP를 사용해도 되는가? 별도 파트너 계약이 필요한가?
2. 고객이 자기 Suno 계정으로 OAuth 인증해 자기 Voice로 노래를 생성하는 흐름이 허용되는가?
3. 공식 MCP에서 기존 Voice를 나열·선택해 **가사와 스타일로 새 노래를 생성하는 tool**의 정식 이름·스키마는 무엇인가?
4. 신규 Voice 프로필 등록·음성 샘플 업로드·본인 인증을 **공식 REST API나 MCP로 자동화**할 수 있는가?
5. 상업용 다운로드, 콘텐츠 재판매·고객 전달, 음성권·보관·삭제 요구에 적용되는 계약 범위는 무엇인가?
6. 연결된 Voice와 음악 제작의 크레딧 과금·동시 생성 제한·다운로드 할당량은 어떻게 적용되는가?

## 7. 출처 (1차 공식 자료 우선)

- Suno API 포털: https://platform.suno.com/
- Suno 공식 MCP 제품: https://suno.com/mcp
- Suno MCP 연결 방법(2026-10-28 개정): https://help.suno.com/en/articles/14551425
- Suno MCP 기능 설명(2026-10-28 개정): https://help.suno.com/en/articles/14551361
- Suno MCP FAQ(2026-10-28 개정): https://help.suno.com/en/articles/14486145
- Suno Voices 공식 제품: https://suno.com/ko/voices
- Voices 실제 사용 방법(2026-05-01 개정): https://help.suno.com/en/articles/11362369
- Voices FAQ(2026-03-26 개정): https://help.suno.com/en/articles/11362433
- Suno 이용약관 (현행 확인): https://suno.com/terms
