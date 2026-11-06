# SONG-Vision v7 — 36 epoch 반복 학습 실측 결과

기준일: 2026-11-06 | 브랜치: feature/song-vision-self-hosted-v1 | 상태: 비상업 연구용

## 실행과 데이터
- GitHub Actions: https://github.com/tlco1003/Song/actions/runs/42198736005
- 모델: song-vision-masked-audio-v2 (코드 song_vision/masked_retrain.py)
- 학습기: song_vision/external_ravdess_diverse_retrain.py
- 데이터: Zenodo RAVDESS Actor 01, 20개의 노래 실연 녹화, 학습 10클립 750프레임, 검증 10클립 750프레임.
- 출처: Livingstone & Russo (2018), PLOS ONE, https://doi.org/10.1371/journal.pone.0196391
- 라이선스: **CC BY-NC-SA 4.0**. 상업 사용 금지. 고객 영상 생성에 학습 가중치 적용하지 않음.
- 데이터 구성/모델 종류/초기 시드 42/배치 12/학습률 0.0003은 이전 10 epoch 실험과 동일.
- 반복 횟수: 최대 36, 최소 20, patience 10, min_delta 0.0002. 실제로 36 epoch 실행, earlyStopped=false.
- 이전 데이터·가중치는 임시 실행기에서 폐기되어 **기존 10회 모델에서 이어서 훈련한 것이 아니라 새로운 36회 학습**.

## 36회 실제 학습 결과
- GitHub Actions conclusion=success. Zenodo 원본 MD5 일치 확인.
- 학습 epoch: 요청 36, 완료 36, bestEpoch 36.
- trainLoss=0.0315821.
- valMaskedMAE=0.0509698.
- copyReferenceMaskedMAE=0.0456015.
- maskedInputMAE=0.1556235.
- shuffledAudioMaskedMAE=0.0552098.
- audioSensitivity=0.0263404.
- correctVsShuffledMAEGain=0.0042400.
- diagnosticFlags: [WORSE_THAN_COPY_REFERENCE].

## 앞선 10회 실험 비교(같은 구분 자료, 같은 네트워크)
| 지표 | 10회 실행 최고 epoch 7 | 새 36회 실행 최고 epoch 36 |
|---|---:|---:|
| valMaskedMAE | 0.0540299 | 0.0509698 |
| copyReferenceMaskedMAE | 0.0456015 | 0.0456015 |
| audioSensitivity | 0.0114378 | 0.0263404 |
| correctVsShuffledMAEGain | +0.0008137 | +0.0042400 |
검증 영역 MAE는 0.0030601 감소했으며 같은 지표의 10회 기록 대비 약 5.66% 감소했다.
같은 데이터 구성이지만 별도의 재학습 실행이므로 실험 간 환경 차이에 따른 작은 수치 차이는 존재할 수 있다.

## 중간 epoch 실측(소수점 표기는 액션 로그 그대로)
| epoch | valMaskedMAE | audioSensitivity |
|---:|---:|---:|
| 1 | 0.0828641 | 0.0008308 |
| 5 | 0.0550256 | 0.0089031 |
| 7 | 0.0540298 | 0.0114381 |
| 10 | 0.0547116 | 0.0159325 |
| 15 | 0.0556600 | 0.0207502 |
| 20 | 0.0538184 | 0.0223977 |
| 25 | 0.0526311 | 0.0237805 |
| 30 | 0.0518884 | 0.0273397 |
| 33 | 0.0518583 | 0.0264650 |
| 35 | 0.0513672 | 0.0267384 |
| 36 | 0.0509698 | 0.0263404 |

## 한계 및 판정
- 실험은 **신경망 학습 및 오디오 반응 증가를 확인**, 실제 발음에 맞는 가창 립싱크 성공을 증명하지 않음.
- copyReferenceMaskedMAE(0.0456015)가 새 모델 valMaskedMAE(0.0509698)보다 여전히 낮음. 품질 게이트 **FAIL**.
- 동등한 클립과 음소가 아닌 독립 가수, 새로운 한국어 가사, 고음/저음, 피부 일관성, 혀·치아 생성 및 고객 얼굴 변경은 검증되지 않음.
- matched/shuffled 오디오 비교는 배치 내 시점 셔플이므로 실제 음성-입술 정합성을 직접 평가하는 지표가 아님.
- 원본 동영상, 얼굴 이미지, 오디오 및 연구 모델 가중치는 임시 GitHub 실행 환경에서 생성·폐기. 공개 저장소 및 CI 아티팩트로 제공하지 않음.
- `canAcceptCustomerJobs=false` 및 기존 SONG 결제 차단 유지.

## 참고 로그 및 검사
- 36 epoch 실행: https://github.com/tlco1003/Song/actions/runs/42198736005
- 10 epoch 비교: https://github.com/tlco1003/Song/actions/runs/42196718131
- 새 코드 Python smoke 성공: https://github.com/tlco1003/Song/actions/runs/42199296790
- SONG Node.js 검사 성공: https://github.com/tlco1003/Song/actions/runs/42199296808
