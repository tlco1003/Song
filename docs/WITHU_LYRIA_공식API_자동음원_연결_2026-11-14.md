# WITHU — 공식 Google Lyria 3.5 연결, 결제 후 자동 생성 후보 / 운영 경계

작성: 2026-11-14 · 실험 브랜치: `feature/lyria-official-music-20261114`

> 이 문서는 실제 추가한 **서버 코드**와 아직 검증하지 못한 **외부 서비스**를 구분한다.
> GitHub Pages는 정적 사이트이며 서버에서 유료 음악을 만들지 않는다. Firebase Functions가 운영 백엔드이다.
> 실제 Lyria 음악 생성 요청, PG 실거래, Google Drive에 대한 실제 파일 업로드, 고객 수신함 전달은 이 작업에서 수행하지 않았다.

## 1. 공급자 선택에 대한 근거

- Google Lyria 3.5: 공식 Gemini Interactions REST API `POST https://generativelanguage.googleapis.com/v1beta/interactions`, 모델 `lyria-3.5`. `input` 문자열에 스타일·확정 가사 포함, 응답 `steps[].content[]`의 `type=audio` 블록 Base64 MP3를 디코딩. 공식: https://ai.google.dev/gemini-api/docs/music-generation
- Google 약관: 전문/사업 목적 개발과 서비스 지역·연령 및 출력물 이용 제한 확인. 저작물 소유권 불주장과 **고객 대상 재판매/배포권 확보는 서로 다르다.** 실제 SONG AI 고객 유료 납품 허용 범위를 법무/서비스 제공자에게 확인해 서면 기록할 것. https://ai.google.dev/gemini-api/terms
- MiniMax: 2026-08-20 이후 신규 사용자에게 음악 생성 유료 API 제공 제한 공지. https://platform.minimax.io/docs/guides/music-generation
- 비공식 Suno 쿠키/브라우저 조작 래퍼는 기본 기능에서 제외: https://github.com/gcui-art/suno-api

## 2. 기존 엔진 연결한 위치

| 기존 경로 | 추가 연결 | 실제 실행 조건 |
|---|---|---|
| `src/production-payments.mjs` | 수정 없음 | Toss 결제 결과를 서버에서 검증한 주문만 `paid` |
| `src/production-worker.mjs` | 작사·서버 비공개 장르 스타일 이후 자동 생성 분기 | `WITHU_AUTOMATED_MUSIC_PROVIDER=google_lyria`, 실제 결제 확인, 유효한 비공개 승인문서, API 비밀키 |
| `src/lyria-music-provider.mjs` (신규) | Google 공식 API로 실제 MP3 Base64 생성·검증, 25 MB 상한 | 외부 호출은 한 번만. 오류/타임아웃에 중복 과금 재시도 없음 |
| `src/lyria-paid-automation.mjs` (신규) | 곡별 Firestore unique 작업 선점 → API → 기존 Firebase Storage `orders/{orderId}/tracks/*` 파일 → 기존 주문 `tracks[]` 갱신 | 후보는 `reviewed:false,rightsVerified:false` |
| `src/order-status-portal.mjs` | `awaiting_review` 상태를 고객에게 제작 검수 중이라고 표시 | 비공개 스타일·원본 음원 노출 없음 |
| `src/production-admin.mjs` | 기존 검수·권리 확인·제목·가사 승인 과정 그대로 사용 | 관리자 인증 후 승인 |
| `src/production-delivery.mjs` | 기존 Resend의 사적 감상 링크 전송을 그대로 사용 | 실제 검수·권리 확인 후 관리자 발송 |
| `src/firebase-production.mjs` | 결제 후 Firebase 트리거에 Storage 버킷과 Gemini secret 연결 | 실제 Firebase 배포는 별도 |

**유료 주문 → 자동 가사 → Lyria 후보 MP3 → 비공개 저장까지 자동 경로를 연결했다.**
**품질·권리 검수 → 이메일 발송은 의도적으로 기존 인증된 관리자 경로다.**
이는 최종 고객 발송까지 완전 무인 자동화가 완료되었다는 뜻이 아니다.

## 3. 절대 우회하지 않을 제약

