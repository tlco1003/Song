# WITHU 공개 음악 라이브러리

이 폴더에는 **공개 허락을 받은 실제 음악 파일과 가사만** 게시합니다.

## 기본 파일명
- `nara.mp3` : 나라는 사람
- `taehwan.mp3` : 구태환에게
- `jeongmi.mp3` : 내사랑김정미

세 곡의 실제 가사는 `lyrics-nara.txt`, `lyrics-taehwan.txt`, `lyrics-jeongmi.txt`에 각각 연결되어 있습니다. 제목·파일명·가사 파일 경로는 `tracks.json`에서 관리합니다.

## 새 음악 게시
저장소 관리자만 GitHub에서 MP3와 가사 TXT를 올립니다. 다른 고객의 음악을 마음대로 공개하지 말아야 합니다.

파일 추가 후 `tracks.json`의 `tracks` 배열에 다음처럼 추가해야 목록에 나옵니다:

```json
{"id":"new-track-001","title":"새 노래","subtitle":"선물곡","file":"new-track.mp3","lyricsFile":"new-track.txt","durationSeconds":210}
```

파일만 추가하고 목록 파일을 수정하지 않으면 자동으로 표시되지 않습니다. 인증·업로드 서버가 연결되면 음악 게시 흐름을 별도로 구현해야 합니다.

**현재 첫 화면에서 MP3가 없는 세 기본 곡은 외부 내장 플레이어로만 연결**됩니다. 완전히 독립적인 WITHU 재생 UI를 사용하려면 MP3 파일 3개를 직접 게시해야 합니다.

가사와 음악에는 개인 실명·장소가 포함될 수 있습니다. 원본 제작권과 당사자 공개 동의를 반드시 확인하세요.

## 2026-11-04 현황
- 엄마 선물 영상: `mother-song.mp4` 정상 게시(16,265,579 bytes; 기존 한글 파일명 정정).
- 재생 확인용 게시 파일: `nara.mp3`(5,813,147B), `taehwan.mp3`(7,089,831B), `romantic-wedding.mp3`(6,592,332B), `jeongmi-new.mp3`(7,856,049B), 엄마 영상 `mother-song.mp4`(16,265,579B). 파일 형식별 재생 동작의 실제 브라우저 확인은 별도 필요.
- 기존 〈내사랑김정미〉의 정확한 원본 파일 `jeongmi.mp3`(7,588,611B)는 아직 미업로드. 지금 올라온 〈정미야, 참 다행이야〉는 별도 버전으로 처리해 기존 가사를 임의로 연결하지 않는다.
- 고객 목록에서는 파일이 실제 배포된 항목만 표시한다. 1바이트짜리 가짜 파일은 재생 목록에서 배제한다.
- 가사: 웹에서는 구간 라벨 제거 후 세 줄씩 약식 자동 스크롤. 개별 가사 정확한 시간표는 필요.

## 세탁소의 신데렐라 — 업로드 대기 (2026-11-04)
- 화면 제목: **세탁소의 신데렐라**
- 부제: **동전 하나만 더!**
- 재생 파일명: `docs/media/cinderella-laundry.mp3` — 221.64초 / 5,116,203 bytes
- 가사: `docs/media/lyrics-cinderella-laundry.txt` — 사용자 제공 노랫말 67줄 등록 완료
- 음악 목록: `docs/media/tracks.json`에 `song-cinderella-laundry` 연결 완료
- GitHub main에서 원래 언급한 `Cinderella of the laundry.mr` 파일은 확인되지 않았으며 MP3도 아직 미게시.
- 파일 선택 및 업로드 링크: https://github.com/tlco1003/Song/upload/main/docs/media
- 배포 후 직접 재생 URL: https://tlco1003.github.io/Song/media/cinderella-laundry.mp3
- `.mr`처럼 잘못된 확장자는 재생에서 제외될 수 있으므로 실제 MP3 파일을 `.mp3`로 올릴 것.
