# WITHU 미디어 게시와 별도 서버 배포 안내

## 이번 엄마 노래 영상 게시

업로드받은 `이화진씨.mp4`의 영상 길이는 **436.8초(약 7분 17초)**, 원본 용량은 약 **154MiB**이다. GitHub 웹 업로드를 위해 **360×640 H.264/AAC, 약 20.15MB**로 재인코딩한 `mother-song.mp4` 파일을 제공한다.

**게시 전 반드시 이 파일명 그대로 업로드:**
- 다운로드: 대화에 첨부된 `mother-song.mp4`
- 관리자 게시 URL: https://github.com/tlco1003/Song/upload/main/docs/media
- GitHub 저장 경로: `docs/media/mother-song.mp4`
- GitHub Pages 웹 경로: `https://tlco1003.github.io/Song/media/mother-song.mp4`

`docs/player.js`는 `media/mother-song.mp4`의 존재를 확인해 업로드된 뒤에만 **엄마에게 전하는 노래** 영상 플레이어를 표시한다. 실제 영상 파일을 GitHub에 커밋하기 전에는 '영상 공개를 준비하고 있어요'라고 표시한다.

이 자료는 **음악 선물 영상**이며, 실제 수신자의 반응·후기가 포함된 것인지 증빙되지 않았다. 따라서 동의받은 고객 후기라고 허위 표시하지 않는다. 게시할 권리와 영상 속 인물·음성의 공개 동의를 업로더가 확인해야 한다.

## 공개 프런트엔드
- `docs/index.html` : 사이트 첫 화면(바로 음악과 가사)
- `docs/style.css` : 고급 서체·반응형 디자인
- `docs/player.js` : 음악 재생·목록 이동·가사 표시·파일 미리보기
- `docs/media/tracks.json` : 공개 음악 목록
- `docs/media/lyrics-*.txt` : 노래별 가사
- `docs/reviews/reviews.json` : 실제 동의받은 후기 목록

원본 MP3 파일이 없이 내장 재생기를 사용할 때에는 외부 서비스의 플레이어가 노출될 수 있습니다. **고객에게 완전히 독립적인 WITHU 음악 재생 화면을 제공하려면, 게시 권한이 있는 MP3를 자체 호스팅해야 합니다.**

세 파일을 GitHub에 업로드할 때 이름:
- `nara.mp3`
- `taehwan.mp3`
- `jeongmi.mp3`

관리자 업로드: https://github.com/tlco1003/Song/upload/main/docs/media

별도 곡을 게시하려면 MP3 파일과 가사 TXT를 올리고 `docs/media/tracks.json`에 항목을 추가하세요. 단순히 파일만 업로드해도 자동으로 목록에 표시되는 것은 아닙니다.

## 후기 영상
후기 영상은 실제 촬영·공개 동의를 받은 MP4/WebM만 게시합니다. 파일을 `docs/reviews/`에 올린 후 `reviews.json`에 제목·파일명·`consentConfirmed:true`를 등록해야 화면에 표시됩니다. 가짜 후기는 없습니다.

관리자 업로드: https://github.com/tlco1003/Song/upload/main/docs/reviews

## 방문자 파일 선택
'내 음악 불러오기', '가사 파일 불러오기', '영상 미리보기'는 **방문자의 기기에서만 재생하는 미리보기**입니다. 서버 업로드, 공개 게시, 공유가 아닙니다.

## 서버 배포
루트의 `Dockerfile`과 `render.yaml`은 별도 Node HTTPS 서버 배포를 위한 준비 파일입니다. `/healthz`는 키를 노출하지 않는 상태 확인 엔드포인트입니다. 인증·결제·고객별 보관·보안 스토리지·사업용 음악 API는 아직 실제 운영 검증이 필요합니다.

**비공개 원칙:** 현재 GitHub 저장소 `tlco1003/Song`는 public입니다. 사이트에서 프로젝트 링크를 제거해도 소스와 커밋 기록은 공개됩니다. 상업용 노래 생성 로직·작사 프롬프트는 **private 백엔드 저장소**로 분리한 다음, WITHU 소개용 정적 파일만 공개 저장소에 배포하세요. Pages 사이트 자체는 공개할 수 있어도 서버 소스와 비밀키가 공개될 필요는 없습니다.

## 외부 음악 제작 사이트로 이어서 만들기 — API 없이 사용

- WITHU 공개 페이지 `create.html`에는 기존 다섯 가지 사연 입력, 나이·관계·평소 말투, 장르·분위기 선택과 **가사 편집 및 스타일 생성·복사 기능**이 있다.
- 서버 GPT API가 연결된 HTTPS 웹앱에서는 `POST /api/lyrics`로 편지형 가사를 생성한다.
- 현재 GitHub Pages **정적 배포만으로 GPT 작사를 실행할 수 없다.** 대신 사용자가 가사를 직접 적거나 이미 만든 가사를 붙여 넣을 수 있다.
- 가사 복사, 스타일 복사를 각각 누른 뒤 **노래 제작 화면으로 이동**을 누르면 공식 `https://suno.com/create`가 새 탭으로 열린다. Suno에 로그인된 계정이 그대로 사용된다.
- Suno **Custom 모드**에서 Lyrics와 Styles에 복사한 텍스트를 각각 붙여넣고, 제목을 지정해 Create한다.
- **확인된 공식 URL 딥링크 파라미터가 없어** 외부 사이트가 Suno의 가사·스타일을 자동으로 미리 채우지는 못한다. 이를 지원한다고 표시하지 말 것.
- 고객 공개 화면에서는 업체 이름과 내부 작사 전략 및 코드를 표시하지 않지만, 외부 URL의 목적지와 공개된 프런트엔드 코드는 사용자가 확인할 수 있다.
- 고객 대상 유료 대리 생성·고객 계정 관리·Voice 자동 업로드는 Suno 사업용 제휴 승인·계약을 받기 전 구현된 기능으로 보지 않는다.
