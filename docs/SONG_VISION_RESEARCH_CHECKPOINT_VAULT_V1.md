# SONG-Vision 연구용 모델 백업 · Research Checkpoint Vault v1

이 기능은 **사용자가 직접 연구를 이어갈 수 있도록 가중치를 보존**하는 기능이다. 기존과 달리 학습된 모델을 실행 종료 시 폐기하지 않는다.

## 보존 정책
- RAVDESS는 **CC BY-NC-SA 4.0**, 연구 백업은 비상업 연구용으로만 사용하며 SONG 고객 영상 결제/생성에 사용 금지. 공식 원본: https://zenodo.org/records/1188976
- 원본 가수 영상/보컬/프레임 데이터는 GitHub에 저장하지 않는다.
- 체크포인트 `research-model.pt` + 훈련 보고서 + 라이선스 표시문만 ZIP에 넣어 X25519/HKDF-SHA256/AES-256-GCM으로 인증 암호화한다.
- 공개 GitHub에는 **암호문 `.svault`**, 해시와 수치 보고서만 저장한다.
- 장기 보관 Git 브랜치: **research/song-vision-vault** (같은 공개 저장소 안의 별도 브랜치). 해당 브랜치가 유지되는 동안 암호문도 Git에 보존된다. 사용자가 삭제·리포지토리 삭제·플랫폼 장애 등은 별도 백업이 없으면 복구할 수 없다.
- 재학습 시 이전 파일을 덮어쓰지 않고 GitHub Actions `run_id`와 시도 번호로 파일 이름을 구분한다.
- GitHub Actions 아티팩트에는 암호문만 **90일 임시 백업**으로 올린다. Git 브랜치 백업은 이 만료와 별개다.
- 학습용 디렉터리의 원본 미디어는 실행 완료 후 정리되며, **가중치 암호화 백업은 계속 남긴다.**
- 복호화 **개인키는 GitHub에 올리지 않는다.** 개인키는 사용자에게 안전한 링크로 별도 전달. 이 키를 분실하면 암호문을 복원할 수 없으므로 다른 비공개 장소에 반드시 별도 백업.
- 데이터의 NC 라이선스가 모델 가중치에 어떤 범위로 적용되는지 개별 판단이 필요할 수 있다. 따라서 공개 가중치 대신 암호문만 공개하며, 상업적 사용 허가가 없는 한 고객 서비스에서 로딩하지 않는다.

## 연구 기록 복원
1. GitHub 저장소의 `research/song-vision-vault` 브랜치에서 원하는 run 번호의 `.svault`를 컴퓨터로 받는다.
2. SONG 프로젝트 파일(공개 코드)에서 `python -m pip install -r song_vision/requirements.txt` 실행 후 아래 명령을 사용한다.
3. 해당 파일에 맞는 **SONG_Vision_Research_Vault_PRIVATE_KEY.pem**이 필요하다. 이 파일은 GitHub에 절대로 업로드하지 않는다.

```bash
python -m song_vision.research_checkpoint_vault decrypt \
  --encrypted /private/downloaded/checkpoint.svault \
  --private-key /private/SONG_Vision_Research_Vault_PRIVATE_KEY.pem \
  --out-dir /private/restored-song-vision-research
```

복원 결과는 `research-model.pt`, `training-report.json`, `NONCOMMERCIAL_LICENSE_NOTICE.txt` 세 파일이다. `modelVersion`을 확인하여 해당 모델 구조와 코드 버전으로 불러오며, 프로덕션에는 연결하지 않는다.

## 수치 및 연구 이력
- 기존 36회 연구 실행 https://github.com/tlco1003/Song/actions/runs/42198736005 에는 남겨진 아티팩트가 없어 해당 **과거 가중치는 복원 불가능**하다.
- 이 설정 반영 후 새 RAVDESS 연구 학습부터 암호화된 체크포인트를 보존한다.
- 훈련은 일반 고객 결제 경로와 분리되고 `canAcceptCustomerJobs=false`를 유지한다.

## 보안 주의
- `.svault` 암호화가 깨지지 않아도 암호문 자체는 공개 브랜치에 존재한다. 개인키는 비밀로 관리한다.
- 공개 README에 개인키, 개인 얼굴, 고객 보컬, 개인정보를 올리지 않는다.
- 암호문 파일의 복호화/무결성 여부는 `song_vision/test_research_checkpoint_vault.py`의 합성 라운드트립 테스트와 실제 암호화 성공 CI 단계로 각각 확인한다.

