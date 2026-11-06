# SONG-Vision multi-singer training v8: independently held-out performer

Reference date: 2026-11-06. Branch `feature/song-vision-self-hosted-v1`.

## Source and permitted uses
- Original Zenodo dataset: https://zenodo.org/records/1188976
- Livingstone & Russo (2018), PLOS ONE 13(5):e0196391 https://doi.org/10.1371/journal.pone.0196391
- CC BY-NC-SA 4.0: free research, **no commercial SONG model or paid videos**. Commercial license requires a separate agreement.
- RAVDESS is a 2018 database of professional actors singing short English phrases, **not** a full-length pop-song or Korean singing dataset. No claim of training on full song is made.
- Download source archives from the official Zenodo page only. Verify its published MD5 before extracting ANY clip.

## Official source ZIPs and recorded checksums
| Actor | Source ZIP | Official MD5 | Use |
|---|---|---|---|
| 01 male | Video_Song_Actor_01.zip | `0f7ba20f3a7278d5a662a7e30f44c942` | TRAIN |
| 02 female | Video_Song_Actor_02.zip | `8e426ef4134abe1dff4d2a8262abe8a9` | TRAIN |
| 03 male | Video_Song_Actor_03.zip | `2d686591f8760f8041d2dc75e8234828` | HELD-OUT VALIDATION |

20 separate actor recordings each: five emotions (calm, happy, sad, angry, fearful), two English statements, two repetitions, NORMAL intensity. Every selected file is mode `01` full audiovisual, channel `02` song.

## Data split and methodology
- Train: Actors 01 and 02, 40 recordings, projected 3 seconds × 25fps × 40 = about 3,000 frames (actual counts are from logs).
- Validation: Actor 03 entirely unseen during training, 20 recordings, projected about 1,500 frames.
- Strict actor-disjoint validation, not just separate video takes of the same singer as in v5-v7.
- For each MP4 recording, extract the exactly corresponding mono 16kHz WAV vocal directly with FFmpeg. Not a source separation model and no unrelated vocal overlay.
- Validate video duration/face crop coverage and temporal alignment in the existing `real_training.prepare_manifest` path.
- Train the same SONG `MaskedSingingMouthNet` from scratch, max 24 epochs, early stop after minimum 12, patience 7, minimum gain 0.0002, batch size 12.
- Analyze valMaskedMAE, copyReferenceMaskedMAE, correctVsShuffledMAEGain, audioSensitivity, and any failed gates.
- Track this as a **new independent-performer validation protocol**; compare with the prior same-actor experiment only with clear evaluation differences. No claim of apples-to-apples improvement.

## Model checkpoint MUST remain available
- Model and paired research report are encrypted using the **existing** `song_vision/research_vault_public.pem` (X25519/HKDF-SHA256/AES-256-GCM), and a recovery key held only by the owner, outside GitHub.
- Encrypted `.svault` and non-sensitive `.manifest.json` are committed to `research/song-vision-vault` under `encrypted/ravdess-actors-01-02-03/`.
- Secondary GitHub Actions artifact retention 90 days; encrypted Git branch copy remains until owner/repo deletes it. Protect the owner-held PRIVATE key.
- Originals (video, vocal, landmarks and frames) are ephemeral and NOT published to the public repo; only ciphertext and aggregate research metrics survive.
- The existing Actor-01 encrypted model from run 42202442871 is retained unchanged.
- New training does not use/reveal the owner's private key on CI, and does not unlock old models to warm-start; this is a new from-scratch 3-actor experiment.

## Exact current status
Source/license was verified from the official page. Code/CI are implemented and queued for actual execution. The GitHub Actions result is the authority for successful downloads, frame counts, epochs and checkpoint preservation. Do not claim real successful training without the success log, manifest and vault branch file.

## Code and workflow
- `song_vision/external_ravdess_multisinger.py` — source validation, performer split and workflow.
- `song_vision/test_multisinger_research.py` — offline source and no-leakage tests.
- `.github/workflows/song-vision-ravdess-multisinger.yml` — real download, actual training, encrypted backup and Git push.
- `song_vision/research_checkpoint_vault.py` — exact-allowlist research dataset check, authenticated encryption.
- `https://github.com/tlco1003/Song/actions/workflows/song-vision-ravdess-multisinger.yml`

## Scientific caveats
Even passing trainer tests only means video/audio sync and optimization code ran. A lower MAE or a positive audio sensitivity is NOT objective phoneme-to-mouth synchronization, identity consistency, video generation quality, Korean singer generalization or consent to commercial face swapping. No customer jobs are enabled.

