# SONG-Vision 외부 실제 가창 데이터 연구 실험 v5

기준일: 2026-11-06. 상용 이용과 분리된 내부 검증, 실제 가수 데이터 학습 **실험**만 해당한다.

## 데이터셋 조사 및 사용권
- **RAVDESS** (Livingstone & Russo, 2018; PLOS ONE 13(5): e0196391, doi:10.1371/journal.pone.0196391), https://zenodo.org/records/1188976.
  - 23명의 전문 배우 가창 녹화 및 일치하는 실연 음원 제공.
  - 라이선스 **CC BY-NC-SA 4.0**. 상업용 라이선스는 ravdess@gmail.com에서 별도로 구매해야 한다.
  - 이번 코드는 *한 남성 배우(Actor 01)*의 서로 다른 두 번의 노래 실연만 시험한다.
  - 오디오비디오 MP4에서 **같은 촬영의 오디오**를 WAV로 추출한다. 실제 보컬 분리 알고리즘을 성공시킨 것으로 과장하지 않는다. RAVDESS 가창 샘플은 단독 배우 발성이다.
- **SingingHead** https://huggingface.co/datasets/Human-X/SingingHead: 비상업 연구 전용, 별도의 접근 동의 요구. 본인은 허가를 대신하지 않으며 자동 다운로드하지 않는다.
- **URSing** https://zenodo.org/records/6404999: 일치하는 솔로 보컬·노래 영상, 다만 데이터 크기와 실제 이용 허가 조건이 추가로 필요.
- **MULTIVOX** https://zenodo.org/records/17058101: CC BY 4.0, 360도/합창 영상이며 얼굴 가림·원거리 녹화가 있어 얼굴 클로즈업 학습으로는 부적합.

## 정확히 실행하는 과정
1. GitHub Actions는 연구 소스가 변경될 때만 임시 Ubuntu 머신에서 실행된다. 일반 Node/결제 경로에서는 호출하지 않는다.
2. Zenodo RAVDESS 원본 Video_Song_Actor_01.zip 파일 다운로드. 공식 공개된 MD5로 진위 확인, 다운로드 상한 530MiB.
3. 두 오디오-비디오 가창 클립 선택:
   - 학습: 01-02-03-01-01-01-01.mp4
   - 검증: 01-02-03-01-01-02-01.mp4
   파일 이름 = AudioVideo, Song, Happy, Normal, Sentence 1, Repetition 1/2, Actor 01.
4. 동일한 실연의 오디오를 FFmpeg로 16kHz WAV로 변환, 동기화된 영상/보컬 manifest 생성.
5. 기존 real_training.prepare_manifest로 25fps, 얼굴 추적, 음향 멜 특징과 프레임 추출.
6. 기존 train_validated로 PyTorch SingingMouthNet 1 epoch 실제 프레임 훈련, MAE / copy-reference baseline / audio sensitivity 비교.
7. 실행 로그에 비식별 통계만 남기고 모든 영상, 음원, 추출 프레임, 체크포인트는 임시 머신 삭제와 함께 폐기한다. 공개 GitHub 또는 Actions artifacts로 업로드하지 않는다.

## 중요한 한계
- 2개의 반복 촬영은 **같은 배우, 같은 문장**으로 독립 배우 일반화 평가가 아님.
- 1 epoch 최적화는 오디오-영상 파이프라인 확인일 뿐 실제 입모양 자연스러움/싱크 성공을 입증하지 않음.
- 현재 모델은 오디오를 무시하고 reference mouth를 복제하는 실패를 일으킬 수 있다. valMAE와 copy-reference 및 audio sensitivity를 별도로 비교해야 한다.
- **CC BY-NC-SA 데이터에서 얻은 학습 가중치를 SONG 상업용 모델로 제공하거나 재사용하지 않는다.**
- 실제 상용 학습에는 출연자의 AI 모델 학습 동의, 합당한 저작권 및 영리 사용 라이선스가 확보된 별도 자료가 필요.
- 현재 프로덕션 API의 canAcceptCustomerJobs=false 유지. 다른 사용자의 사진·얼굴 교체에 실험 가중치를 사용하지 않는다.

## 자료 출처
RAVDESS DOI: https://doi.org/10.5281/zenodo.1188976
원논문: https://doi.org/10.1371/journal.pone.0196391
RAVDESS 연구실 설명: https://affectivedatascience.com/datasets

테스트/실행: .github/workflows/song-vision-ravdess-research.yml
학습 코드: song_vision/external_ravdess_research.py
기존 신경망: song_vision/core.py / real_training.py

**Github Actions 결과를 확인하기 전에는 실제 외부 자료 학습 완료라고 표기하지 않는다.**


## 2026-11-06 실제 GitHub Actions 검증 결과 (완료)

실행: https://github.com/tlco1003/Song/actions/runs/42193174990
커밋: 4397b5c03132a134b235229035781f458f9b0477

- GitHub Actions job conclusion: **success** = 코드·실제 데이터 학습 경로 실행 완료라는 의미.
- Zenodo 원본 MD5: **검증 통과** (md5 0f7ba20f3a7278d5a662a7e30f44c942).
- 실제 Actor 01의 서로 다른 두 노래 실연: train 75 frames / val 75 frames.
- 1 epoch trainLoss: **0.138541**.
- 검증 valMAE: **0.134937**.
- 원본 mouth reference 복사 baseline MAE: **0.058546**.
- audioSensitivity: **0.00001133**.
- 진단 실패 플래그: **WORSE_THAN_COPY_REFERENCE**, **LOW_AUDIO_SENSITIVITY**.

**결론은 신경망 가창 립싱크 품질 FAIL이다.** 실가수 데이터 학습 코드가 실행되었지만 모델이 소리를 실제 입술 형태로 충분히 바꾸지 못했다. 이 수치를 임의로 합격 처리하거나 v5를 상용 가창 AI라 홍보해서는 안 된다.

기존 구조에 남은 연구 문제:
1. Reference crop에 원래 입술 형태가 그대로 들어가 오디오 특징을 무시하는 shortcut learning이 가능하다. Reference mouth 마스킹/다른 프레임 참조 및 Audio-Visual Counterfactual 평가를 설계한다.
2. 동일 배우·동일 문장 두 번의 3초 데이터로는 발음별/가수별/장르별 일반화 불가능. 동의된 다인물·다음소·다양한 음역 및 긴 모음 자료를 수집한다.
3. 복사 baseline과 독립 음소-입술 정확도를 통과하기 전에는 연구 체크포인트를 고객이나 상품에 연결하지 않는다.

RAVDESS 비상업 연구 가중치는 GitHub Action 임시 머신 종료로 폐기됐으며 사용자에게 판매용으로 제공하지 않는다. 상업용 훈련의 경우 별도로 **상업 AI 합성·학습이 명시적으로 허가된 출연자 자료**를 확보해야 한다.
