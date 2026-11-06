# SONG-Vision v9 — 얼굴 전체 가창 표면 움직임의 공동 학습

날짜: 2026-11-06 | 브랜치 `feature/song-vision-self-hosted-v1` | 비상업 연구 전용

## 사용자 요구와 달성 범위
- 기존 입술-only MaskedSingingMouthNet v2의 가중치가 남아 있으며 새 코드에서는 삭제·덮어쓰기 하지 않는다.
- 새 공동 모델 `JointSingingFaceNet`은 **같은 보컬 오디오 특징과 참조 영상의 상부 얼굴 특징**을 공유해 (1) 64x64 입술 이미지, (2) 12개 가시적 얼굴 표면 움직임을 함께 예측한다.
- 각각의 입술 복원 손실과 얼굴 표면 움직임 손실을 공동 최적화한다. 예측 움직임은 입술 복원 디코더에도 연결되어 **joint learning** 경로를 만든다.
- 실제 영상 가수의 Google MediaPipe Face Landmarker 478 표면 좌표와 `jawOpen`/`cheekPuff`/`cheekSquintLeft`/`cheekSquintRight` 표정 계수를 프레임별 **로컬 이미지 분석 정답 후보**로 추출한다.
- 입술 틈, 입 폭, 코-아랫입술 상대 위치, 코-턱끝 상대 위치, 양 볼의 수직·수평 상대 이동, 네 가지 표정 계수를 분석한다.
- 좌표는 두 눈의 중심 축과 양 눈 사이 거리를 기준으로 정규화한다. 각 가수·클립의 중위값과 차이를 학습해 정적인 얼굴 생김새보다 표면 운동에 집중한다.
- **특히 광대와 턱 움직임을 함께 학습하지만, 실제 광대뼈(zygomatic bone)·하악골 관절 위치를 측정하는 것은 불가능하다.** 얼굴 피부의 투영된 표면 좌표만 보인다.
- 사전학습된 Google 좌표 탐지기는 별도 로컬 도구로 사용하고, SONG 자체 신경망은 처음부터 별도 설계·학습한다. 이는 Google 모델 자체를 SONG이 학습했다는 뜻이 아니다.
- 478개의 원시 표면 좌표도 임시 private `.npz`에 저장하지만 **실제로 학습하는 출력은 안정화된 12개 움직임 지표**이다. 478개 각각을 직접 예측하는 모델은 아직 아니다.
- 현 64x64 입술 이미지 디코더는 광대와 턱 주변의 모든 픽셀을 생성하지 못한다. 실제 고품질 얼굴 전체의 영상 생성은 별도 디코더·temporal consistency 추가가 필요하다.

## 실제 코드
- `song_vision/face_surface_motion.py`: 478점과 표정 계수에서 12개 지표, 얼굴 프레임별 라벨링, 검출 실패한 프레임 제외, 80% 미만 검출이면 fail-closed.
- `song_vision/joint_face_training.py`: 오디오·비디오 멀티태스크 PyTorch; 입술·턱·볼 손실을 공동 계산, 입술 복사/중립 표면 motion/섞인 오디오 기준 검증.
- `song_vision/external_ravdess_face_joint.py`: RAVDESS 공식 3 출연자 ZIP의 MD5와 라이선스 검증→얼굴·음성 정렬→랜드마크 라벨링→공동 학습→암호화 보관.
- `song_vision/test_joint_face_training.py`: 개인 데이터 없는 합성 478점, 볼·턱 위치 변화, 오디오-표면 양방향 gradient, 실제 checkpoint save/reload 테스트.
- `.github/workflows/song-vision-face-joint.yml`: Google task 로컬 번들 SHA-256 검증, Python 모델 검사, 실제 3 출연자 학습, 체크포인트 90일 별도 아티팩트 및 Git branch Vault 보존.

## 가중치 이어 학습
기존 v2 체크포인트는 `--init-checkpoint /private/restored/research-model.pt`로 제공할 수 있다. 이 경우 **입술 서브네트워크만** 엄격히 검증하여 로드하고 새 얼굴 표면 예측 헤드는 새로 초기화한다.
이전 AdamW 모멘텀 등 옵티마이저 상태는 복원하지 않으므로 bit-for-bit 연속 학습이 아니다.
GitHub 자동 학습에는 사용자의 개인키를 업로드하지 않는다. 따라서 기존 v2 모델을 자동 복호화해 이어 학습하지 않고, 3인 연구 자료로 **v9 모델을 처음부터 새로 학습**하도록 했다.
학습 체크포인트를 생성하면 기존 연구 전용 공개키로 암호화해 `research/song-vision-vault/encrypted/ravdess-face-joint-v9/`에 보관한다. 가중치 평문은 공개하지 않고 기존 파일을 덮어쓰지 않는다.

## 권리와 독립 검증
- 데이터: RAVDESS Livingstone & Russo (2018), PLoS ONE. https://doi.org/10.1371/journal.pone.0196391
- Zenodo https://zenodo.org/records/1188976 — **CC BY-NC-SA 4.0 / 비상업 연구용**. SON G 유료 고객 영상 생성에는 사용 불가.
- 훈련 출연자 01·02, 미학습 검증 출연자 03(남성), 모두 실제 가창 영상과 같은 실연 오디오.
- 얼굴 정렬이 안 되거나 478점 검출이 80% 미만이면 학습을 멈추며 임의 좌표를 만들어 채우지 않는다.
- 독립 출연자 검증은 새 가수 일반화 테스트이지만 한국어 발음·가창의 실제 lip-sync 품질이 보장되지는 않는다.

## 연구 참고 문헌 (실제 출처)
1. Google Face Landmarker 공식 478 표면 점과 52 expression blendshape 설명: https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker
2. Investigating Vocal Tract Configurations Across Different Belting Qualities in Female and Male Musical Theater Singers Using Real-Time Dynamic MRI, Journal of Voice (online 2025-05-16), DOI https://doi.org/10.1016/j.jvoice.2025.04.021 — 가창 조건에 따라 입술·턱 열림이 변하며 영상만으로 내부 해부학 전체를 알 수 없음을 뒷받침.
3. Xie et al., Let's Chorus: Partner-aware Hybrid Song-Driven 3D Head Animation, CVPR 2025 https://openaccess.thecvf.com/content/CVPR2025/html/Xie_Lets_Chorus_Partner-aware_Hybrid_Song-Driven_3D_Head_Animation_CVPR_2025_paper.html — 가창 음성 기반 입술·얼굴/머리 운동을 별도로 모델링할 필요에 관한 연구. 해당 논문의 pretrained 모델이나 가중치를 SONG에 가져다 쓰지는 않는다.

## 결과 판정
- 학습 스크립트 성공·얼굴 라벨링 성공과 **실제로 보컬에 따라 자연스럽게 입과 볼·턱이 움직이는 생성 품질은 별개**다.
- 검증 지표: `mouthMaskedMAE` vs `copyMouthMAE`; `motionMAE` vs `zeroMotionMAE`; `chinJawMAE`; `cheekMotionMAE`; matched-vs-shuffled audio gain.
- 기준보다 성능이 나쁘면 quality FAIL로 남기며 상업용 연결하지 않는다.

## 실제 CI 실행
- https://github.com/tlco1003/Song/actions/workflows/song-vision-face-joint.yml
- 실제 수치, 프레임 검출 비율, 모델 Vault 저장 여부는 GitHub Actions 실행 완료 로그를 확인한 후에 기록한다.
