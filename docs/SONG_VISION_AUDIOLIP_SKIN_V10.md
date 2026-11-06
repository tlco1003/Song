# SONG-Vision v10 — 가창 소리 ↔ 입술·볼·눈 주변 피부 움직임 공동 연구

기준: 2026-11-07 | 브랜치: `feature/song-vision-self-hosted-v1` | 상태: **연구 프로토타입, 상용 품질 미검증**

## 목표를 명확히 구분
연구 목표는 사람의 뼈 위치 추정이 아니다. 가수가 실제로 노래할 때 **관찰되는 얼굴 표면 근육 작용의 결과**(입술 오므림, 입꼬리 당김, 턱 내림, 볼 당김, 코옆 근육 표정, 눈꺼풀·눈썹 운동)와 그 시점의 **음성 스펙트럼** 사이의 통계적 연동을 학습한다.

**카메라로 관측된 피부 변위와 표현 계수는 실제 EMG 근육 활성도의 측정치가 아니다.** 이 자료로 볼근육이나 입둘레근의 힘(N), 조직 탄성계수(kPa), 실제 광대뼈 위치를 도출했다고 주장하지 않는다.
입·혀·턱·연구개·인두·성대의 변화가 발성 음향에 관여한다. **얼굴 영상만으로 그 음파를 유일하게 복원할 수 없기 때문에** v10은 음성을 생성하는 음향 합성기 자체를 구현하지 않는다. 대신 이미 동기화된 **실제 보컬**을 분석해 발음 중에 일어난 영상 표면 움직임을 예측하고 맞는 소리인지 비교한다.

## 근거 확인
1. **Google MediaPipe Face Landmarker**: 478개 추정 표면 랜드마크 + 52개 표정 blendshape(눈 깜박임, 눈 주변 squint, 코 찡그림, 입술 모양, 턱 열림 등). 공식 설명 https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker
2. **Articulatory and Phonatory Precision When Singing Staccato at Different Speeds** (Journal of Voice, 온라인 2023, 정식 권호 2026년 40(1):181-190), DOI https://doi.org/10.1016/j.jvoice.2023.08.011. 전문 가수 12명의 25 fps 실시간 MRI에서 가창 조건에 따른 입술·턱·혀·후두 부위 변화를 분석함. 이를 얼굴 카메라만으로 내부를 측정할 수 있다고 해석하면 안 된다.
3. **Vocal tract and register changes analysed by real-time MRI in male professional singers— a pilot study** (2008), DOI https://doi.org/10.1080/14015430701875653. 소리의 음역·성구 조건에 따라 내부 공명 기관 조절이 바뀌며 개인차가 큰 점을 보여주는 파일럿 연구.

## 이번 구현 범위 (SONG 내부 자체 코드)
- `face_surface_motion.py`의 기존 **12개** 검증 데이터는 그대로 두고, MediaPipe 52개 계수 중 **26개 추가 신호**를 검출하여 clip 별 중립 중위값 대비 변화량을 별도 저장.
- 26개 추가 계수는 눈 blink/squint/wide, 눈썹 inner-up/down, 입술 close/funnel/pucker/press/smile/stretch, nose sneer, jaw left/right, lower lip down, upper lip up 등을 포함한다.
- 전체 **38개 연속 표면 운동 특징**을 사용한다. 478개 점 전체를 학생 네트워크가 직접 생성하는 구조는 아니다. 원시 점은 비공개 교사 결과에 보관한다.
- `facial_articulation_v10.py`: SONG 자체 PyTorch `AudioFacialArticulationNet` 추가. 보컬 Mel 80×21, 96px 참고 얼굴(눈·볼 포함), 마스킹된 64px 입술 영상을 공동 부호화해 **(1) 입술 이미지** + **(2) 38개 표면 운동 예측**을 출력한다.
- 눈 움직임이나 눈썹 표정은 가창 소리만으로 유일하게 결정되지 않으므로 학습 가중치를 낮추고 `eyesBrowMAE`를 독립적으로 기록한다.
- 정확한 가창 맥락을 검사하기 위해 연속된 **25fps 기준 1프레임(40ms) 뒤의 표면 움직임 변화량**에 손실 부여.
- 같은 영상 클립의 약 **8프레임(320ms) 뒤로 어긋난 오디오**를 결합한 비교 손실과 독립 검증 지표를 추가. 이 지표가 좋아도 실제 음소 정확도를 보증하지 않는다.
- 입술·턱(`lipJawMAE`), 볼/코옆(`cheeksMAE`), 눈/눈썹(`eyesBrowMAE`), 시간 변화(`temporalDeltaMAE`), 정상·어긋난 오디오 차이(`correctVsShiftedAudioGain`)를 각각 출력. 입술 복사 baseline과 무움직임 baseline 둘 다 평가.
- 과거 v2 입술 가중치가 비공개로 복원된 경우에만 `--init-checkpoint`로 기존 입술 부분을 **초기화**할 수 있다. 신규 38개 신호 예측부·AdamW 옵티마이저 상태는 새로 학습한다.

