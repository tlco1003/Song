# WITHU Business OS — evidence-based progress ledger

Date: 2026-11-14. This file is deliberately non-sensitive because tlco1003/Song is PUBLIC.

## Current work
| Area | Evidence-based status | Evidence / blocker |
| --- | --- | --- |
| Business plan and 90-day goals | DOCUMENTED, NOT VALIDATED MARKET DEMAND | docs/business/OPERATING_PLAN.md |
| AI provider integration contract | DOCUMENTED, NOT LIVE API | docs/business/VIDEO_AGENT_CONTRACT.md |
| Root agent instruction | COMMITTED | AGENTS.md and CLAUDE.md |
| Existing public WITHU frontend | SOURCE PRESENT, LIVE CHECK NOT PERFORMED HERE | docs/index.html, docs/checkout.html |
| Existing price catalog | SOURCE PRESENT, NOT PROOF OF SALES | docs/prices.json |
| Public payment readiness | BLOCKED IN src/commerce.mjs | canCharge false, preserve fail-closed behavior |
| Higgsfield interactive plugin | CONNECTOR-ASSISTED, NOT PRODUCT API | External read-back 2026-11-14 |
| Reel Effects tool | SCRIPTS PRESENT IN EXTERNAL SANDBOX; NO MP4 VERIFICATION | /text-behind /tier-list /glass-graph /captions, etc. |
| InVideo multi-agent support | REFERENCE ONLY | Not connected in current workspace |
| First paid ad order / repeat customer | UNKNOWN / NO VERIFIED RECEIPT REVIEWED | Private sales ledger not connected |
| Neural model training and evaluation | NOT ASSESSED BY THIS AUDIT | Separate SONG-Vision evidence required |

## Change protocol
Each real implementation run must add a dated entry with:
- purpose and exact modified files
- base/ref/commit link
- commands run and actual exit codes
- measured outputs, source of data, external jobs and cost when available (no credentials)
- risks, regressions, privacy/rights gates
- still-blocked items and next owner action

## Entry — 2026-11-14
- Inspected WITHU current default branch, docs/index.html, docs/checkout.html, docs/prices.json, src/commerce.mjs, src/paid-order-pipeline.mjs, src/production-contract.mjs, package.json and existing CI.
- Confirmed code keeps public checkout fail-closed and display price SSOT separate from proposed ad service; no commerce flags changed.
- Added shared agent instructions, business plan, agent pipeline contract, machine-readable capability snapshot, read-only script and GitHub Actions audit (subject to subsequent committed file + CI verification).
- Did NOT submit paid provider generations, enable checkout, perform GitHub Pages deployment, migrate training data, conduct neural model training, or claim earned revenue.
- Next action: run audit and repository tests, inspect CI outcome, validate a user-authorized short MP4 and execute one real B2B sales pilot.

## KPI data availability
No private accounting or actual qualified-lead registry is connected to this file. Revenue, margin, conversion and churn must be reported UNKNOWN until observed records exist. Never create sample sales rows that look real.

## 추가 검증 기록 — 2026-11-14

