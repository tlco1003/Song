# SONG-Vision v11 — 완성된 노래의 발음·강약에 맞춰 얼굴을 움직이는 모델

연구 기준일: 2026-11-07 | GitHub `feature/song-vision-self-hosted-v1` | 연구 전용 / 고객 배포 차단

## 목표

**입력:** 이미 생성되거나 녹음된 보컬 WAV + 소유자가 사용을 허락한 가수 정면 얼굴 영상.
**학습 정답:** 같은 보컬이 실제로 울리던 시점의 입술 형태·턱끝 표면 이동·볼·눈 주변 피부 표정 계수.
**출력:** 64×64 입술 이미지 예측 + 38개 얼굴 표면 움직임 예측. **출력에 음성·보컬·MP3 생성은 없다.**

가창자의 입 모양은 소리의 세기 하나로 결정되지 않는다. 모음과 자음의 스펙트럼, 앞뒤 발음 맥락, 입술 닫힘/오므림/늘림, 지속 모음의 길이, 소리가 커졌다 작아지는 시간과 표정이 함께 작용한다. 눈 깜박임·눈썹 표정은 음향만으로 유일하게 예측되지 않으므로 별도 평가한다.

## 실제 코드 변경

1. `song_vision/vocal_acoustics.py`: 실제 16kHz 분리 보컬만 읽어 **8개 실측 음향 동역학 지표**를 계산한다. 주파수 대역 세 비율·스펙트럼 밝기와 평탄도·음량(dBFS 상대 레벨)·40ms 음량 기울기·spectral flux이다. 이 지표는 **음소 정답이 아니다**.
2. `song_vision/real_training.py`: 원본 보컬에서 해당 8개 지표와 원래 80개 Mel 지표를 같은 10ms 타임라인에 맞춰 비공개 연구 데이터로 내보낸다. 기존 호출부 호환성을 위해 선택 매개변수 `save_acoustic_cues`의 기본값은 거짓이다.
3. `song_vision/voice_to_face_v11.py`: v10 `AudioFacialArticulationNet`을 계승하여 **별도 8×61 시퀀스(610ms)** 처리 경로를 추가한다. 원래 Mel 80×21(210ms)과 합쳐 입술 이미지·38개 움직임을 예측하며 기존 네트워크 파일은 수정하지 않는다.
4. `VoiceFaceFrames`: 각 실제 노래 영상 프레임의 보컬 특징과 피부 움직임을 25fps로 직접 연결한다. 다음 프레임(40ms) 운동 차이, 원래 영상에서 320ms 어긋난 보컬을 입력했을 때 예측 차이를 확인한다.
5. `train_voice_to_face`: `mouthMAE`와 입술 복사 기준, `facialMotionMAE`와 중립 표정 기준, 입·턱 주변 실제 움직임 오차, `matchedVsShiftedVoiceGain`, `soundControlsSensitivity`를 따로 기록한다. **음량을 강제로 입 벌림으로 연결하는 규칙은 없다.**
6. `song_vision/external_ravdess_voice_to_face_v11.py`: 실제 RAVDESS 가창 동영상 60개로 Actor01·02 학습, 처음 보는 Actor03 검증, 결과 가중치는 기존 사용자 공개키로 AES-GCM 암호화한 뒤 별도 보관.
7. `song_vision/test_voice_to_face_v11.py`: 합성 분리 보컬에서 음량 상승과 저음→고음 스펙트럼 변화가 서로 다른 입력값이 되는지, 음향 조건이 출력에 기울기를 전달하는지, 1 epoch 체크포인트가 생기는지 점검.

## 발음 인식과 움직임 학습은 구분

- **지금 구현되는 것:** 보컬 멜·대역 분포 및 시간 패턴이 입술 오므림·벌림 등 얼굴 이미지의 실제 움직임으로 이어지도록 오디오→모션 함수를 학습.
- **아직 검증되지 않은 것:** 특정 순간이 실제 한국어 /ㅁ/, /ㅂ/, /ㅍ/, /ㅗ/, /ㅜ/, /ㅏ/ 중 어디인지 **명시적으로 분류하는 음소 인식**, 음소별 전환 정확도, 완벽한 한국어 가창 립싱크.
- 엄밀한 자음·모음 정합성 평가는 소리와 시간 정렬된 **실제 가사/음소 주석**이 추가된 데이터와 독립 테스트가 필요하다. spectral centroid 같은 단일 수치가 자음을 알려준다고 간주하지 않는다.
- 보컬의 dBFS는 파일의 디지털 음량에 따른 상대 수치이며 실제 성대 압력, 근육 힘, 방송 기준 LUFS가 아니다.

