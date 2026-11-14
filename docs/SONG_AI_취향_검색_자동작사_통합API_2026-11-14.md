# SONG AI — 사용자 선택 기반 자동 작사·스타일·검색·공식 음악 API 통합
작성일: 2026-11-14
개발 브랜치: `feature/lyria-official-music-20261114` / Draft PR #14

## 목적과 운영 경계

사연·가사·상대 나이대·관계·말투·장르·시대·선호 가수 입력에서 서버 전용 감정형 가사와 곡별 스타일을 생성하고, 실제 승인된 공식 음악 API로 MP3를 생성한다. 기존 결제 SSOT, 가격, 비공개 프롬프트, 운영자 검수, 고객 이메일을 유지한다. '한 월 구독권으로 모든 모델 무제한'은 제공하지 않는다. 한 API 프로젝트/키로 여러 Google Gemini 기능을 호출하더라도 텍스트·웹검색·음악·영상은 각각 청구된다.

## 이번에 실제 수정한 코드

- `docs/create.html` · `docs/create.js`: 마지막 6단계에 선택적 선호 가수/밴드 입력(최대 80자)을 추가. 사용자가 적은 내용만 세션 임시 보관하고 비공개 스타일·API 키·가사 정책을 노출하지 않음.
- `docs/checkout.html` · `docs/checkout.js`: 결제 전 요약에 선호 가수 표시.
- `src/lib.mjs`: 선호 가수를 80자 이하 사용자 데이터로 검증, 가사 정책에는 이 선택을 **스타일 선호로만 참고**하도록 전달. 기존 가사·유명 노래나 목소리 모방을 지시하지 않음.
- `src/order-draft-preparation.mjs` → `src/song-production-plan.mjs` → `src/production-worker.mjs`: 동일 키 `artistPreference`를 기존 유료 결제/작사/곡별 스타일 계획으로 연결. 기존 mood, eraPreference, genre/duo/blend 스키마 유지.
- `src/artist-style-evidence.mjs` 신규: 운영자가 실제 확인한 장르·시대별 특정 가수 음악적 관찰 기록을 비공개 폴더에서 읽고 `src/private-style-evidence.mjs`의 원출처·악기·박자·템포 검증기를 재사용. **가수 이름을 음원 모델에 전송하지 않고** 출처가 있는 편곡 특성만 반영한다.
- `src/music-style-library.mjs`: 해당 가수와 장르·시대의 검증된 관찰 JSON이 있는 경우에만 추가 편곡 근거를 기존 1000자 이내 스타일 프롬프트에 포함. 미검증 정보는 포함하지 않음.
- `src/gemini-lyrics-provider.mjs` 신규 + 기존 `src/providers.mjs`: 기본 OpenAI 작사 엔진을 보존하면서 `WITHU_LYRICS_PROVIDER=gemini`을 설정하면 Gemini Interactions의 공식 텍스트 API를 사용한다. 음악 Lyria API와 `GEMINI_API_KEY`를 공유하지만 요청 요금은 별도.
- `src/artist-research-provider.mjs` 신규: 선택적 `WITHU_ARTIST_RESEARCH_ENABLED=true`에서 Gemini의 공식 `google_search` 도구로 가수·시대·장르의 음악적 특징을 **실제 검색**한다. 반환된 텍스트의 `annotations[].type=url_citation`에서 HTTPS 출처 URL/제목을 추출해 승인 전 후보로 저장한다. 검색된 문구만으로 검증 완료·독창적 스타일 모방 권한이라고 주장하지 않는다.
- `src/production-worker.mjs`, `src/production-runtime.mjs`, `docs/admin.js`: 결제 후 선택적 검색 결과와 인용·검토상태를 Firestore `withuArtistResearch` 기록으로 유지하고 인증된 관리자 작업함에서 확인. 검색 비용 중복을 막기 위해 주문당 생성 작업을 선점한다.
- 기존 `src/lyria-music-provider.mjs`, `src/lyria-paid-automation.mjs`: 공식 Lyria 3.5 결제 후 생성 후보 및 비공개 MP3 보관을 유지. 고객 최종 발송 전 품질/상업 권리 검수는 계속 필수.

## 비공개 가수 근거 기록 계약

경로(운영자 전용): `WITHU_PRIVATE_STYLE_DIR/artist-references/<sha256(정규화한 가수이름) 32hex>__<genreSlug>__<era>.json`.
실제 파일에는 `schemaVersion:1`, `approved:true`, `approvedBy`, `approvedAt`, `artistName`, `observation` 필드를 사용한다.
`observation`은 기존 `src/private-style-evidence.mjs` 데이터 계약과 동일하며 출처 `sources[].{url,title,type}` (analysis/research/chart 중 하나)와 `features.tempoBpm/meter/instruments`를 검증한다.

