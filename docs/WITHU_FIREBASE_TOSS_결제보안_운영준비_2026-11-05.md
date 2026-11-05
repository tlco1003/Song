# WITHU Firebase + TossPayments 안전 결제 연동 및 출시 체크리스트
작성: 2026-11-05 · 작업 브랜치: `feature/withu-firebase-payment-safety-20261105`

> **현재는 실결제 비활성**. 승인된 실제 결제·실제 PG 연결·운영 메일 발송·환불·고객 납품 검증을 완료했다고 주장하지 않는다.
> 이 변경은 결제 안전 구조·실행 코드·정적 UI 연결·모의 테스트의 기반이다.
> **키 두 개만 입력하면 즉시 상용 결제 가능한 상태가 아니다.** PG 가맹/정책/Suno 상업용 이용권, 실제 테스트, 개인정보/환불 운영이 필요하다.

## 1. 어디에 무엇을 넣는가

| 경로/설정 | 용도 | 비밀 여부 |
|---|---|---|
| Firebase Console → 프로젝트 설정 → 일반 → 웹 앱 | 앱의 `apiKey`, `authDomain`, `projectId`, `appId` | 공개 설정, PG 비밀키 아님 |
| Firebase Console → App Check → 웹 앱 | reCAPTCHA Enterprise 사이트 키 | 공개 사이트 키 |
| `docs/withu-payment-public-config.js` | Firebase 웹앱 설정, App Check 사이트 키, `enabled:false` | 공개 코드에 들어감 |
| TossPayments 개발자센터 → API 키 | **API 개별 연동 결제창 클라이언트 키** → Firebase Functions 문자열 매개변수 `TOSS_CLIENT_KEY` | 공개 가능 |
| TossPayments 개발자센터 → API 키 | **API 개별 연동 결제창 시크릿 키** → Google Cloud Secret Manager `TOSS_SECRET_KEY` | **절대 GitHub/HTML/JS에 입력 금지** |
| `src/toss-payment-adapter.mjs` | 실제 서버가 `POST /v1/payments/confirm` 호출하는 승인 코드 | 서버 전용, 이미 구현 |
| `firebase/functions.mjs` | 인증·주문 생성·금액 대조·PG 승인·가상계좌 웹훅 | 서버 전용 |
| `src/checkout-security.mjs` | 상품/서버가격 검증, 인증된 고객과 주문 소유권 검사 | 서버 전용 |
| `src/firestore-order-store.mjs` | 원자적 결제 상태·작업 등록, 확인 락, 주문 재시도 | 서버 전용 |
| `firebase/outbox-worker.mjs` | PG 검증 완료된 주문만 운영자 알림, 미처리 재시도 | 서버 전용 |
| `firestore.rules` | 고객 브라우저에서 주문·결제·이메일/가사 읽기·쓰기 전면 차단 | 공개 규칙 |
| `docs/payment-live.js` | 인증된 이메일 + TossPayments V2 위젯 | 브라우저용 (시크릿 없음) |
| `docs/payment-success.js` | 성공 URL 데이터를 서버에 검증 요청; 서버 응답 전 결제 완료 표시 금지 | 브라우저용 |
| Firebase Functions 문자열 매개변수 `WITHU_FROM_EMAIL` / `WITHU_OPERATOR_EMAIL` | 인증된 이메일 발신 도메인 / 운영자 수신 이메일 | 서버 설정 |
| Firebase Secret Manager `RESEND_API_KEY` | 운영자 알림 이메일 API 비밀키 | **비밀** |

### 정확한 승인 처리

1. 확인된 고객 이메일로 Firebase Authentication 이메일 링크 로그인 (`email_verified=true` 필수).
2. 서버가 `docs/prices.json`의 고정 가격으로 Firestore `withuOrders/{orderId}`를 먼저 기록. 고객이 보낸 `amount`, `paid`, `ownerUid`는 주문 입력에서 거절.
3. 고객이 Toss 공식 위젯으로 인증; 서버는 `orderId`, `paymentKey`, URL 금액과 Firestore 금액 대조.
4. Firestore 트랜잭션으로 `paymentKey`를 한 주문에 묶고 동시 승인 락(90초)을 확보.
5. 서버에서 **비밀키**로 Toss 공식 `/v1/payments/confirm` 승인. 네트워크 불명확 시 공식 결제 조회를 우선 시도.
6. PG `status=DONE`, 주문번호·결제키·KRW·`totalAmount`·`balanceAmount` 일치할 때만 단일 Firestore 트랜잭션으로 `PAID` + `withuFulfillmentOutbox/fulfill_{orderId}` 생성.
7. outbox 작업이 검증된 PAID 주문에 한해 운영자에게 메일 발송. 반복 트리거는 DB claim 및 Resend 멱등성 키로 중복 최소화.
8. `WAITING_FOR_DEPOSIT`은 **미결제**. 가상계좌 최초 발급 시 보관한 비밀 `secret`와 `DEPOSIT_CALLBACK`을 비교하고 Toss 재조회에서 `DONE`일 때만 제작 시작.

