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


## SONG/WITHU 홈페이지 3D 시네마틱 확장 — 2026-11-14

- 목적: 현재 docs/index.html의 음악 플레이어·가사·주문 및 기존 기능을 보존하면서 첫 화면에 실시간 3D 인트로 추가.
- PR: https://github.com/tlco1003/Song/pull/15 (feature/song-cinematic-memory-journey-20261114).
- 추가/수정: docs/cinematic/intro.js, docs/cinematic/intro.css, docs/cinematic/timeline.mjs, docs/index.html, package.json, .github/workflows/ci.yml, test/cinematic-intro.test.mjs, test/cinematic-home-integration.test.mjs.
- 기술: React Three Fiber + Three.js + 커스텀 GLSL 셰이더의 프로시저럴 금속 기차, 창문에서 나오는 기억구슬, 구름 이동, 펼쳐지는 블루프린트형 페이지. 기존 public/create, docs/create.html 및 음악 감상/가격 흐름 유지.
- 테스트 근거: PR #15의 GitHub Actions Node checks run 43568111366에서 npm run check와 npm test 각각 success. 이후 run 43568228561에서 node scripts/business-ops-audit.mjs, npm run check, npm test 모두 success. 새 홈페이지 보존 테스트 추가 후 CI 재확인 필요.
- 미검증: CDN ESM 의존성 로드, 실제 WebGL 브라우저 렌더·모바일 GPU 성능, 실제 광고 원본 프레임과의 정밀 일치. 첨부 MP4 원본을 공개 저장소에 업로드하지 않았으며 기차는 영화 영상 복원 모델이 아닌 프로시저럴 형상이다.
- 보안/서비스: 유료 결제, 고객 전달, 실제 음원 생성 API, SONG-Vision 학습 코드는 수정하지 않음. WebGL 실패/모션 감소 시 기존 사이트로 이동할 수 있는 정적 첫 화면을 유지.
- 후속: PR 최종 테스트 및 병합 후 GitHub Pages 경로/캐시/브라우저·모바일 실제 렌더링 점검, 원본 광고 클립 또는 검증된 3D 모델 정밀 매칭, 프레임 전환 품질 개선.

## 2026-11-15 — 결제 전 맞춤 음악 환불 정책 게시 준비

- `docs/refund-policy.html` 정책 원문 재작성: 전자상거래법 제17·18조, 시행령 제21조, 제작 착수 전 전액 취소, 법정 예외의 엄격한 요건, 계약 불일치의 별도 철회권, 별도 유료 다운로드 권리, 환급 절차.
- 결제 화면 `docs/payment.html` 정책 요약과 법정 권리 유지 문구·별도 필수 체크박스. `docs/checkout.html` 사전 정책 링크. `docs/checkout.css` 반응형 디자인.
- `docs/payment.js` 정책 동의 누락 결제 진행 차단; `src/production-payments.mjs` 주문 서버에서 동의 버전·승인 상태 검사 및 Firestore 주문별 동의 시각/버전 기록. 정책 동의는 법정 청약철회권 포기가 아님.
- 법원 판례나 경쟁사 규정을 복제하지 않고 국가법령정보센터 원문과 토스페이먼츠 공식 결제 취소 가이드를 근거로 독자 작성. 업계 STIZ 유사 맞춤제작 고지 방식 참조.
- 추가 테스트: `test/refund-policy-contract.test.mjs`. CI 실제 통과 여부는 확인 후에만 보고.
- 실결제 및 자동환급 기능 활성화 없음. 정식 판매 전 실사업자 연락처·고객센터·주문별 착수 증빙·환불 승인 및 PG 취소 API 연결·법적 검토 필요.

## 2026-11-15 — 고객센터 이메일 및 문의 게시판 구현

- 고객센터 이메일 `tlco1003@naver.com`을 `docs/refund-policy.html`, `docs/payment.html`, `docs/terms.html`, `docs/privacy.html`, `docs/support.html`에 게시. 메인/주문 페이지에 고객센터 링크 추가.
- 신규: `docs/support.html`, `docs/support.css`, `docs/support.js`: 공개 승인된 질의·답변만 목록 표시, 비공개 기본 문의, 메일 문의 대체 수단, 환불 문의 비공개 강제, 개인정보·공개 동의.
- 신규: `src/production-support.mjs`: 기존 Firebase API/Firestore/관리자 인증 사용, 기본 OFF, 서버 개인정보 동의·원본 텍스트 검증, HMAC 기반 네트워크 일일 제한, 별도 관리 승인 전 공개 금지, 이메일과 환불문의 비공개.
- 신규: `docs/support-admin.js`, 기존 `docs/admin.html`/`docs/admin.js` 관리자 문의함: 실관리자 JWT 검증, 공개 답변 승인·비공개 수동 처리·숨김.
- 설정: `WITHU_SUPPORT_INQUIRIES_ENABLED`, `WITHU_SUPPORT_PRIVACY_REVIEWED`, `WITHU_SUPPORT_OPERATOR_VERIFIED`, `WITHU_SUPPORT_HMAC_KEY` (비공개 Firebase Secret). Firestore TTL `deleteAfter` 준비. `functions/.env.example`에 사후 운영 필요 구성 표기.
- 신규 테스트: `test/support-board.test.mjs`에서 개인정보 누출·비공개·승인·일일 제한 검증. Node syntax check에 신규 모듈 포함.
- **주의:** GitHub Pages는 정적 웹사이트여서 문의 양식 접수 불가. 고객 이메일은 작동 가능하고, Firebase Hosting/Functions 배포 및 비공개 운영 가드 활성화 전까지 게시판은 공개 UI와 이메일 대체 안내만 제공. 90/365일 TTL 필드는 실제 Firebase 정책으로 활성화하기 전까지 자동 삭제 보장 아님. 실제 자동 답변 메일·PG 환불 기능은 구축하지 않음.