**중요:** source URL이 존재한다는 사실만으로 수치·원곡 분석을 증명하지 않는다. 실제 출처에 근거한 수치는 운영자가 확인해야 한다. 샘플 테스트의 가상 아티스트·BPM은 학술·대중음악 통계가 아니다. 비공개 근거 기록이 없는 경우 선택한 시대/장르/감정의 기존 일반 규칙을 적용한다.

## 실제 출력 파이프라인

```text
[사용자 선택: 7종 장르 + 시대(직접 또는 나이대 추정) + 감정 + 사연 + 선호 가수]
  -> 공개 입력만 임시 보관
  -> 서버에서 입력 검증/가격 SSOT/비공개 Lyric Prompt
  -> 실제 PG 확인 (미결제 차단)
  -> 선택적으로 공식 Gemini 구글 검색: 가수·장르·시대 근거 수집
     -> 인용 있는 결과도 source_candidates_for_review (승인 전)
  -> 기존 Gemini/OpenAI 작사 (서비스 선택)
  -> 기존 장르+시대+감정+승인된 가수 근거로 1000자 이내 스타일 생성
  -> 공식 Lyria 3.5: 실제 MP3 생성 후보 [공식 상업 권리 승인 필요]
  -> 기존 Firebase Storage + 선택적 비공개 Google Drive 백업
  -> 기존 관리자 음질/가사/권리 검수
  -> 기존 Resend 고객 전용 이메일/감상 페이지
```

**오해 금지**: 검색에서 수집한 근거를 즉시 사용해 가수의 목소리·선율을 복제하는 기능은 구현하지 않았다. 검증된 특징이 사전 등록된 경우에는 음악적 편곡 특징이 자동 선택된다. 검색후 신규 검토본을 승인된 근거로 승격시키는 운영자 UI는 아직 별도로 구현해야 한다. 완전 무인 주문/음원 제작/검수/고객 전송이 실제 배포되었다는 뜻도 아니다.

## 공식 출처

- Google Gemini Interactions API (텍스트·음악·검색): https://ai.google.dev/gemini-api/docs/interactions-overview
- Lyria 3.5 음악 생성: https://ai.google.dev/gemini-api/docs/music-generation
- Google Search Grounding과 URL 인용: https://ai.google.dev/gemini-api/docs/google-search
- 공식 모델 별 가격: https://ai.google.dev/gemini-api/docs/pricing
- Mureka 공식 API (작사, 10개 언어 지원 유료 고객 음원 생성, 음악비디오, 리믹스): https://platform.mureka.ai/docs/
- Mureka API 선충전/상업이용 범위: https://platform.mureka.ai/docs/en/faq.html
- OpenAI ChatGPT 구독과 API 별도 비용: https://help.openai.com/en/articles/9039756-managing-billing-for-chatgpt-and-the-api-platform

## 대안 공급자/영상

Google Gemini API는 공식 텍스트 생성, 검색, Lyria 음악, Veo/Omni 영상 API를 지원하며 같은 API 제공업체 계정에서 사용량별 과금이 가능하다. 다만 이것만으로 SONG-Vision의 실제 한국어 음소·턱뼈·혀·피부 기반 립싱크 정확도가 검증되는 것은 아니다. Lyria의 명명 아티스트 음색 복제는 공식 제한사항과 충돌할 수 있다.

Mureka는 한국어 가창, 전용 가사·작곡·뮤직비디오 API와 편집·트랙 기능을 제공하여 후보이나, `mureka-9.5`는 비동기 태스크 API다. 그 어댑터는 이번 변경에서 실연결하지 않았다. 공급자를 무작정 이름만 바꿔 Lyria의 동기 응답처럼 취급해서는 안 된다.

## 운영 활성화 이전과 실측 검증

- 공개 `tlco1003.github.io/Song`은 서버가 아니다. Firebase Functions/Hosting의 운영 URL·원본 동작 확인 전까지 공개 결제/자동 음악 판매 미활성.
- 신규 Google 옵션은 기본 OFF. Gemini 작사를 선택하더라도 고객 데이터 보관·모델 제공 약관·개인정보 동의가 필요하다.
- Gemini API와 Google 검색 그라운딩은 월정액 구독 범위가 아닌 사용량 과금. 검색 1요청 내에서 여러 쿼리를 발생시킬 수 있어 비용 로그·월 한도 필요.
- 테스트: `npm run check`, `npm test`, `npm run firebase:prepare`, `node scripts/business-ops-audit.mjs`. GitHub Actions 결과 링크와 실제 테스트 수를 `docs/business/PROGRESS.md`에 기록할 것.
- 미검증: 실제 Gemini 작사/검색 및 Lyria 유료 음원 생성, 가사와 한국어 음성 정렬 품질, 고객 메일 도착, Google Drive 실제 백업, 상업 권리, 실서비스 배포.