## 실제 외부 자료 및 라이선스

- 공식 출처 https://zenodo.org/records/1188976, RAVDESS 원본, CC BY-NC-SA 4.0 **비상업 연구 전용**.
- 01·02 두 명의 실제 가창 영상 40개를 학습에 사용, 03 한 명의 영상 20개는 전체를 검증 전용으로 분리.
- 같은 실연 MP4에서 얻은 보컬(16kHz mono WAV)을 영상과 함께 처리한다. 다운로드 원본 MD5 검증이 완료되지 않으면 학습 중지.
- 상업 SONG 사용자, 유튜브 일반 가수, 고객의 개인 얼굴을 무단 학습시키지 않는다.

## 모델 보존

- 기존 v2, v9, v10 모델을 덮어쓰거나 지우지 않는다.
- 새 모델은 `research/song-vision-vault/encrypted/ravdess-voice-to-face-v11/` 아래의 **별도 암호화 모델** 및 성능 JSON으로 남긴다.
- `song_vision/research_vault_public.pem`을 사용하고, 복호화 개인키를 공개 GitHub·GitHub Actions에 올리지 않는다.
- GitHub Actions 보조 아티팩트는 90일이며, Git 브랜치 백업은 리포지토리·해당 브랜치가 유지되는 동안 보존된다.
- 이전 학습 모델을 초기값으로 쓰는 경우 연구 소유자가 별도로 복원한 v2 입술 가중치만 `--init-checkpoint`에 지정할 수 있고, 옵티마이저는 새로 초기화된다.

## 논문 근거 (1차 출처)

1. Chandrasekaran et al. (2009), *The Natural Statistics of Audiovisual Speech*, PLOS Computational Biology https://doi.org/10.1371/journal.pcbi.1000436 — 입 열림·음향 에너지 시간적 상관관계. 이것이 소리 크기만으로 입 모양을 결정한다는 뜻은 아님.
2. Jung et al. (2024), *Speed-Aware Audio-Driven Speech Animation using Adaptive Windows*, ACM TOG https://doi.org/10.1145/3691341 — 빠른 랩·느린 노래에서도 여러 길이의 오디오 문맥을 다루는 이유. v11의 210ms 및 610ms 두 창은 연구용 설계 선택이지 논문 실험에서 검증된 최적 수치는 아님.
3. Kim & Kim (2025), *Learning Phonetic Context-Dependent Viseme for Enhancing Speech-Driven 3D Facial Animation*, Interspeech https://arxiv.org/abs/2507.20568 — 이전·이후 발음 영향을 반영한 입 모양 전이 중요성.
4. Xie et al. (2025), *Let's Chorus: Partner-aware Hybrid Song-Driven 3D Head Animation*, CVPR https://openaccess.thecvf.com/content/CVPR2025/html/Xie_Lets_Chorus_Partner-aware_Hybrid_Song-Driven_3D_Head_Animation_CVPR_2025_paper.html — 가창과 감정·안면 운동 결합 연구. 타 연구의 생성 모델 가중치나 생성 API는 가져오지 않음.

## 완료 판정

- `python -m unittest song_vision.test_voice_to_face_v11 -v` 합성 회귀 테스트 통과만으로 실제 가창 성공이라고 주장하지 않는다.
- 실제 동기화 노래 영상의 독립 출연자에 대해 `mouthMAE < copiedReferenceMouthMAE`, `facialMotionMAE < staticFaceMotionMAE`, 맞는 음성 오차가 지연된 음성보다 낮은지 각각 확인. 만족하지 않으면 FAIL.
- 최종 합격 조건은 한국어 가창과 보컬·영상 싱크에 대한 별도 정답·사람 평가까지 포함해야 하며 이 단계에서 상업용 `canAcceptPaidJobs=false` 유지.
