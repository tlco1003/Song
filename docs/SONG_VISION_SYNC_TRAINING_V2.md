# SONG-Vision: 실제 가창 영상 + 분리된 보컬 학습 파이프라인 v2
작성: 2026-11-06 · 브랜치: feature/song-vision-self-hosted-v1
상태: **실제 입력을 처리하는 학습 코드 구현 / 합성 자료로 E2E 실행 검증 / 실가수 모델 미학습·품질 미검증**

## 무엇이 새로 연결됐나

- 기존 자체 PyTorch 모델 \`SingingMouthNet\`은 유지하고, \`song_vision/real_training.py\`에 **실제 영상/오디오 입력용 명세·전처리·학습·검증**을 추가한다.
- 각 가창 영상은 영상 파일 MP4/MOV와 **해당 장면에 정확히 동기화된 보컬만 있는 WAV/MP3**를 입력한다. **완성 MP3의 반주가 섞인 오디오는 가능한 한 입력하지 않는다.**
- FFmpeg가 영상의 프레임레이트를 25fps CFR로 정규화한다. OpenCV가 프레임에서 얼굴을 검출하고 96×96 얼굴 영역을 저장한다. 검출이 어려운 자료는 원본 해상도 기준 \`faceBox\`를 지정할 수 있다.
- 사전에 동의를 확인하지 않은 클립은 등록할 수 없다. JSON 승인 레코드는 기술적 차단장치일 뿐, 실제 출연자의 법적 동의를 대신하지 않는다.
- 보컬은 16kHz 모노 파형을 80-bin log-Mel 특징으로 바꾸고 **각 프레임의 영상시간 + audioOffsetMs**를 보컬 특징 위치로 사용한다.
- 각 클립은 **train 또는 val** 중 하나로만 지정한다. 동영상 프레임을 무작위로 잘라 동일 클립이 train/val에 동시에 포함되는 누수를 방지한다.
- 각 epoch에서 검증 MAE, 입력 입술을 그대로 복사한 baseline MAE, 보컬 특징을 바꿨을 때의 출력 변화량을 보고한다.
- 검증 MAE가 최저인 epoch의 모델만 checkpoint에 저장한다. 별도 JSON 보고서도 생성한다.
- **주의:** 음성 민감도가 0에 가까우면 오디오를 제대로 사용하지 않는 모델일 수 있으며, MAE가 낮아도 입모양 일치가 증명되는 것은 아니다.

## 사전 준비

Python 3.11 이상, 설치된 FFmpeg/FFprobe, PyTorch가 실행 가능한 CPU 또는 CUDA GPU가 필요하다.
프로젝트 루트에서:

~~~sh
python -m pip install -r song_vision/requirements.txt
python -m unittest discover -s song_vision -p 'test_*.py' -v
~~~

## 원본 자료

**최소 2개 이상의 서로 다른 동기화된 가창 클립**이 필요하다: 학습용 1개 이상과 검증용 1개 이상. 각 클립은 정면이나 정면에 가까운 얼굴이 충분히 보이는 최소 0.64초 이상이어야 한다. 실제 모델 성능을 내려면 훨씬 다양한 동의된 가창 자료가 필요하다. 한 가수에서 여러 클립을 분리하면 **클립 단위 일반화만** 측정되고 새로운 가수에 대한 일반화는 측정되지 않는다.

입력 동의 기록의 예 (실제 출연자 권리 확인 후 비공개 저장):

~~~json
{"approved":true,"scope":"train_singing","subjectId":"authorized-singer-001"}
~~~

**실제로 권리를 확인하지 않았으면 approved:true를 작성하면 안 된다.**
학습 데이터, 얼굴 크롭, 모델 가중치, 파일 경로, 동의 문서는 공개 GitHub에 업로드하지 않는다.

**비공개 로컬 작업 폴더** 예:
~~~text
/private/song-training/
  consent.json
  manifest.json
  singer-A-take1.mp4
  singer-A-take1-vocals.wav
  singer-A-take2.mp4
  singer-A-take2-vocals.wav
~~~

위 영상과 WAV는 **동일한 실연의 녹음**이어야 하며, 별도 녹음이면 음소·발음이 일치하지 않아 학습이 성립하지 않을 수 있다. 가능하면 촬영과 함께 원음성 녹음한 후 같은 타임라인에서 보컬을 추출한다. 분리된 보컬 파일의 구간 시작점이 영상과 동일해야 한다.

## manifest.json 예시

아래 파일은 원본과 같은 비공개 폴더에 저장한다. 파일 경로는 manifest가 있는 디렉터리 기준 상대 경로이다.

~~~json
{
  "schemaVersion": 1,
  "clips": [
    {
      "id": "singer-A-take1",
      "split": "train",
      "video": "singer-A-take1.mp4",
      "vocals": "singer-A-take1-vocals.wav",
      "consent": "consent.json",
      "audioOffsetMs": 0,
      "maxSeconds": 30
    },
    {
      "id": "singer-A-take2",
      "split": "val",
      "video": "singer-A-take2.mp4",
      "vocals": "singer-A-take2-vocals.wav",
      "consent": "consent.json",
      "audioOffsetMs": 0,
      "maxSeconds": 30
    }
  ]
}
~~~

옵션 \`faceBox:[x,y,width,height]\`는 **원본 영상 픽셀 좌표**이다. 자동 얼굴 검출이 실패할 때만 촬영자/운영자가 직접 정확한 사각형을 설정한다.

\`audioOffsetMs\`는 **보컬 파일 시각 − 영상 시각**(밀리초)이다. 예: 영상 0초의 입술에 대응하는 보컬이 파일 0.2초라면 +200. 정확한 시간 동기화는 데이터 제작자가 확인해야 하며, 길이 비교만으로 립싱크 일치를 인증할 수 없다.

## 실제 동영상·보컬 처리 (외부 API 불필요)

~~~sh
python -m song_vision.real_training prepare \
  --manifest /private/song-training/manifest.json \
  --dataset song_vision/datasets/session-A
~~~

출력은:
- \`song_vision/datasets/session-A/train/<clipId>/{index.json,mel.npy,frames/*.png}\`
- \`song_vision/datasets/session-A/val/<clipId>/{index.json,mel.npy,frames/*.png}\`

모든 클립에서 프레임의 80% 이상 얼굴이 검출되어야 한다. 처리 실패 시 훈련을 시작하지 않는다. 잘못된 동기화·얼굴검출 데이터를 조용히 채택해서는 안 된다.

## 신경망 훈련 (직접 학습, 외부 서비스 없음)

~~~sh
python -m song_vision.real_training train \
  --dataset song_vision/datasets/session-A \
  --checkpoint song_vision/checkpoints/singing-synced-v2.pt \
  --epochs 30 --batch-size 8 --lr 0.0003 --device cpu
~~~

CUDA GPU가 있고 CUDA 지원 PyTorch로 설치했다면 \`--device cuda\`로 변경할 수 있다.

산출물:
- \`singing-synced-v2.pt\`: 검증 MAE 최소 epoch의 **자체 학습 가중치**
- \`singing-synced-v2.training-report.json\`: train/val 클립, 프레임 수, epoch별 trainLoss/valMAE/copyReferenceMAE/audioSensitivity, SHA256과 품질 한계

**검증 통과와 상용 품질 확보는 별개이다.** 표준 보컬 동기화, 사람 평가, 얼굴 정체성 유지, 프레임 간 일관성은 추가 검증 필요. 합성 테스트에서는 valMAE가 기준보다 나쁘거나 audioSensitivity가 거의 0일 수 있다. 이는 훈련 경로의 실행 성공만 증명한다.

## 연구용 MP4 생성

원곡 보컬 파일과 최종 원본 음악을 따로 입력하여 기존 v1의 render 경로를 사용한다.

~~~sh
python -m song_vision render \
  --template /private/song-training/singer-A-take1.mp4 \
  --vocals /private/song-training/singer-A-take1-vocals.wav \
  --mix /private/song-training/final-song.mp3 \
  --checkpoint song_vision/checkpoints/singing-synced-v2.pt \
  --output song_vision/outputs/research-demo.mp4 \
  --seconds 10 --start 0 --device cpu
~~~

실제 새 노래를 입력할 때는 해당 노래의 보컬 스템을 사용해야 한다. 템플릿의 원래 노래와 대상 노래를 혼동하면 입술 동기화가 맞지 않는다.

## 현 단계 한계와 주의

1. 이 구현에는 동의받은 실제 가수 원본 파일 및 훈련된 상용 모델 가중치가 들어 있지 않다. 합성 테스트만으로 진짜 가수 영상 품질을 주장할 수 없다.
2. v1 네트워크는 작은 입술 영역 이미지 재구성 모델이다. 높은 표현력의 새로운 생성형 전체 얼굴 모델이 아니며, 데이터가 적으면 오디오를 무시하는 실패가 발생할 수 있다.
3. 수동 offset 및 오디오 길이 검증은 **동기화의 자동 판별**이 아니다. 실제 촬영 시 박수/클랩/타임코드 기준을 녹화하거나 사람에게 라벨을 확인받아야 한다.
4. 선택적 정면 얼굴 인식·정적 얼굴 합성은 제한적이다. 얼굴이 옆으로 회전하면 생성 오류 가능성이 크다.
5. \`/api/video-ai/readiness\`는 연구 단계로 유지하며 **결제/고객 업로드/상용 AI 서비스 연동은 여전히 비활성화**한다.
6. SONG 프로젝트에 등록된 예시 노래 영상이나 온라인 타인의 가수 영상을 권리 확인 없이 학습에 사용하지 않는다.

## 기존 SONG 연결 유지

- 기존 노래, 결제, 고객 정보, PG, 코드 보호는 변경하지 않는다.
- v2 기능은 독립된 \`song_vision.real_training\` CLI로 추가한다.
- CI는 **합성 영상·보컬을 즉석 생성**해 prepare → train → checkpoint reload를 검증한다.
- 실제 사용 허가된 자료가 확보되면 동일한 명령으로 학습할 수 있으며, 결과/품질을 기록한 뒤 SONG 내부 모델 서비스 연결을 결정한다.
