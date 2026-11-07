# SONG-Vision v27 — 실제 논문 기반 입술·하관 연동 연구

## 연구 근거 (원논문 / 논문 초록 확인)

1. 김부일·양룡·이태원 (1987), **한국어 모음의 조음적 제어에 관한 연구**, 정보과학회논문지 14(3), 194–202. https://www.dbpia.co.kr/journal/articleDetail?nodeId=NODE00605411  
   X선·정면/측면 영상을 동시 관찰한 논문. 한국어 모음의 턱 열림각 3단계와 입술 개구면적·턱 열림의 거의 선형적인 관계를 보고하며, 입술의 능동 오므림을 별도 제어로 서술. *본 연구의 수치와 코드의 픽셀 이동값은 동일 단위가 아니다.*
2. Masapollo et al. (2025), **Interarticulator Timing Relations Underlie the Production of Precise and Consistent Vocal Tract Constrictions During Speech**, Journal of Speech, Language, and Hearing Research 68(6), 2700–2720. DOI https://doi.org/10.1044/2025_JSLHR-24-00535  
   턱·입술·혀의 시간적 협응. 이 논문은 직접적인 개인의 얼굴 모델 가중치를 제공하지 않는다.
3. 장민정·정선진·노준용 (2020), **한국어 동시조음 모델에 기반한 스피치 애니메이션 생성**, 한국컴퓨터그래픽스학회논문지 26(3), 49–59. DOI https://doi.org/10.15701/kcgs.2020.26.3.49  
   한국어 모음에 따른 입술·혀 동시조음을 분리하고 음성·텍스트·운율을 다룸.
4. Backstrom, Tucker & Kelley (2019), **Forced-alignment of the sung acoustic signal using deep neural nets**, Canadian Acoustics 47(3), 98–99. https://jcaa.caa-aca.ca/index.php/jcaa/article/view/3350  
   노래/일반 발화의 차이와 수작업 음소 구간 정답 사용. 한국어 자체 성능의 근거로 전용할 수 없음.
5. Chang & Lee (2017), **Lyrics-to-Audio Alignment by Unsupervised Discovery of Repetitive Patterns in Vowel Acoustics**, IEEE Access 5, 16635–16648. DOI https://doi.org/10.1109/ACCESS.2017.2738558  
   한국어·영어 가사/음원 정렬 연구. 본 프로젝트의 AM630 실제 노래 타임코드 정답을 제공하지 않음.
6. Google MediaPipe FaceMesh documentation: 468 3D surface landmarks are an **estimate** from monocular RGB; this is not CT/MRI bone/teeth segmentation: https://github.com/google-ai-edge/mediapipe/blob/master/docs/solutions/face_mesh.md

## 실제 학습 데이터

- 입력 원본: 본인 제공 `IMG_0853.mp4`, `IMG_0854.mp4`.
- 얼굴 상부 고정 정렬 뒤, 입 안쪽 밝기·그림자의 열린 영역 프록시와 아랫턱 피부 부위 영상 패치의 수직 변위를 대응.
- 수집: 107 프레임 시도 중 **75 유효 프레임**, 32개 제외. 시간상 앞 70% 학습 **54개**, 뒤 20% 별도 검증 **15개**, 중간 10% 미사용.
- 실제 학습 알고리즘: 단조 IsotonicRegression. 늘어난 개구 지표에 대해 **추정 턱 피부 이동**이 증가하도록 제한. 이는 의학적인 턱뼈 각도가 아니라 `320×320` 영상 픽셀 좌표.
- 별도 테스트 MAE: **3.6934 px**; 정적인 학습 평균 기준 **5.7827 px**. 오차 감소는 이 특정 사용자·영상·프록시와 분할 방식에 한정.
- 입 벌어짐·턱 움직임 분리: 원본 촬영 입술/치아/입안 텍스처는 v26에서 이어받고 턱 피부의 **독립된 수직 이미지 이동장**을 추가.
- 상부 얼굴(눈·이마·코) 새 하관 변형에 의한 픽셀 변화는 **정확히 0**.
- 입술 움직임이 얼굴을 벗어나는 것은 보호하지만, 새로운 턱선의 정밀 3D 실루엣을 구성하지는 않는다.

## 구강·치아 분할의 한계

- 현재 `measured_oral_masks()`는 어두운 영역과 밝고 채도가 낮은 픽셀을 **후보**로 추출할 뿐이며, 치료나 임상에서 통용되는 치열·혀·연조직 라벨이 아니다.
- 원형으로 오므린 입술 피부에서 생기는 밝은 픽셀을 거짓 치아로 인식하는 문제가 발견되어, 실제 관찰된 둥근 형태에서 후보를 억제하는 시각적 안전 규칙을 추가함.
- 위아래 치아의 실제 3D 가림 순서, 혀·경구개·연구개, 악관절 회전각 및 하악골 깊이는 입력 RGB 영상으로 검증 불가능. **임상 정답 라벨이나 해당 GT 자료 없음.**
- 이미 관찰된 영상 프레임의 실제 입안/치아만 사용하며 없는 치열을 합성해 사실처럼 표시하지 않는다.

## 한국어 발음 타임스탬프

- 현재 실제 사용자 스피킹 영상의 한국어 음절 **정답 시간 라벨 없음**.
- `owner_v27_phone_contract.py`는 특정 사용자·원본 SHA-256·모음·음절 시작/종료 초·검수자를 요구하며 **`human_verified`가 없는 데이터는 학습 입력으로 거부**.
- 원곡 `AM630`은 기존 가사 텍스트 순서를 사용하지만 노래의 개별 음절 실제 타임코드는 미검증. 생성된 MP4는 연구용 **UNALIGNED**.

## 검증 및 배포

- 사용자 자료 기반 비공개 7개 자동 테스트: 통과.
- 외부 공개 소스(개인 사진 없이) 4개 합성 계약 테스트: 통과.
- 비공개 원본·측정 레코드·훈련 프로필은 비공개 저장소에만 저장. 공개 SONG에는 모델 **코드**와 사용자 승인된 **연구 영상**만 게시.
- **최종 판정**: 2D 영상 관찰 기반 턱·입술 연동 연구 구현. 실제 턱뼈 3D 관절 애니메이션, 구강 임상 정답 분할, 발음별 정확한 시간 정렬, 자연스러운 실사 영상품질은 아직 미완성.
