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

## 실제 재학습 결과 A — 2개 가창 클립 / 6 epoch
GitHub Actions: https://github.com/tlco1003/Song/actions/runs/42195736778
- RAVDESS 원본 MD5 검증 통과, same Actor 01, train/val 75/75 프레임
- bestEpoch=6, valMaskedMAE=0.0827416
- copyReferenceMaskedMAE=0.0612735, maskedInputMAE=0.1598716
- audioSensitivity=0.0003023, correctVsShuffledMAEGain=0.000002
- 플래그: WORSE_THAN_COPY_REFERENCE, NO_POSITIVE_AUDIO_ALIGNMENT_GAIN
- 판정: 데이터 준비/실제 학습은 성공, 발음 연동 품질은 **FAIL**.

## 실제 재학습 결과 B — 다양한 20개 가창 클립 / 10 epoch
코드: song_vision/external_ravdess_diverse_retrain.py
GitHub Actions: https://github.com/tlco1003/Song/actions/runs/42196718131
- RAVDESS 원본 MD5 검증 통과
- 동일 출연자 Actor 01 / 두 가지 문장 / 다섯 감정 / 두 실연 반복: 10 train, 10 val, 750/750 프레임
- bestEpoch=7, trainLoss=0.0538161, valMaskedMAE=0.0540299
- copyReferenceMaskedMAE=0.0456015, maskedInputMAE=0.1556235
- shuffledAudioMaskedMAE=0.0548436, audioSensitivity=0.0114378
- correctVsShuffledMAEGain=+0.0008137: 해당 테스트 분할에서는 올바른 오디오를 연결했을 때 평균 오차가 약간 낮았다.
- 플래그: WORSE_THAN_COPY_REFERENCE
- 판정: 입력 음성 정보가 모델 출력에 더 크게 반영되기 시작했으나, **참조 입술 복사보다 오차가 커서 실사용 품질은 FAIL**.

## 수치 해석을 위한 주의
- 2개/20개 실험의 데이터 구성 자체가 다르므로 valMaskedMAE·audioSensitivity를 직접 같은 테스트셋 성능 향상으로 비교해서는 안 된다.
- v1 전체 이미지 MAE와 v2 가려진 영역 MAE는 지표의 평가 영역이 다르다.
- 섞은 오디오보다 맞는 오디오에서 오차가 약간 낮다는 사실은 단순히 오디오를 바꿔 넣은 실험의 통계이며, 실제 발음·입술 모양·치아/혀까지 정확한 립싱크라는 증거가 아니다.
- 모든 원본/얼굴 프레임 및 연구 체크포인트는 임시 GitHub 실행기에만 있었고 공개 저장소/배포 아티팩트에는 게시하지 않았다.
- RAVDESS는 CC BY-NC-SA 4.0. **연구 가중치를 고객 동영상·유료 서비스에 적용하지 않는다.**

## 상용 제품으로 연결하지 않는 상태
- 신경망 구조 개선·오디오 반응 확인: 연구 중간결과
- 가창 비짐/립싱크 정밀도, 독립 가수 성능, 피부/치아/혀 재생성, 고객 얼굴 동일성, 영상 연속성: 미검증
- SONG canAcceptCustomerJobs=false 유지. PR은 Draft 상태로 연구 코드만 보존.