각 주문은 하나의 PAID 전환과 하나의 제작 작업을 갖는다. 네트워크/메일 제공자 불확실성 아래에서 외부 이메일을 수학적으로 정확히 한 번만 보낼 수는 없으므로 실패 보상/관리자 대조가 필요하다.

## 2. 초기 Firebase 프로젝트 설정

1. Firebase 프로젝트 생성 → 웹 앱 등록 → Blaze 요금제와 예산 알림 확인.
2. Authentication → 이메일 링크 로그인 활성화; 실제 사용자 도메인을 Authorized domains에 등록. 인증 링크를 다른 기기에서 열 때 이메일 재입력이 필요할 수 있다.
3. Firestore Database 생성(한국 사용자 대상이면 위치 선택에 주의, 생성 후 변경 제한).
4. App Check → 웹 앱 등록 → **reCAPTCHA Enterprise** 설정. Cloud Functions는 `enforceAppCheck:true`로 미검증 클라이언트 요청 거부.
5. 프로젝트 루트에서 `npm install`, `npm run check`, `npm test` 실행.
6. Firebase CLI 설치 후 `firebase login`, `firebase use --add` 로 **운영 프로젝트** 지정.
7. `firebase functions:secrets:set TOSS_SECRET_KEY` → 실제 값을 CLI 비밀 입력 창에만 입력.
8. `firebase functions:secrets:set RESEND_API_KEY` → 실제 값을 CLI 비밀 입력 창에만 입력.
9. 다음 Functions 문자열 매개변수는 배포 프롬프트(또는 Git에 올리지 않는 프로젝트 전용 Firebase 환경 설정)로 입력:
   - `TOSS_CLIENT_KEY`: 클라이언트 키
   - `WITHU_FROM_EMAIL`: 인증 완료된 발신 이메일
   - `WITHU_OPERATOR_EMAIL`: 운영자 수신 이메일
   - `WITHU_PAYMENT_ACTIVATED`: 최초 `no`
   - `WITHU_OUTBOX_WORKER_VERIFIED`: 최초 `no`
10. `firebase deploy --only firestore:rules,functions,hosting` 실행. 이 명령은 **사용자가 Firebase CLI에서 명시적으로 실행할 때**만 배포된다.
11. `docs/withu-payment-public-config.js`에 공개 Firebase 웹 설정과 App Check 사이트 키 입력. 테스트 완료 전 `enabled:false` 유지.

**실제 비밀키를 채팅, GitHub PR, 코드, 스크린샷, 로그에 붙이지 않는다.** 노출된 키는 즉시 폐기/재발급한다.

## 3. 실제 결제 활성화: 모든 조건 충족 시에만

| 게이트 | 현재 값 | 출시 조건 |
|---|---|---|
| `firebase/functions.mjs`의 `REVIEWED_FOR_LIVE_CHARGES` | `false` | 최종 수동 코드 승인 후 `true`로 변경 |
| `WITHU_PAYMENT_ACTIVATED` | `no` | 실환경 PG/계약/샌드박스 검사 후 `yes` |
| `WITHU_OUTBOX_WORKER_VERIFIED` | `no` | 운영자 이메일·실패/재시도 시험 후 `yes` |
| `docs/withu-payment-public-config.js`의 `enabled` | `false` | 실제 도메인·Auth·App Check 연동 확인 후 `true` |

위 값들은 안전 게이트이지 라이선스·법률 준수의 자동 증명이 아니다. 토스 상점 키는 **동일 결제창(구버전) 일반결제 MID의 API 개별 연동 키(test_ck/live_ck)·시크릿 키(test_sk/live_sk) 쌍**을 사용해야 한다.

**출시 전 별도 작업 필요:** Suno 직접 제작·재판매 권리의 서면 확인, 사업자·PG 계약 및 심사, 개인정보 처리방침·서비스 약관·환불/청약철회 정책 게시, 실제 주문 후 자동 메일을 받는 운영 인력 확인, 주문 취소·전액/부분 환불 관리자 절차와 PG 취소 API, 납품/재다운로드와 파일 보존·삭제 기간, 관제 및 장애 시 대응. 특히 환불 관리자 도구와 최종 음원 배송 시스템은 이번 코드에서 완결되지 않았다.

