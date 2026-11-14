# SONG AI — Mureka 공식 API 기반 자동 노래 제작·검수·납품 파이프라인
작성: 2026-11-14
상태: **개발 브랜치 코드 구현, 실제 공급자 과금/배포 미실행**
작업 브랜치: `feature/lyria-official-music-20261114` (Draft PR #14)
대상 기존 엔진: `tlco1003/Song`; 기존 Firebase/Toss/Resend/제작 프롬프트·고객 보관 로직 유지.

## 새로 추가한 실제 구현 파일

- `src/mureka-music-provider.mjs`: 공식 `POST https://api.mureka.ai/v1/song/generate`/ `GET https://api.mureka.ai/v1/song/query/{task_id}`. `model: mureka-9.5`, 반드시 `n:1`, `stream:false`, 정확한 가사 `lyrics`와 1000자 이하 기존 서버 스타일 `prompt` 사용. 응답 상태 `preparing|queued|running|streaming|reviewing|succeeded|failed|timeouted|cancelled` 검증. URL은 검증된 CDN 정확한 HTTPS 호스트 allowlist를 통과한 뒤 MP3 헤더·크기·콘텐츠형식 검사 및 제한된 스트림 다운로드. 공급자 키는 CDN에 전송하지 않음.
- `src/mureka-lyrics-provider.mjs`: Mureka 공식 `POST /v1/lyrics/generate`를 기존 작사 정책 안에서 선택 가능. 원래 OpenAI/Gemini 작사 공급자 삭제하지 않음. 최종 작사 출력은 기존 Verse/Chorus·길이·내용 정책으로 검증.
- `src/mureka-paid-automation.mjs`: 기존 결제 승인 주문의 작업을 주문별·곡별 `withuMusicJobs/{orderId}_{index}` Firestore에 먼저 원자적으로 등록하고 **그다음에만** 과금되는 생성 POST. 중복 POST/상태 불명 결과 자동 재시도 없음. 작업 ID 저장 → 비과금 GET 상태 조회 반복 → 비공개 GCS `orders/{orderId}/tracks/...` 저장 → `reviewed:false` / `rightsVerified:false` 후보 등록. 실패하면 원본 후보 보존, 운영자 정합성 검토, 고객 발송 금지. GET 네트워크 장애만 제한된 횟수로 재시도.
- `src/production-worker.mjs`: 기존 verified-payment → 작사 → 비공개 스타일 → 음악 제작 분기 안에 `mureka` 공급자 추가. 기존 Lyria와 수동 제작을 유지.
- `src/firebase-production.mjs` + `functions/index.mjs`: Mureka 공식 API Secret을 기존 worker/api에 연결. Cloud Scheduler `pollMurekaMusic`이 서버에서 2분마다 알려진 비동기 작업만 조회하고 MP3를 저장. **사용자 브라우저를 닫아도 서버가 진행**. Scheduler가 음악 생성 POST를 하지 않는다.
- `src/order-status-portal.mjs`: 생성 진행 중인 상태를 고객에 노출하되 스타일/키/외부 CDN MP3 URL은 미공개.
- `src/mureka-account.mjs`: 고객 결제·음원 생성 없는 공식 `GET /v1/account/billing` 계정 인증·남은 센트 잔액·동시 요청 수만 반환. 계정 ID·API 키는 반환하지 않음.
- `src/production-admin.mjs`, `docs/admin.html`, `docs/admin.js`: 인증된 Firebase 운영자 UID만 계정 연결 상태를 볼 수 있는 `GET /api/admin/providers/mureka/account`와 버튼 추가. 실제 Firebase Hosting에서만 작동. 공개 GitHub Pages에는 서버 API 없음.
- `package.json`, `functions/.env.example`: 문법·운영 설정/비공개 Secret 경로 추가.

## 실제 Firebase에 사용자만 등록할 설정

1. Firebase 프로젝트, Firestore, Storage, Functions, Firebase Hosting, Firebase Authentication, Cloud Scheduler가 필요. Firebase CLI가 설치되어 있지 않으면 Node.js 설치 후 `npm install -g firebase-tools`, `firebase login` 및 프로젝트 연결. 기존 Firebase 프로젝트를 재사용하며 **별도 배포는 아직 하지 않음**.
2. `firebase functions:secrets:set MUREKA_API_KEY` 실행하고 발급받은 키는 프롬프트에만 비공개 입력. 파일/HTML/GitHub/채팅에 기록 금지.
3. `functions/.env` (비공개, .gitignore 관리)에:
   ```env
   WITHU_LYRICS_PROVIDER=mureka
   WITHU_AUTOMATED_MUSIC_PROVIDER=mureka
   WITHU_MUREKA_AUDIO_HOST_ALLOWLIST=CONFIRMED_MUREKA_AUDIO_HOST
   ```
   제공사 응답의 `choices[0].url` 호스트가 실제 Mureka 제공사 소유 도메인인지 **먼저 확인**한 후 등록. 자동 임의 CDN 접근/SSRF 허용 금지. URL 자체는 출력되더라도 고객 공개나 GitHub 저장 금지.
4. 개인 operator Firestore `withuProviderApprovals/mureka`에 실증빙 기반 권리 승인 레코드:
   ```json
   {
     "providerId":"mureka",
     "model":"mureka-9.5",
     "status":"approved",
     "verifiedByUid":"<WITHU_ADMIN_UID>",
     "verifiedAt":<검증 시각 epoch ms>,
     "validUntil":<승인 만료 epoch ms>,
     "allowedUseCases":["customer_specific_paid_music_delivery"],
     "privateEvidenceRef":"private/legal/<검토한 계약 증빙 ID>"
   }
   ```
   **주의:** 위 토큰은 설명용 플레이스홀더. 실제 증빙·관리자 인증 없이 레코드를 허위 작성해선 안 됨.
5. 기존 실제 Toss/Resend/Firebase 이메일·Storage 설정, 승인된 PG 및 고객 권한을 유지. publicCommerceReadiness `canCharge=false`를 임의로 true 변경하지 않음.
6. `npm run check && npm test && npm run firebase:prepare && node scripts/business-ops-audit.mjs` 통과 후 운영자 승인을 받아 staging/Firebase 배포. **실제 배포, 상업적 판매, 크레딧 소비는 이번 작업에 없음.**
7. 배포 후 Firebase admin 로그인에서 ‘Mureka API 연결 확인’을 눌러 실제 키·잔액 확인. 첫 유료 호출은 본인 승인·제한 비용·검증된 계정·실제 상업 사용권 확보 후 한 곡만 생성해 응답 스키마·MP3 다운로드·가사 일치·이메일을 실측.

## 신규 AI 추가 구독 여부

**필수 새 AI 모델 없음.** Mureka 구매 API 키 하나로 자체 가사 생성, 음악·편집·악기 분리·음악비디오 API 호출 가능. 단, 지금 코드는 가사 + 완성곡 + 서버 저장만 실제 연결했으며, 음악비디오 생성·음색 복제·stem 분리·수정 등의 API는 공식 지원 사실과 SONG AI 연결 완료를 혼동하지 않는다.

별도 종속 시스템(기존/설정 필요): Firebase (서버/DB/저장/예약/인증), Toss Payments (정식 결제), Resend (메일), 도메인·사업/약관·PG 승인. 시대·장르·가수 특징의 검색 근거를 자동 조회하려면 기존 선택적 `GEMINI_API_KEY` Google Search Grounding 기능을 별도 사용량 과금으로 연결하거나 출처 검증된 비공개 데이터를 등록한다. **검색형 AI는 필수가 아니라 추가 선택사항**.

영상: Mureka가 공식 Music Video 및 Lyrics Video API를 제공하나 최종 MP4 제작과 SONG-Vision 3D 립싱크 코드 연동은 이번 범위 밖. Higgsfield 별도 구독은 음악 판매 MVP에 필수 아님.

## 진실성, 보안 및 미완료

- Mureka 공식 유료 API FAQ는 생성물의 상업적 이용을 허용한다고 안내. 정확한 주문/재판매/원본 납품 범위는 계정·계약 증빙과 고객 약관을 별도 확인할 것.
- `n` 기본값은 2이며 생성 수대로 청구되므로 실제 코드는 `n:1` 강제.
- Song generation is **async**: 작업 ID는 음원 ID가 아니며 완료 `succeeded`의 `choices[0].url`로만 MP3 가져옴.
- 비공식 Suno 계정 쿠키/세션 우회 없음. API 키와 고객 개인정보를 GitHub Pages/다운로드 URL에 노출하지 않음.
- 테스트는 계약 수준 가짜 HTTPS 응답과 MP3 fixture. **실제 Mureka 키 인증, 실제 음악 생성, 2분 Scheduler 운영, Storage에 실MP3 저장, 고객의 실제 메일 수신, 상업 계약·품질·비용 측정 미실시**.
- 기존 서버 비밀키 바인딩 구조 때문에 Mureka 하나로 작사·작곡하더라도 Firebase 배포 전에 기존 함수 Secret 의존성 확인이 추가로 필요할 수 있음.

## 직접 확인한 공식 자료

- https://platform.mureka.ai/docs/en/quickstart.html
- https://platform.mureka.ai/docs/api/operations/post-v1-song-generate.html
- https://platform.mureka.ai/docs/api/operations/get-v1-song-query-%7Btask_id%7D.html
- https://platform.mureka.ai/docs/api/operations/post-v1-lyrics-generate.html
- https://platform.mureka.ai/docs/api/operations/get-v1-account-billing.html
- https://platform.mureka.ai/docs/en/faq.html
- https://platform.mureka.ai/docs/en/changelog.html
