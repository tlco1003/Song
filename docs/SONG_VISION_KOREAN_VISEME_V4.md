# SONG-Vision v4 — 한국어 음절별 입술 모양 제어 + 로컬 타이밍 편집기
기준: 2026-11-06
브랜치: feature/song-vision-self-hosted-v1

## 1. 이번 구현의 정확한 범위

- song_vision/viseme_timeline.py: 한글 음절의 초성·중성·종성을 분해하고, 확인된 각 음절의 발음 시각에 맞춰 입술 열림(openingRatio), 가로폭(widthScale), 둥글림 관련 표시(roundnessProxy)를 계산한다.
- 21개 한국어 모음에 초기 실험값을 지정한다. **수치는 SONG이 설정한 임시 엔지니어링 목표값이지, 논문에서 측정된 구강 크기나 정답 viseme은 아니다.**
- 일부 순음(ㅁ/ㅂ/ㅃ/ㅍ)의 입술 닫힘을 근사하고 음절 경계의 입술 모양을 부드럽게 보간한다.
- song_vision/face_geometry.py: 높이와 가로폭을 모두 변형하는 국소 2D 워프를 제공한다. 발음 확인된 시간표를 지정하면 WAV RMS만으로 제어하는 v3 방식 대신 시간별 음절 viseme 목표값을 적용한다.
- song_vision/annotation_editor.html: **음성 파일·가사를 서버로 전송하지 않고** 보컬을 재생해 음절 종료 시점을 직접 표시하는 편집기. 원본 파일 SHA-256을 포함한 JSON을 내보낸다.
- GitHub CI: 가짜 얼굴 478점, 합성 보컬 WAV/영상 MP4, 테스트용 수동 음절 라벨을 이용한 전체 파이프라인 테스트.

아직 **자동 음소 인식/forced alignment, 한국어 연음·음운변동 완전 처리, 고품질 가창 립싱크·치아/혀 생성·실가수 영상의 유효성 검증, 고객 얼굴 교체 신경망**은 미구현이다. 말소리·가창의 실제 입 모양은 앞뒤 음소·개인차·노래 발성에 영향을 받는다.

## 2. 명령어를 몰라도 시간표를 만드는 방법

1. GitHub SONG-Vision 브랜치를 다운로드하여 컴퓨터에서 song_vision/annotation_editor.html을 연다. 브라우저에서 파일 SHA-256 기능이 차단되면 로컬 개발 서버의 안전한 컨텍스트에서 연다.
2. 해당 곡의 분리된 보컬 WAV/MP3를 선택한다. **일반 MP3 믹스에서 보컬을 자동 분리하는 기능은 없다.**
3. 가사를 넣고 음절 목록을 만든다. 띄어쓰기와 문장부호는 자동으로 침묵으로 변환되지 않으므로 실제 쉼 구간을 명시적으로 추가한다.
4. 음원을 듣고 각 음절의 종료 시점을 표시한다. 모든 구간이 빈틈·중복 없이 연결되어야 한다.
5. 검수자 이름과 실제 타이밍 확인란을 채우고 JSON을 다운로드한다. 이 파일은 음원 SHA-256과 연결되므로 다른 음원 파일을 넣으면 엔진이 오류를 낸다.
6. 실제 발음이 표기와 다른 구간(연음, 동화 등)은 JSON의 onset/vowel/coda 필드를 검수된 발음대로 보정할 수 있다. 자동 G2P 모델은 아직 없다.

출연자의 영상 사용·변형 동의와 음원 권리는 별도로 확인해야 한다. 편집기에서 만든 JSON의 verified=true는 이용 허가 증거가 아니다.

## 3. 시간표 스키마 예시

아래는 실제 노래의 정확한 시간값을 나타내지 **않는** 계약 예시다. vocalSha256은 실제 보컬 파일의 해시와 일치해야 한다. 편집기가 직접 계산하므로 손으로 입력할 필요는 없다.

~~~json
{
  "schemaVersion": 1,
  "alignmentMethod": "human_reviewed",
  "verified": true,
  "verifiedBy": "song-operator",
  "timeBase": "vocal_file_seconds",
  "vocalSha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "durationSeconds": 1.0,
  "segments": [
    {"kind":"syllable","syllable":"마","startSeconds":0.0,"endSeconds":0.3},
    {"kind":"syllable","syllable":"음","startSeconds":0.3,"endSeconds":0.75},
    {"kind":"rest","startSeconds":0.75,"endSeconds":1.0}
  ]
}
~~~