**현재 `audio_video`는 견적 승인 API가 없어 결제 차단**, `audio` 29,000원과 `audio_duo` 39,000원만 서버 고정 가격. 두 곡 옵션은 고객이 선택한 두 장르/같은 장르 두 편곡 정보를 보존한다.

## 4. 가상계좌 특이사항

- Toss 개발자센터 웹훅에 배포 후 제공되는 `withuTossDepositWebhook` HTTPS 주소를 등록하고 **실제 테스트 상점**에서 입금 완료·취소·중복 이벤트를 검증한다. 이벤트는 주문별 최초 발급 `secret` 비교 후 PG 조회 `DONE`이 나와야 출고한다.
- 미입금 `WAITING_FOR_DEPOSIT`에는 운영자 제작 요청이 생성되지 않는다.
- 입금 상태의 사후 정정, 취소, 환불 및 운영자 대조·보안 WAF 정책까지 검증하기 전에는 Toss 관리자에서 가상계좌 결제수단을 **비노출**로 두는 편이 안전하다.
- 토스 웹훅 서명 기능은 이벤트마다 지원·요구사항이 다를 수 있으므로 운영 시 서명 검증·재전송 제어·이벤트 출처를 추가 점검한다.

## 5. 테스트 및 허용 기준

`npm run check` → 신규 결제/인증 파일도 문법 검사.
`npm test` → 기존 WITHU 검사 + `test/checkout-security.test.mjs`, `test/firestore-checkout.test.mjs` 검증.

| 공격/오류 시나리오 | 기대 |
|---|---|
| 웹에서 29,000원을 1원으로 전송 | 서버 주문 필드 차단, 승인 불가 |
| 결제 리턴 URL `amount=1` 위변조 | 서버 저장금액과 불일치로 PG 승인 이전 차단 |
| 구매자 A의 주문을 B가 조회/승인 | 이메일 링크 인증 UID 대조 후 거절 |
| 이미 PAID 주문의 다른 `paymentKey` | 실패, 새 outbox 없음 |
| 고객이 결제 버튼 연타/중복 콜백 | 주문 요청 ID 재사용·PG 락·원자적 outbox 하나 |
| PG 타임아웃/서버 중단 | 결제 조회/동일 키 재시도; 불명확하면 제작 금지 |
| 가상계좌 발급 후 미입금 | 주문 pending 유지, 메일/음악 제작 없음 |
| 위조 가상계좌 웹훅 | 최초 발급 secret 불일치 거부; 공식 PG DONE 필수 |
| 클라이언트 SDK가 Firestore orders 읽기/쓰기 | `firestore.rules`에서 모두 거부 |
| 운영자 메일 제공자 장애 | outbox 재시도, 알림 중복 방지 키 적용; 불명확하면 수동 대조 |
| 2곡 상품과 선택 장르 | 주문 생성부터 각 곡별 지시 유지 |
| 뮤직비디오 시작가만 있는 상품 | 서버 승인 견적 없이 차단 |

**테스트 종류 구분**: 현재 파일의 테스트는 Node 테스트/모의 Firestore를 이용한 **단위·계약 검증**. 실제 Firestore Emulator 동시성, Firebase Auth 이메일 링크, Toss 테스트 결제·동시 승인·실제 웹훅, Resend 발송, 소액 실거래/환불은 운영 배포 전 **별도 통합 검증**이 필요하다.

## 6. GitHub 공개와 데이터

- `tlco1003/Song`이 Public이면 코드/이전 커밋과 `docs/media` 공개 파일은 인터넷에서 볼 수 있다. 실제 결제 키/고객 자료를 절대로 이 저장소에 넣지 않는다.
- 운영용 소스는 GitHub Private으로 전환 검토. 다만 현재 GitHub Pages와 도메인/플랜 호환성을 먼저 확인하고 Firebase Hosting으로 최종 이전한다.
- Firebase Hosting의 `docs`는 **공개 배포 디렉터리**. 고객 납품용 MP3/MP4, 얼굴/목소리, 고객의 가사 및 사연을 절대 이 폴더에 넣지 않는다.
- 향후 전송 파일은 접근제한 Cloud Storage, 짧은 유효기간의 권한 검증 링크, 데이터 보존·삭제 정책과 감사 로그를 구축한다.
- 기존 `src/server.mjs`의 `/api/commerce/orders` 503 차단은 유지. 실제 결제는 Firebase callable 엔드포인트 전용이다.