- 실제 생성 확인: docs/business/index.html (기존 capabilities.json을 읽어 사업 상태를 렌더링하는 모바일 반응형 공개 읽기 전용 화면), scripts/business-ops-audit.mjs, test/business-ops-audit.test.mjs, .github/workflows/business-ops-audit.yml.
- GitHub issue #11(https://github.com/tlco1003/Song/issues/11) 개설: 유료 파일럿, 영상 실측 검증, 라이선스/API 확인, 가격 분리와 회귀 체크리스트. 실제 고객 확보를 뜻하지 않는다.
- 저장소 main의 필수 파일 16개를 GitHub API로 재조회했으며 16/16 존재를 확인했다. capabilities.json의 코드 근거 경로도 모두 존재한다.
- 별도 JavaScript 파서 확인: 비ESM 래퍼 변환 후 사업 감사 스크립트·테스트 파일·대시보드 클라이언트 스크립트의 문법 확인이 PASS였다. 이 검사만으로 Node.js 모듈 실행과 전체 회귀 테스트의 통과가 증명되는 것은 아니다.
- src/commerce.mjs의 canCharge:false 및 integration_pending 표시를 재확인. 상품 가격 식별자 audio, audio_duo, audio_video를 원본 JSON에서 확인.
- **아직 미확인:** GitHub Actions의 실제 완료 결과, npm run check/npm test 전체 실행 성공, GitHub Pages의 새 사업 대시보드 배포/모바일 실기기 접속, 실제 영상 생성·검증, 상업용 Provider API, 고객 결제 및 수익.
- ChatGPT 자동 점검 신규 예약 생성은 계정의 활성 작업 5개 제한으로 실패했으며 기존 예약을 변경하지 않았다. 대신 GitHub Actions의 매일 UTC 00:00 자동 읽기 전용 감사(Asia/Seoul 09:00)를 등록했다. 이 워크플로가 ChatGPT 메시지를 자동 전송하거나 코드 변경을 자동 승인하지는 않는다.
- 동일한 사업/엔진 변경의 새 세션은 AGENTS.md 및 CLAUDE.md를 우선 읽고, 실제 검증에 따라 본 문서와 능력 ledger를 업데이트하도록 요구한다.

## 실제 구현·CI 합격 — 2026-11-14

### 결제 확인 결함 수정
- PR #12: https://github.com/tlco1003/Song/pull/12
- `src/production-payments.mjs`의 무조건 `paid_verified` 반환 오류를 수정하여 신규 pending 주문은 기존 Toss 공식 확인 및 DB 트랜잭션을 통과하도록 변경.
- 검증: `test/production-payments-integration.test.mjs`의 정상 결제·PG 거절·금액 위조·중복 호출·영수증 불일치 테스트. GitHub Actions Node checks run 43525178246, `npm run check` 및 `npm test` 성공. main squash commit `1c74319e4c774f0407c96142ad0251b786aaaf98`.
- 실제 PG 상용 거래나 카드 청구는 실행하지 않음.

### 고객 영상 견적 신청 및 운영자 상담함
- PR #13: https://github.com/tlco1003/Song/pull/13
- 구현: `docs/video-ads.html`, `docs/video-ads.js`, `src/production-video-inquiries.mjs`, `docs/video-ads-admin.js`. `src/firebase-production.mjs`의 **기존 Firebase API 라우터** 및 `docs/admin.js`의 **기존 Firebase 관리자 로그인**에 연결.
- 비공개 Firestore에 상담 요청 저장·하루 3회 네트워크별 제한(HMAC 비식별키)·실제 개인정보/권리 동의·운영자 본인 인증·상담 상태 변경 기능을 추가. `deleteAfter` 필드는 생성하지만 Firestore TTL 정책은 배포 환경에서 따로 설정해야 실제 자동 삭제됨.
- 검증: `test/production-video-inquiries.test.mjs` 포함 GitHub Actions Node checks run 43526058602, `npm run check` 및 `npm test` 성공. main squash commit `2f1ea598b1b53dad25d39b1b3796d0b62491ddf4`.
- 실제 개인정보 처리 공지·사업자·운영자 승인·Firebase 비밀키·서비스 배포 전까지 접수 기능 기본 OFF. 해당 제품은 견적 **상담**이며 카드결제, 자동 완성 영상, 결제 증빙, 유료 고객 확보를 의미하지 않음.
- 향후 기준: 신원·법적 운영정보와 공급자 사용권 확인 → 실제 스테이징 Firebase 배포/접수/운영자 확인 → 파일럿 광고영상 납품 품질 및 원가 검증 → 실제 고객 계약·결제.


## SONG AI 공식 Lyria 3.5 음악 생성 연결 — 2026-11-14 (미배포)