구간은 영상이 아닌 **해당 보컬 파일 시작 0초 기준**이다. 음절은 한글 완성형 1개, 쉼은 kind=rest, 각 발음 구간 최소 20밀리초, 시간표는 전체 길이까지 이어져야 한다. 시간을 자동으로 균등 분할해 대충 채우지 않는다.

## 4. 로컬 Python으로 검증 및 MP4 실험

보컬의 SHA-256과 시간표를 검증하고 25fps 입술 제어 프레임을 출력한다.

~~~sh
python -m song_vision.viseme_timeline \
  --timeline /private/song-vision-korean-viseme-timeline.json \
  --vocals /private/target-singer-vocals.wav \
  --start 0 --seconds 10 \
  --output song_vision/private/viseme-frames.json
~~~

실제로 사용 허락을 받은 가수 영상에 적용해 국소 2D 입술 모양을 변형한다. 오프라인 Google Face Landmarker 파일은 별도 설치한다 (자세한 설치: docs/SONG_VISION_FACE_GEOMETRY_V3.md).

~~~sh
python -m song_vision.face_geometry warp-video \
  --template /private/consented-singer.mp4 \
  --vocals /private/target-singer-vocals.wav \
  --mix /private/target-song-mix.mp3 \
  --model song_vision/private/models/face_landmarker.task \
  --consent-record /private/video-edit-consent.json \
  --timeline /private/song-vision-korean-viseme-timeline.json \
  --output song_vision/outputs/viseme-preview.mp4 \
  --seconds 10 --start 0 --strength 1.0
~~~

시간표와 음원 해시가 다른 경우, 타임스탬프가 겹치거나 비면 실행 거부, 얼굴이 보이지 않으면 실행 중지한다. 출력 보고서에서는 controlMode=human_reviewed_korean_viseme_timeline, lipSyncVerified=false를 명시한다. **실제 한국어 음절의 정답 입술·치아 움직임을 생성한다는 보장은 없다.**

## 5. 실제 논문 근거와 구분

1. 김성우 외(2019), Recognition of Korean Vowels using Bayesian Classification with Mouth Shape, 한국멀티미디어학회논문지 22(8), 852–859. DOI https://doi.org/10.9717/kmms.2019.22.8.852 — 한국어 모음을 입술 특징으로 구별한 연구. SONG은 입술 폭·개방 관련 축을 설계했을 뿐 본 연구 수치를 도입하지 않았다.
2. Se Jin Park et al. (2024), Exploring Phonetic Context-Aware Lip-Sync for Talking Face Generation, ICASSP 2024, DOI https://doi.org/10.1109/ICASSP48485.2024.10447284 — 음소 앞뒤 문맥이 시공간적 입술 움직임에 영향을 주는 것을 연구. SONG은 단순 경계 보간만 구현했으며 그 논문의 학습 모델을 재현한 게 아니다.
3. Hui Fang et al. (2024), Audio-to-Deep-Lip, Computers & Graphics 120, 103925, DOI https://doi.org/10.1016/j.cag.2024.103925 — 3D 입술 랜드마크와 /b,p,m,f/ 순음 viseme 보정을 다룸. SONG은 일부 순음 입술 닫힘을 근사한 것이지 그 정확도나 구현을 재현하지 않는다.
4. Google MediaPipe 공식 Face Landmarker: https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker — 얼굴 표면 478점 및 표정 계수 52개 추정. **실제 두개골·치아 뿌리/턱관절 측정은 불가능**하다.

## 6. 현재 SONG 안전 경계
- 외부 생성형 영상 SaaS API에 접속하지 않는다.
- 학습용 실가수 영상·고객 얼굴·보컬·시간표 JSON은 Git에 업로드하지 않는다.
- 상용 주문/고객 업로드/자동 생성 기능은 비활성으로 유지한다.
- 유효한 체크포인트와 실가수에 대한 시각·음향 검증이 아직 없으므로 고객에게 완성된 생성 기능으로 표시하지 않는다.
