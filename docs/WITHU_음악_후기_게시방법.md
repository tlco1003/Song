# WITHU 미디어 게시와 별도 서버 배포 안내

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
