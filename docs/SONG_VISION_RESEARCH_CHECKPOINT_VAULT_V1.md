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
