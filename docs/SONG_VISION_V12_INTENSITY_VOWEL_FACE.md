# SONG-Vision v12 — 동일 발음의 강약·음높이·표정 변화 학습

날짜: 2026-11-07 | GitHub: `feature/song-vision-self-hosted-v1` | 비상업 연구

## 사용자 목표
이미 존재하는 노래(분리된 실제 보컬)에 맞춰 **얼굴 피부와 입술·턱·볼·눈의 움직임**을 생성한다. 음성 생성/클로닝 모델이 아니다.
핵심은 `발음 특성 × 강약 × 음높이/성구 × 가수의 얼굴 표면 반응 × 앞뒤 발음·시간`의 결합을 학습하는 것이다. 강한 소리는 입술 열림이 커지거나 눈·볼 표정이 뚜렷해지는 등 여러 경로가 있을 수 있고, **반드시 찡그리지는 않는다**.

## 과학적 근거 및 직접 확인 가능한 1차 출처
1. **Morphometric Differences of Vocal Tract Articulators in Different Loudness Conditions in Singing** (2016, *Journal of Voice*), PMID 27096935 — MRI 25 fps로 전문 가수 12명의 /a/ 가창을 pp/mf/ff 조건에서 비교. 입술 열림·인두 폭이 음압과 연관됨. https://pubmed.ncbi.nlm.nih.gov/27096935/
2. **Dynamic changes of vocal tract dimensions with sound pressure level during messa di voce** (2023 online / 2024 issue, *Scientific Reports*), PMID 38038612 — 전문 가수 12명이 한 음높이에서 크레셴도→디크레셴도를 수행할 때 25 fps 실시간 MRI와 동기 음성으로 턱·입술·인두 변화를 분석. 일부 음압 정체 구간에서도 조음 조절이 나타났으며 **디지털 파일 음량만이 실제 근육의 힘을 의미하지 않음**. https://pubmed.ncbi.nlm.nih.gov/38038612/
3. **Articulatory configuration and pitch in a classically trained soprano singer** (2009, *Journal of Voice*), PMID 18504111 — /i,e,u,o,a/를 262–784 Hz로 노래할 때 모음별·음높이별 입술/턱/혀 위치가 달라짐. **단일 가수 연구**이므로 모든 가수에게 같은 변화량을 적용하면 안 됨. https://pubmed.ncbi.nlm.nih.gov/18504111/
4. **Effects of increasing sound pressure level on lip and jaw movement parameters and consistency in young adults** (2006, *J Speech Lang Hear Res*), PMID 17197502 — 비슷한 +10 dB 음량을 얻더라도 지시 방식/조건에 따라 입술·턱 운동이 달라짐. 따라서 `음량 = 근육 힘 = 찡그림`으로 고정하지 않는다. https://pubmed.ncbi.nlm.nih.gov/17197502/
5. **Variability of articulator positions and formants across nine English vowels** (2018, *Journal of Phonetics*), DOI 10.1016/j.wocn.2018.01.003 — 32명, 9개 모음에서 개인별 조음 차이 확인. /a,e,i,o,u/는 널리 유용한 기본 예시이지만 모든 언어의 모든 소리를 다섯 개로 정의할 수 없음. https://pmc.ncbi.nlm.nih.gov/articles/PMC6053058/

## 발음의 공통 음향 구조와 근육 표면 반응
- /a/는 일반적으로 비교적 열린 입, /i/는 전설 고모음, /u/는 입술 원순 및 돌출 등으로 조음 범주를 나눌 수 있다. 그러나 실제 크기는 음높이·강약·가창 방식·화자에 따라 변한다.
- /p,b,m/ 등은 입술 닫힘이 중요하고 /f,v/ 등은 윗니·아랫입술 접촉, /s,z/는 혀·치아 구조의 기여가 크다. 소리의 크기만으로 모든 발음을 표현하는 것은 불가능하다.
- `80×21` 로그 멜은 짧은 음소·조음 맥락, `8×61` 측정 지표는 610ms의 진폭·주파수 변화 맥락을 입력받는다. **현재 명시적 IPA/음소 라벨이나 근전도(EMG) 교사는 없다.**
- 짧은 모음과 긴 모음, 크레셴도/디크레셴도, 강세, 발음의 시작/끝에서 실제 표면 좌표가 어떻게 달라지는지는 **동기화된 영상에서만 정답으로 수집**한다.

## v11의 치명적 데이터 편향을 수정
- 이전 연구는 RAVDESS 파일명의 4번째 요소 `감정 표현 강도`가 `01`(normal)인 영상만 20개/출연자 선택했다.
- RAVDESS 원본에는 `02`(strong emotional intensity)도 있으므로, **동일 출연자·감정·문장·반복**에서 `01`,`02`를 각각 확인한다.
- 출연자 01(남성) + 02(여성) 학습 각 40클립 → 총 80클립; 새로운 출연자 03(남성) 독립 검증 40클립; 총 120클립/60개 강도 비교쌍.
- **정상/강함은 감정 강도 레이블이지, 근육 힘(N), 음압(dB SPL), 가창 볼륨(pp/ff)을 정확히 제어한 자료가 아니다.** 같은 텍스트에서 얼굴 운동 변화가 있는지를 연구할 수 있으나 근육 사용량의 직접 측정 결과로 보고하지 않는다.
- 코드 `song_vision/external_ravdess_intensity_v12.py`: Zenodo 01·02·03 공식 원본 ZIP MD5를 먼저 확인한 뒤 감정 5종×강도 2단계×문장 2×반복 2를 추출. 같은 가수가 학습·검증에 중복되지 않는지 검사.
- 전체 연구의 음성은 해당 MP4에서 직접 추출. 기존 8개 acoustic cue+Mel, 38개 얼굴 표면 움직임 및 64px 입술 이미지 연구 모델로 새로 훈련.
- `unseenSingerNormalVsStrong`에서 독립 출연자의 보통/강한 표정 조건을 구분해 예측 오차 보고. 이 값이 작아져도 한국어·범언어 음소 인식이 증명되는 것은 아님.

## 안전, 결과 및 보존
- 출처: 공식 Zenodo https://zenodo.org/records/1188976 / 제작 기관 공식 https://smartlaboratory.org/resources/speech-song-database-ravdess/
- RAVDESS **CC BY-NC-SA 4.0**, 연구용만 허용. 원본 얼굴/음성 평문 공개·상용 사용 금지.
- 기존 v2/v8/v9/v10/v11 연구 가중치 수정·폐기 금지. 이번 모델은 동일 코드 계열의 새 훈련 실행이지만 새 `.svault`를 `research/song-vision-vault/encrypted/ravdess-v12-matched-intensity/`에 저장하고 90일 아티팩트 별도 보관.
- 복호화 개인키는 사용자 소유, GitHub에 업로드하지 않음. `canAcceptPaidJobs=false` 유지.
- 이번 프로토콜은 **기존 v11 아키텍처로 더 다양한 조건을 학습**하는 것이므로 `modelVersion`은 v11과 같을 수 있으나 checkpoint run ID / study ID / 데이터 구성이 별도로 명시된다.
- 학습 완료·암호화 백업·독립 검증 결과는 실제 Actions 로그 및 Vault 저장을 확인한 후에만 성공으로 표기한다.

## 코드와 CI
- `song_vision/external_ravdess_intensity_v12.py`
- `song_vision/test_intensity_pairs_v12.py`
- `.github/workflows/song-vision-v12-intensity.yml`