## 7. 공식 근거

- Toss 요청/인증/승인과 데이터 검증: https://docs.tosspayments.com/guides/v2/get-started/payment-flow
- Toss 공식 승인 API: https://docs.tosspayments.com/reference
- Toss 결제창(구버전) 직접 선택형: https://docs.tosspayments.com/guides/v2/payment-widget/integration
- Toss 가상계좌 입금 웹훅: https://docs.tosspayments.com/guides/v2/payment-window/integration-virtual-account
- Toss 웹훅 이벤트: https://docs.tosspayments.com/reference/using-api/webhook-events
- Firebase Secret Manager: https://firebase.google.com/docs/functions/config-env
- Firebase 이메일 링크 로그인: https://firebase.google.com/docs/auth/web/email-link-auth
- Firebase App Check: https://firebase.google.com/docs/app-check/web/recaptcha-provider
- Firebase Hosting 배포: https://firebase.google.com/docs/hosting/full-config



## 8. 최종 정정: 결제기관별 클릭 가능한 Choice Chip 13종

**고객이 반드시 클릭해서 선택하는 자체 Choice Chip**으로 구현한다. 이전의 "비활성 안내문 + Toss 주문서형 위젯" 설명은 **이 절로 폐기**한다.

### 표시되는 선택지

| 칩 ID | 고객 화면 | 공식 결제창 V2 SDK 요청 | 사전 조건 |
|---|---|---|---|
| `toss_pay` | 토스페이 | `CARD`, `card:{flowMode:'DIRECT',easyPay:'TOSSPAY'}` | 간편결제 직연동 계약·필수 3동의 |
| `naver_pay` | 네이버페이 | `CARD`, `card:{flowMode:'DIRECT',easyPay:'NAVERPAY'}` | 동일 |
| `kakao_pay` | 카카오페이 | `CARD`, `card:{flowMode:'DIRECT',easyPay:'KAKAOPAY'}` | 동일 |
| `payco` | 페이코 | `CARD`, `card:{flowMode:'DIRECT',easyPay:'PAYCO'}` | 동일 |
| `samsung_pay` | 삼성페이 | `CARD`, `card:{flowMode:'DIRECT',easyPay:'SAMSUNGPAY'}` | 지원 기기·계약·3동의 |
| `apple_pay` | 애플페이 | `CARD`, `card:{flowMode:'DIRECT',easyPay:'APPLEPAY'}` | 지원 기기·계약·3동의 |
| `card` | 신용·체크카드 | `CARD`, `card:{flowMode:'DEFAULT'}` | 일반 카드 결제 MID; PG창에서 수단 재선택 가능 |
| `transfer` | 실시간 계좌이체 | `TRANSFER` | 계좌이체 계약 |
| `virtual_account` | 가상계좌 | `VIRTUAL_ACCOUNT`, `virtualAccount:{validHours:24}` | 계약·입금 웹훅 검증 필요 |
| `mobile_phone` | 휴대폰 결제 | `MOBILE_PHONE` | 휴대폰 결제 계약 |
| `culture_gift` | 문화상품권 | `CULTURE_GIFT_CERTIFICATE` | 상품권 결제 계약 |
| `book_gift` | 도서문화상품권 | `BOOK_GIFT_CERTIFICATE` | 상품권 결제 계약 |
| `game_gift` | 게임문화상품권 | `GAME_GIFT_CERTIFICATE` | 상품권 결제 계약 |

13개 칩 모두 클릭/라디오 선택 가능하다. `docs/payment.js`가 선택 스타일과 해당 기관 이름을 표시하고, 간편결제 직접 연결을 선택한 경우 토스페이먼츠 3개 필수 약관 링크/동의를 노출한다. 계약/기기 제한 여부를 런타임에 사전에 모두 조회하는 기능은 **아직 없다**. 계약되지 않은 칩을 선택해도 유효한 결제가 된다고 보장하거나, 실패 시 결제가 성공한 것으로 처리해서는 안 된다.

### 키 종류: 중요

현재 구현은 Toss `widgets()` 주문서형 결제 제품이 아니라 `payment()` **결제창(구버전) SDK v2 직접 선택형**이다.