- 개발 브랜치: `feature/lyria-official-music-20261114`, Draft PR #14: https://github.com/tlco1003/Song/pull/14. 본 기록의 변경은 main 병합/라이브 배포가 아닌 별도 브랜치 검증이다.
- 소스: `src/lyria-music-provider.mjs` (Gemini Interactions 공식 Lyria 3.5, MP3 검증), `src/lyria-paid-automation.mjs` (실결제·비공개 사업 이용권 승인문서·곡별 중복방지·GCS 등록), `src/google-drive-private-music-backup.mjs` (선택적인 Workspace 공유 드라이브 비공개 백업), 기존 `src/production-worker.mjs` 및 `src/firebase-production.mjs` 연결, `src/order-status-portal.mjs` 상태 수정.
- 유지: `src/commerce.mjs` fail-closed, `src/production-payments.mjs` PG 서버 확인, `docs/prices.json` 가격 SSOT, `src/production-admin.mjs` 관리자 검수, `src/production-delivery.mjs` 고객 검수 후 Resend 전달.
- 검증: GitHub Actions Node checks https://github.com/tlco1003/Song/actions/runs/43530585061 — `npm run check`, `npm test` 성공. 테스트는 공식 HTTP 요청·미결제/라이선스 차단·MP3 모의 응답·Firestore/GCS·선택적 Drive 백업·중복 방지·주문 작업기 검증으로, 실제 Google API 호출/과금과 실제 MP3는 생성하지 않았다.
- 환경 의존: `GEMINI_API_KEY` / `WITHU_AUTOMATED_MUSIC_PROVIDER=google_lyria` / 비공개 승인 기록 / 실제 Firebase 서비스가 모두 있어야 자동 제작. Google Drive는 공유 드라이브 폴더 및 서비스 계정 추가 구성이 있어야 비공개 백업 실행.
- 고객 완료곡 이메일은 기존 관리자 검수·권리 승인 뒤에만 전송된다. **완전 무인 고객 납품, 실제 Google Drive 업로드, 실 PG 결제, 상업 권리 승인, 실제 배포는 미검증**이다.
- 필수 후속: Google 소비자-facing 유료 음악 납품 약관 명확화; 한국어 가사·실제 음원 품질·서비스 원가 검증; 중단/부분성공 작업의 정산 재조정 및 환불; QA 자동화; 통합 시크릿/실배포 E2E. 외부 서비스 오류에서 암묵적 재과금을 금지한다.


## SONG AI 시대·장르·선호 가수·단일 Google API 통합 확장 — 2026-11-14

- 작업 브랜치 `feature/lyria-official-music-20261114`, 기존 Draft PR #14, `main`은 병합하지 않았음.
- 소스 변경: `docs/create.html`, `docs/create.js`, `docs/checkout.html`, `docs/checkout.js`, `docs/admin.js`, `src/lib.mjs`, `src/order-draft-preparation.mjs`, `src/song-production-plan.mjs`, `src/music-style-library.mjs`, `src/production-worker.mjs`, `src/production-runtime.mjs`, `src/providers.mjs`, `src/artist-style-evidence.mjs`, `src/artist-research-provider.mjs`, `src/gemini-lyrics-provider.mjs`, `functions/.env.example`, `package.json`.
- 연결: 고객의 선호 가수 선택 → 입력/기존 서버 작사 → 곡별 편곡 계획. 서명된 근거가 있는 가수·시대·장르 편곡 특성만 음악 생성 프롬프트에 추가할 수 있으며, 출처가 없는 경우 이름을 음악 생성 모델에 넘기지 않는다.
- 선택적 유료 Google `google_search` 분석은 인용과 후보 상태만 기록하며 승인 전에는 검증된 근거로 승격되지 않는다. 선택적 Gemini 가사는 기존 OpenAI 작사를 유지하는 provider 스위치다. Lyria 음악 생성, Google Drive 후보 백업, 관리자 검수·Resend 고객 발송의 기존 경로를 그대로 유지.
- 실제 회귀 증거: https://github.com/tlco1003/Song/actions/runs/43534136625 — `npm run check`, `npm test` **292/292 통과**, `npm run firebase:prepare` 및 배포 패키지 문법 검사 성공. 기존 실패 `artist newline normalization`은 실제 정규화 순서를 고쳐 해결 (테스트 기대값 완화 아님).
- 별도 문서: `docs/SONG_AI_취향_검색_자동작사_통합API_2026-11-14.md`. 데이터/기존 가격·결제 장벽은 변경하지 않았음.
- **BLOCKED/UNKNOWN:** 실제 Gemini 및 Lyria 키·사용량 과금·사업 권리 허가, 실제 검색 및 출처 검증, 실제 한국어 음원과 가사 일치, 고객 이메일 수신, 새 UI의 GitHub Pages 배포, Google Drive 실업로드, 시네마틱 영상 생성, 무인 권리·음질 출고.