## 실제 가수 데이터 연구
- 공식 RAVDESS https://zenodo.org/records/1188976, CC BY-NC-SA 4.0, **비상업용**.
- Actor 01/02: train (40개 가창 녹화); Actor 03: 미학습 holdout (20개 가창 녹화). 각각 원본 ZIP 공식 MD5 검증. 원본 MP4와 동일 녹화로부터 ffmpeg로 분리된 WAV를 사용.
- 공개 YouTube 동영상이나 고객 개인 얼굴을 임의로 수집·학습하지 않음. RAVDESS는 영어 짧은 노래 문장이라 한국어 가창 품질의 최종 근거가 아님.
- Google Face Landmarker는 **오프라인 모델 파일만 로컬에서 실행**. 외부 영상 생성 서비스 API 호출 없음.
- 얼굴 검출이 영상마다 80% 미만이면 자동 연구 중단. 누락된 점을 상상해서 채우지 않음.

## 보관 정책
- 기존 `research/song-vision-vault` 브랜치 암호화 연구 모델을 **절대 삭제/덮어쓰기 하지 않음**.
- 새 연구 가중치와 모델 수치 보고서를 공개 저장소에 평문으로 올리지 않고 **기존 사용자 소유 X25519 공개키로 암호화**해 동일 vault 별도 폴더 `encrypted/ravdess-face-articulation-v10/`에 저장.
- 추가로 90일 보존 GitHub Actions 암호화 아티팩트 사용. CI에는 복호화 개인키가 없음.
- 원본 인물 영상·음성·478점 상세 프레임 출력은 임시 실행 환경에서만 사용하고 공개 아티팩트로 올리지 않음.

## 현 단계에서 안 되는 일
- 실제 눈·볼의 피부 텍스처를 완성형 고화질 동영상으로 생성하는 **full-face renderer**는 미완성. v10 영상 디코더는 64×64 입 주변만 생성하고 나머지는 38개 움직임 벡터로 예측.
- 입 모양만으로 한국어 발음을 정확히 읽거나 해당 사람의 목소리를 합성하는 모델은 아님.
- 신체 피부·안면 근육의 생체역학적 응력과 조직 깊이를 계산하는 물리모델은 아님.
- 서비스 `canAcceptCustomerJobs=false`, 유료 SONG 고객 영상 자동 생성은 차단 유지.

## 검증 엔드포인트 및 GitHub 코드
- 코드: `song_vision/facial_articulation_v10.py`, `song_vision/external_ravdess_face_articulation_v10.py`, `song_vision/test_facial_articulation_v10.py`.
- CI workflow: `.github/workflows/song-vision-face-articulation-v10.yml`.
- 최종 성능은 **실제 GitHub Actions 학습 로그 및 암호화 백업의 존재를 확인하기 전에는 성공으로 기록하지 않는다.**
