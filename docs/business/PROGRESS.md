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