## SONG AI Mureka 공식 API 자동 제작 통합 — 2026-11-14

- 기존 브랜치 `feature/lyria-official-music-20261114`, Draft PR #14. `main` 변경·배포·실제 API 과금 없음.
- 기존 SONG AI 결제·가사·서버 전용 스타일·권리·배송 파이프라인을 수정해 `WITHU_AUTOMATED_MUSIC_PROVIDER=mureka` 공식 공급자 분기 추가. Lyria·수동 음악 업로드·기존 OpenAI/Gemini 작사 선택 유지.
- 신규 코드: `src/mureka-music-provider.mjs` (`n:1`, 비동기 작업ID, 상태확인, MP3 서명 URL/HTTP/실제 MP3 검증, 허용 CDN 호스트 검사), `src/mureka-paid-automation.mjs` (Firestore 금액 중복 생성 방지, 비과금 GET 재조회, 비공개 GCS, 수동 음질·가사·권리 검수), `src/mureka-lyrics-provider.mjs` (기존 작사 정책 기반 같은 API 키), `src/mureka-account.mjs` (비과금 잔액 확인).
- 수정: `src/providers.mjs`, `src/production-worker.mjs`, `src/order-status-portal.mjs`, `src/firebase-production.mjs`, `functions/index.mjs`, `src/production-admin.mjs`, `docs/admin.html`, `docs/admin.js`, `functions/.env.example`, `package.json`. Firebase `pollMurekaMusic`은 Cloud Scheduler 매 2분 작동하도록 소스 작성됨. 운영 Firebase 배포는 미실행.
- 테스트: `test/mureka-music-provider.test.mjs`, `test/mureka-paid-automation.test.mjs`, `test/production-worker-mureka-integration.test.mjs`, `test/mureka-account.test.mjs`. HTTP/API/파일은 모든 케이스에서 가짜 fixtures로 모사; 실제 MP3를 생성했다는 뜻 아님. 이전 신뢰 가능한 GitHub Node checks https://github.com/tlco1003/Song/actions/runs/43553606193 는 **309개 테스트 309 통과, 0 실패**, `npm run check`, `npm run firebase:prepare` PASS. 그 이후의 비용 보호 게이트(`WITHU_MUREKA_AUDIO_HOST_ALLOWLIST` 필수)까지 포함한 최종 HEAD는 후속 CI 결과를 따로 확인할 것.
- 새 코드 동작: 결제 승인 → 고객 선택에 따른 비공개 가사·시대·장르 스타일 → Mureka API에 `n:1`로 과금 작업 단 한 번 등록 → DB 저장된 작업 ID를 Scheduler가 확인 → 실제 MP3 후보를 비공개 저장 → 관리자 검수 → 기존 Resend 고객 전용 링크. 미승인·오류·기존 음원은 자동 생성/고객 송신 차단.
- 신규 문서: `docs/WITHU_MUREKA_공식API_음악자동화_운영_2026-11-14.md`.
- **아직 미완료/외부 의존:** 운영자 본인 MUREKA_API_KEY Firebase Secret 등록, 실제 Mureka API 잔액 진단, 확인된 공급자 CDN 호스트, 비공개 상업적 이용 허가 증빙 및 관리자 권리 승인, Firebase Functions/Cloud Scheduler/Storage·인증·PG/Resend 배포, 실제 한국어 MP3/가사 일치/고객 전달 실측. `src/commerce.mjs` fail-closed 유지. Mureka 영상·스템·보컬 복제는 공식 기능 존재, SONG AI 실연결 아님.


