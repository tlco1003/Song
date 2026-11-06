# SONG-Vision v6 — 가창 오디오에 반응하지 않는 문제를 개선하는 재학습
작성 2026-11-06 | 브랜치 feature/song-vision-self-hosted-v1

## 연구 데이터 및 사용 범위
RAVDESS Zenodo 원본: https://zenodo.org/records/1188976
원논문: Livingstone & Russo (2018), PLOS ONE 13(5):e0196391. DOI https://doi.org/10.1371/journal.pone.0196391
라이선스 **CC BY-NC-SA 4.0 — 비상업 연구 전용**, 상용 SONG 주문·영상 제작에 적용 금지.

## 기존 실행에서 확인된 학습 실패
실제 가창 학습 기록: https://github.com/tlco1003/Song/actions/runs/42193174990
Actor 01의 서로 다른 실연으로 train/val 75/75 프레임. 기존 v1의 1 epoch 결과: valMAE=0.134937, copyReferenceMAE=0.058546, audioSensitivity=0.00001133.
따라서 모델이 노래 소리를 거의 무시하고 참조 입술을 복사하는 것보다 못했음.

## 이번 수정: masked-reference SingingMouthNet
- 파일: song_vision/masked_retrain.py / 모델 song-vision-masked-audio-v2
- 기존 v1 네트워크를 삭제하거나 체크포인트를 덮어쓰지 않는 별도 새 네트워크.
- 참조 이미지에서 입술 중심을 반드시 마스킹해 원래 입술을 단순 복사하는 우회 입력 차단.
- 피부·주변 문맥의 이미지 인코더와 음성 Mel 인코더를 별도로 학습하고 spatial bottleneck에서 결합.
- 주로 가려진 입술의 픽셀과 영상 경계 기울기를 복원하며, 최적 검증 모델 체크포인트 저장.
- 지표 valMaskedMAE, copyReferenceMaskedMAE, maskedInputMAE, audioSensitivity, correctVsShuffledMAEGain 보고.
- 올바른 오디오를 넣은 결과가 프레임 순서를 바꾼 오디오보다 실제로 나은지 별도 평가.

## 실행
학습 스크립트 song_vision/external_ravdess_retrain.py.
자동 CI: .github/workflows/song-vision-ravdess-masked-retrain.yml
Zenodo archive MD5 검증 → 같은 배우 실제 가창 영상 두 개 추출 → 음성 WAV 동기화 → 25fps 입술 얼굴 프레임 → 6 epochs → 수치만 기록.
원본 영상·얼굴 크롭·보컬 WAV·학습 모델 가중치는 공개 GitHub에 올리지 않고 임시 실행기 종료 시 폐기.

## 기준과 한계
- v1 전체 이미지 MAE와 v2 입술 가림 영역 MAE는 측정 위치가 달라 수치 그대로 직접 비교 불가.
- audioSensitivity가 양수여도 발음 정확도를 의미하지 않음. correctVsShuffledMAEGain >0이더라도 실제 동기화 품질은 사람이 검수해야 함.
- 동일 배우 두 번의 동일 문장으로 새 가수/새 발음/한국어 일반화 성능은 증명되지 않음.
- 치아·혀 생성, 자연스러운 립싱크, 고객 얼굴 신경망 교체, 상업용 사용 허가 및 실제 운영 배포는 여전히 미완료.
- 기존 결제·고객 업로드·자동 작업 경로는 계속 차단.

## GitHub 실제 실행 결과
GitHub Actions 종료 후 실제 valMAE, audioSensitivity, correctVsShuffledMAEGain, 경고 플래그를 이 문서에 기록한다.
