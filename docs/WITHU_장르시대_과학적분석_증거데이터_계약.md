# WITHU 장르 × 시대 음악 특성 근거 레지스트리

개인별 감정·연령대·장르 선택에 따른 스타일 제작을 위한 **서버 비공개 관찰 자료** 계약입니다. 공용 `docs/` 및 공개 GitHub 저장소에 상세 곡 분석 결과나 고객별 비공개 스타일을 보관하지 않습니다.

## 데이터 위치
`WITHU_PRIVATE_STYLE_DIR/evidence/<genre-slug>__<era>.json` 형식. 예: `ballad__1990s.json`.

현재 이 브랜치에는 실제 인기곡별 추출치를 넣지 않았습니다. 검증한 분석 결과가 없는 경우 엔진은 숫자·악기 통계를 만들어내지 않고 기존 장르 지시로 작동합니다.

## 필수 필드
`schemaVersion: 1`, `genreSlug`, `era`, `sources`(실제 확인한 URL·제목·원출처 유형), `features`(선택형 측정 tempoBpm {min,max}, meter, instruments). 서로 다른 녹음의 BPM은 편곡마다 다르므로 특정 시대 전체의 보편적 수치로 취급하지 마세요. `sources`는 수집 근거에 대한 메타데이터이며 AI가 그 내용까지 자동 검증했다고 주장하지 않습니다.

지원 장르 슬러그: ballad, acoustic, jazz, trot, rnb, kpop, indiepop. 지원 시대: 1960s~2020s(10년 단위). 지원 악기 목록 및 검증 범위는 `src/private-style-evidence.mjs`에서 확인합니다.

## 연결
`src/music-style-library.mjs`가 서버에서만 읽고 제한된 특성 요약만 1000자 이하 스타일에 반영합니다. 증거 JSON이 없으면 무근거 숫자를 추가하지 않습니다. JSON이 잘못되었거나 장르/시대가 다르면 실패 처리합니다. 고객·브라우저는 프롬프트나 증거 파일 원문을 받지 않습니다.