## Firebase 프로젝트 실명 연결 — 2026-11-14 (사용자가 Firebase 콘솔 설정 제공)

- 사용자가 Firebase 콘솔에서 `song` 프로젝트와 웹 앱 `song-withu` 생성 화면의 설정을 공유함. **콘솔에 표시된 사용자 제공 정보로 프로젝트 생성/웹 앱 등록이 확인됨**. ChatGPT의 Firebase 프로젝트 관리자 API 접속 또는 GCP 리소스 실측 확인과는 구분.
- 개발 브랜치에 신규 `.firebaserc` `projects.default=song-cab41` 파일 추가. 기존 `firebase.json`, hosting rewrites, Firestore/Storage 규칙, Firebase functions, GitHub Pages main/배포 상태는 변경하지 않음.
- 사용자가 공유한 Firebase Web SDK의 `apiKey`는 Firebase-only API 제한과 보안 규칙/App Check가 적용될 때 공개 구성 식별자이며 `MUREKA_API_KEY` 같은 서버 비밀키가 아님. 그래도 이 개발 변경에서는 웹 API 키 문자열/개인 비밀을 GitHub에 저장하지 않음.
- 환경값은 운영자가 **로컬 무시된** `functions/.env`에 넣어야 함: `WITHU_FIREBASE_PROJECT_ID=song-cab41`, `WITHU_FIREBASE_AUTH_DOMAIN=song-cab41.firebaseapp.com`, `WITHU_STORAGE_BUCKET=song-cab41.firebasestorage.app`, `WITHU_PUBLIC_BASE_URL=https://song-cab41.web.app/` (이 URL은 배포 전 예상 형식일 뿐 실제 Hosting 사용 가능 여부 미측정); `WITHU_FIREBASE_WEB_API_KEY`는 Firebase 콘솔에서 복사.
- 실제 서비스 준비 미확인: Blaze 요금제·Firestore/Storage 생성·Auth 공급자 및 운영자 UID·Mureka Firebase Secret 등록·실제 Mureka CDN 허용 호스트·PG/Resend·Functions/Scheduler 배포·고객 전달 시험. `.firebaserc`만 생성한 것으로 Firebase 서비스를 개통했다고 주장하지 않음.

## 2026-11-15 — 결제 전 맞춤 음악 환불 정책 게시 준비

- `docs/refund-policy.html` 정책 원문 재작성: 전자상거래법 제17·18조, 시행령 제21조, 제작 착수 전 전액 취소, 법정 예외의 엄격한 요건, 계약 불일치의 별도 철회권, 별도 유료 다운로드 권리, 환급 절차.
- 결제 화면 `docs/payment.html` 정책 요약과 법정 권리 유지 문구·별도 필수 체크박스. `docs/checkout.html` 사전 정책 링크. `docs/checkout.css` 반응형 디자인.
- `docs/payment.js` 정책 동의 누락 결제 진행 차단; `src/production-payments.mjs` 주문 서버에서 동의 버전·승인 상태 검사 및 Firestore 주문별 동의 시각/버전 기록. 정책 동의는 법정 청약철회권 포기가 아님.
- 법원 판례나 경쟁사 규정을 복제하지 않고 국가법령정보센터 원문과 토스페이먼츠 공식 결제 취소 가이드를 근거로 독자 작성. 업계 STIZ 유사 맞춤제작 고지 방식 참조.
- 추가 테스트: `test/refund-policy-contract.test.mjs`. CI 실제 통과 여부는 확인 후에만 보고.
- 실결제 및 자동환급 기능 활성화 없음. 정식 판매 전 실사업자 연락처·고객센터·주문별 착수 증빙·환불 승인 및 PG 취소 API 연결·법적 검토 필요.