## 2026-11-06 — 실행 검증 완료 (실제 원본 / 실제 가창 프레임)

- 실행 링크: https://github.com/tlco1003/Song/actions/runs/42222592317
- GitHub Actions 전체 결론 `success`; 최종 학습, 암호화 아티팩트 업로드, 별도 연구 Vault Git 브랜치 저장 단계 모두 성공.
- 원본 세 파일 Zenodo 공식 MD5 **모두 일치**:
  - 01: `0f7ba20f3a7278d5a662a7e30f44c942`, 502,513,588 bytes
  - 02: `8e426ef4134abe1dff4d2a8262abe8a9`, 553,420,328 bytes
  - 03: `2d686591f8760f8041d2dc75e8234828`, 508,655,610 bytes
- 학습 출연자 [01,02]의 가창 40개, 학습 3000 프레임. 학습에 포함되지 않은 출연자 [03]의 가창 20개, 독립 검증 1500 프레임.
- 학습 최대 24 epoch 요청 → 실제 19 epoch 실행 후 조기 종료 (best epoch 12).
- best epoch 12: trainLoss `0.0380804`, valMaskedMAE `0.0740105`, copyReferenceMaskedMAE `0.0500151`, maskedInputMAE `0.1595127`.
- shuffledAudioMaskedMAE `0.0787299`, audioSensitivity `0.0241283`, correctVsShuffledMAEGain `+0.0047194`.
- 진단 플래그 `WORSE_THAN_COPY_REFERENCE`.
- 모델이 처음 보는 출연자의 입술을 예측한 오차는 단순 참조 입술 복사 기준보다 약 **47.98% 더 큼**. **실제 가창 립싱크 모델의 품질 게이트 실패.**
- 맞는 오디오와 순서를 바꾼 오디오의 오차 차이는 양수이지만, 발음 시점 정합성·한국어 노래·치아·혀 생성·상용 고화질 얼굴 변형 성공을 의미하지 않는다.

### 실제 연구 모델 보존과 복원 증명
- 영구 보존 브랜치 `research/song-vision-vault` 커밋 `eb4fc908ccb8fc221792c4c7afe120363c215ad8`.
- 암호화 모델 파일 `encrypted/ravdess-actors-01-02-03/song-ravdess-3actors-run-42222592317-attempt-1.svault`
- 공개 암호문 크기 `5,292,662` bytes, SHA-256 `f968ff03cea6cd2d596a430a48d901b6767b8290cf4f6683557080e850e20f68`.
- 연구 메타데이터 `.svault.manifest.json` 별도 저장; 상업 이용 불허, 데이터셋 3 actors, 독립 검증·검증 수치 포함.
- Actions 부가 백업 artifact ID `13505017211`, 90일 보존 설정. 별도 Git 브랜치 보존은 해당 보존기간과 무관하다.
- **실제 비공개 복구 테스트 성공**: 기존 별도 X25519 개인키로 인증 암호화 봉투 복호화, 체크포인트 `4,284,829` bytes 추출, `torch.load(weights_only=True)` 성공.
- 복구 모델 `song-vision-masked-audio-v2`, epoch 12, `stateDict` 28개 텐서, 총 파라미터 1,068,683개, `canAcceptPaidJobs=false` 일치.
- 원본 영상과 가창 WAV·가수 얼굴 이미지는 연구 Vault에 포함되지 않는다. 복원용 개인키도 GitHub에 보관하지 않는다.
- 이전에 보관한 36 epoch Actor01 연구 가중치는 다른 암호화 파일로 그대로 유지한다.
- RAVDESS 원본 `CC BY-NC-SA 4.0` 권리 범위만을 따른 **비상업 연구용** 결과. SONG 고객 영상 제작/유료 음원 서비스에 모델을 연결하지 않는다.

### 다음 연구 판단
- 동일 출연자에서의 검증 오차 감소와 독립 출연자에 대한 일반화는 다른 과제다. 이번 독립 출연자 성적을 기존 Actor01 단독 연구 성적과 직접 동일 기준으로 비교하면 안 된다.
- 추가 데이터 수집 이전에도 발음별 viseme 정답·중립 참조 이미지·아래턱 및 입술 실제 랜드마크와의 대응 손실, 비디오 시간 일관성 같은 평가 체계를 개선해야 한다.