- `TOSS_CLIENT_KEY`: 토스페이먼츠 개발자센터의 **API 개별 연동 키** 중 결제창(구버전)·일반결제 MID의 **`test_ck_...` 또는 `live_ck_...`** (브라우저에 전달 가능한 값)
- `TOSS_SECRET_KEY`: **동일 MID**의 짝이 되는 **`test_sk_...` 또는 `live_sk_...`**. Firebase Secret Manager에만 보관.
- **`test_gck_...` / `live_gck_...` 키는 이 결제창 SDK에 입력하면 안 됨**. 이 키는 주문서형/결제창형 제품용으로 별개이다.
- 간편결제사별 직접 상점 키를 13개 다 입력하는 구조가 아니며, Toss PG를 통한 수단 이용은 **각 방법의 계약/지원 여부에 좌우된다**.
- 네이버페이·카카오페이를 Toss 밖에서 자체 계약해 직접 호출하는 별도 PG 연동은 이번 범위에 포함되지 않는다.

### 고객 주문부터 승인까지

1. 고객이 한 개의 Choice Chip을 직접 선택한다.
2. Firebase Authentication 이메일 인증, 주문/수신 이메일 비교, 서비스 이용 동의를 확인한다. DIRECT 간편결제면 토스 전자금융거래/개인정보 수집/제3자 제공 3동의 확인.
3. `src/checkout-security.mjs`가 선택된 `paymentChoice`가 허용 목록에 있는지 확인, DIRECT 동의 기록 및 서버 가격 고정.
4. `docs/payment-live.js`가 `docs/payment-methods.js`의 정확한 스펙으로 `TossPayments(clientKey).payment({customerKey}).requestPayment(...)`를 실행한다.
5. 성공 URL에서 서버가 원본 주문 ID·원화 금액·결제키를 조회하고 서버에서 Toss 공식 confirm/retrieve를 호출한다. **리디렉트만 믿어 결제완료 처리하지 않음**.
6. PG 응답의 실제 결제수단 `method`, `easyPay.provider`, `virtualAccount.bankCode`만 주문에 기록한다. 선택 칩과 실제 PG 응답이 다르면 PG 응답이 사실의 출처이며 추가 운영자 대조가 필요하다.
7. 가상계좌는 `WAITING_FOR_DEPOSIT` 시 제작·메일 금지. 최초 발급 secret을 보존한 웹훅 검증과 PG 재조회 `DONE`을 거쳐야 PAID 전환한다.

**중요:** 브라우저 결제 시도 중단, 승인 후 네트워크 장애 등에서 중복 청구 위험을 줄이도록 같은 주문을 무조건 다시 결제하지 못하게 잠금을 두었다. 다만 운영용 취소·재시도·PG 조회/대사·환불 처리 전체는 **미완성**. 실제 결제 활성화 전 반드시 완성할 것.

### 코드 및 테스트 경로

- UI 칩: `docs/payment.html`, `docs/payment.js`, `docs/checkout.css`
- 공식 칩 → 결제 API 대응표: `docs/payment-methods.js`
- Firebase 인증/선택 결제창: `docs/payment-live.js`
- 서버 가격·고객권한·동의 저장: `src/checkout-security.mjs`
- PG 승인/입금: `firebase/functions.mjs`, `src/toss-payment-adapter.mjs`, `src/paid-order-pipeline.mjs`
- 원자적 주문 기록: `src/firestore-order-store.mjs`
- Node 배포 정적 경로 및 제한적 CSP: `src/server.mjs`
- 13개 칩 매핑 테스트: `test/payment-methods.test.mjs`
- 클릭칩/정적 통합 검사: `test/commerce.test.mjs`
- 서버 consent 검증 테스트: `test/checkout-security.test.mjs`

### 공식 자료

- https://docs.tosspayments.com/guides/v2/payment-window/integration-direct
- https://docs.tosspayments.com/sdk/v2/js/payment-direct
- https://docs.tosspayments.com/guides/v2/payment-window/integration-virtual-account
- https://docs.tosspayments.com/reference/using-api/api-keys
- https://docs.tosspayments.com/codes/enum-codes
- https://pages.tosspayments.com/terms/user/
- https://pages.tosspayments.com/terms/privacy/consent1
- https://pages.tosspayments.com/terms/privacy/consent2

**출시 잠금 현황은 그대로 유지**: `REVIEWED_FOR_LIVE_CHARGES=false`, `WITHU_PAYMENT_ACTIVATED=no`, `WITHU_OUTBOX_WORKER_VERIFIED=no`, 공개 웹앱 `enabled:false`. 실제 PG 결제·발송·환불은 계약과 통합 테스트 후에만 개통.