## 2026-11-06 실제 체크포인트 암호화 저장 성공
- Actions 실행: https://github.com/tlco1003/Song/actions/runs/42202442871 — training, 90-day encrypted artifact upload, durable Git branch commit 단계 모두 success.
- 백업 브랜치: https://github.com/tlco1003/Song/tree/research/song-vision-vault/encrypted/ravdess-actor-01
- 암호화 파일: `song-ravdess-research-run-42202442871-attempt-1.svault` (5,291,640 bytes).
- 백업 Git 커밋: `7a90f3c6f95e2b6e0d8f8b63ab6869be43b4a905`.
- Actions artifact: `song-ravdess-encrypted-vault-42202442871-a1` (artifact ID `13494818246`).
- SHA256(암호화 파일): `e3e9a17796b6e094d9cff9a3409da966549ce9fd6ada1cece25fe3ecdc0294dc` (실제 학습 로그와 Git 모델 매니페스트 일치).
- 모델 버전 `song-vision-masked-audio-v2`, 36 epoch, train 750 frames, val 750 frames.
- 검증 valMaskedMAE 0.0509698, reference-copy baseline 0.0456015. 오디오 반응은 있지만 최종 립싱크 품질은 **불합격**.
- 기존 개인키 파일과 커밋된 X25519 공개키는 연결되는 키쌍임을 로컬에서 확인했다.
- **실제 Git 암호문을 개인키로 복호화하여 가중치 전체를 재로드하는 통합 검증은 미실행**. 암호화/복호화 단위 라운드트립은 합성 테스트로 검증한다.

## 이후 학습에서 저장된 가중치 활용
- `song_vision/masked_retrain.py`는 `--init-checkpoint`로 **소유자만 복호화한 연구용 모델**을 초기 가중치로 읽는 선택지를 지원한다.
- 기존 모델 파일은 덮어쓰지 않고 새 경로에 결과를 저장하도록 fail-closed 처리가 추가되었다.
- **이는 학습 가중치로 시작하는 warm-start**이고 기존 AdamW 옵티마이저 상태와 RNG/셔플 상태까지 정확히 이어받는 완전한 resume은 아니다.
- 공개 Actions에는 개인키가 없기 때문에 암호화된 모델에서 자동으로 다음 학습을 이어받지 않는다. 소유자가 개인키로 모델을 복구한 비공개 학습 환경이 필요하다.
- 다음 원본 데이터 학습을 처음부터 하는 대신, 복구한 파일을 `--init-checkpoint /private/restored-song-vision-research/research-model.pt`로 지정해 가중치를 재사용할 수 있다.
- 여전히 RAVDESS 비상업 연구 전용이며 고객용 서비스로 연결 불가.

## 2026-11-06 실제 영구 백업 및 복원 확인
- 데이터: RAVDESS Actor 01 노래 20클립, train/val 각 750 프레임, 36 epoch, best epoch 36.
- 작업 성공: https://github.com/tlco1003/Song/actions/runs/42202442871
- 암호화 연구 백업 브랜치 커밋: 7a90f3c6f95e2b6e0d8f8b63ab6869be43b4a905
- 파일: `encrypted/ravdess-actor-01/song-ravdess-research-run-42202442871-attempt-1.svault`
- 파일 크기: 5,291,640 bytes.
- 파일 SHA-256: `e3e9a17796b6e094d9cff9a3409da966549ce9fd6ada1cece25fe3ecdc0294dc`.
- 별도 manifest: 동일 폴더의 `.svault.manifest.json`, 출처·라이선스·검증수치·원본 불포함 여부.
- 긴급 백업 GitHub Actions artifact ID: `13494818246`, expires_at `2027-02-04T10:24:34Z`. 이 기간 뒤에도 Git 브랜치의 암호문 파일은 별도로 유지.
- **실제 복원 검증:** 사용자가 보관할 X25519 개인키로 AES-GCM 봉투 복호화 성공, ZIP 내부에서 `research-model.pt` 4,284,595 bytes, 보고서, 라이선스 표시 확인.
- **PyTorch 재로드 검증:** `torch.load(..., weights_only=True)` 성공, `modelVersion=song-vision-masked-audio-v2`, `epoch=36`, `stateDict` 텐서 항목 28개 확인.
- 원본 라이선스 CC BY-NC-SA 4.0 / 상업 사용 불허 / `canAcceptPaidJobs=false` 유지.
- 앞선 실행 42198736005의 가중치는 저장하지 않아 복구할 수 없지만, **이번 새 실행 42202442871의 체크포인트는 장기 보존됨**.
- 모델 저장과 복구 검증은 성공했지만, 발음 정확도는 여전히 참조 입술 복사 기준보다 떨어져 제품 품질 합격을 의미하지 않음.