1. `src/commerce.mjs`의 `canCharge:false`, 가격 SSOT `docs/prices.json`, PG 금액/키 검사 유지.
2. `docs/create.html`에 가사·작곡 Style 원문이나 Gemini API 키를 보여주지 않음. 가사는 기존 결제 후 자동 작사 계약을 우선.
3. 자동 음악 생성은 **문서화된 실제 유료 납품 권리 검토**를 마친 Firebase의 `withuProviderApprovals/google_lyria` 기록이 있어야 호출. 운영자 UID, 모델/용도, 검토·유효 기간, 비공개 권리 문서 참조를 확인함. Firestore 기록은 법적 권리 자체가 아님.
4. 작업을 외부로 전송하기 전에 `withuMusicJobs/{orderId}_{index}`를 `create`로 선점. 복구가 불명확하면 자동 재생성 대신 관리자가 청구·산출물을 확인.
5. MP3 헤더/크기 확인은 **파일 형식 검사**일 뿐 실제 한국어 가사 일치·음정·보컬 음질·저작권 검사 합격이 아니다. 외부 생성 후보는 자동 승인되지 않음.
6. 고객별 파일은 비공개 Storage에 저장. Google Drive를 공용 링크로 개방하지 않음.
7. 가사·고객 정보·API 키·서비스 계정·개인 오디오 원본은 공개 git에 넣지 않음.

## 4. 운영 활성화 전 설정 (운영자만)

- `functions/.env.example` 참조해 Firebase Functions 비밀 `GEMINI_API_KEY` 설정. 이 값은 GitHub Pages JS에 넣지 않는다.
- `WITHU_AUTOMATED_MUSIC_PROVIDER=google_lyria` 는 **배포 설정**이고, 이것만으로 음악을 만들 수 없다.
- 운영자 인증 UID와 연결된 비공개 `withuProviderApprovals/google_lyria` 문서를 사용 승인 증빙 검토 후 만들어야 한다. 필수 필드: `providerId`, `model`, `status`, `verifiedByUid`, `allowedUseCases`, `privateEvidenceRef`, `verifiedAt`, `validUntil`. 실제 증빙은 안전한 비공개 저장소에 보존.
- `GEMINI_API_KEY`, Firebase Storage, Firestore, Toss 테스트 PG, Resend 도메인 및 키가 구동하는 환경에서 1건씩 비용 승인된 E2E 테스트.
- Google 약관에서 18세 미만 접근·지역 및 소비자용 고객 앱의 허용 범위를 별도 확인.

## 5. 테스트와 미완료

추가 단위 검사:
- `test/lyria-music-provider.test.mjs`: 공식 REST 형식, 한글 가사·스타일 포함, 미결제 차단, MP3 무결성, 중복 청구 방지형 타임아웃.
- `test/lyria-paid-automation.test.mjs`: 권리 증빙 만료·누락, 개인정보 노출 없는 저장, 단일 작업, 재시도 방지.

**추가 개발 필요:**
- Lyria 실제 API 자격/유료 생성 응답·한국어 가사 충실도·음질·비용 실측, 테스트 PG 주문 1건과 이메일 수신함 E2E.
- 부정확한 가사 생성 시 고객 재생성/검수 UI 및 정식 작업 재조정/환불 정책.
- 완전 무인 품질 출고가 필요하면 실제 음성 분리/ASR 정렬/가사 대응률과 품질 기준을 검증하고 인간 승인과 동등한 근거를 기록하는 별도 QA 절차 필요.
- Google Drive 비공개 백업 **코드 연결 완료(옵션, 실제 업로드 미검증)**: `src/google-drive-private-music-backup.mjs`가 Firebase Storage 저장 직후 업로드를 시도하고 성공 파일 ID 또는 실패 사유를 곡별 작업에 기록. 실제 사용하려면 `WITHU_DRIVE_BACKUP_ENABLED=true`, `WITHU_DRIVE_FOLDER_ID` 및 Firebase Secret `WITHU_DRIVE_SERVICE_ACCOUNT_JSON` 필요. Google Workspace Shared Drive에서 서비스 계정 권한을 먼저 검증할 것. 개인 Google 계정의 My Drive는 서비스 계정 소유권·저장 할당량 문제로 동일하게 처리할 수 없음. 업로드 실패는 원본 GCS와 고객 검수를 중단하지 않으며 백업 재시도/삭제 동기화는 아직 미구현.
- Firebase 배포·외부 키와 권리 기록은 실제 소유자가 승인해야 하며 공개 GitHub Pages는 그대로 정적 웹사이트다.

## 6. 검증 명령

```sh
node scripts/business-ops-audit.mjs
npm run check
npm test
npm run firebase:prepare
```

실제 외부 음악 생성 및 고객 이메일은 부작용/비용이 있으므로 위 테스트가 자동으로 호출하지 않는다.
