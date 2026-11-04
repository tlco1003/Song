# WITHU 소개 사이트 배포 — GitHub Pages

## 목적
Suno 공식 API 제휴 신청서에서 요구하는 URL에 사용할 **공개 HTTPS 사이트**를 제공한다.
이 문서의 사이트는 **사업 소개/파트너십 심사용 정적 사이트**다. 실제 GPT 생성 API 호출이나 Suno 노래 생성, 이용자 목소리 업로드는 수행하지 않는다.

## 파일
- **대외 서비스 이름: WITHU**. 과거 이름 SONG은 이 저장소의 내부 저장소명으로만 유지한다. 따라서 당장 주소에는 `/Song/`이 들어가며, 화면은 WITHU로 표시된다.
- 공개 사이트 시작 페이지: `docs/index.html`
- 소스: `tlco1003/Song` 저장소 `main` 브랜치.
- **실제 공개 후보 URL:** `https://tlco1003.github.io/Song/`
- 위 URL은 GitHub Pages가 실제로 활성화되고 배포 성공한 뒤에만 신청서에 제출한다.

## 최초 1회 설정 — 저장소 관리자 계정에서 (iPhone은 Safari의 웹사이트 이용)
1. GitHub **앱**의 저장소 홈에는 Pages 설정이 바로 나타나지 않을 수 있으므로 **Safari에서** `https://github.com/tlco1003/Song/settings/pages` 직접 접속. 앱으로 열리면 Safari 주소창에 주소를 직접 입력한다.
2. 왼쪽에서 **Pages** 설정 화면을 연다.
3. **Build and deployment → Source:** `Deploy from a branch` 선택.
4. **Branch:** `main`, **Folder:** `/docs` 선택.
5. **Save** 클릭.
6. Pages 상태 화면에서 배포/빌드 성공 및 `Visit site` 링크를 확인한다. 처음 설정 시 수 분 걸릴 수 있다.
7. `https://tlco1003.github.io/Song/` 를 새 시크릿 탭 또는 모바일에서 열어 디자인과 문구가 나타나는지 확인한다.
8. HTTPS 주소가 실제로 열릴 때만 Suno Interest Form의 **Company / Website URL** 칸에 입력한다.

### 제출 전 확인
- [ ] `https://tlco1003.github.io/Song/` 직접 접속되며 404나 GitHub 로그인 화면이 아니다.
- [ ] 모바일 화면의 글자가 잘리지 않는다.
- [ ] "개발 중", "Suno 상업용 API 계약 검토 중", "자기 목소리 기능 계획"이 명확히 표시된다.
- [ ] 사이트에 실제 API 키·고객 목소리·개인 연락처·불확실한 상업 이용 승인 주장이 없다.
- [ ] 회사 등록을 하지 않았다면 *WITHU Project*라고 설명하고, 설립 법인인 것처럼 오인시키지 않는다.

## 제약
GitHub Pages는 **정적 파일만 호스팅**한다. 이 정적 소개 화면으로는 `src/server.mjs`의 GPT/API 서버를 실행할 수 없다. 실제 WITHU 웹앱은 추후 별도 HTTPS Node 서버에 배포해야 한다.
현재 연결된 GitHub 도구에서는 Pages 설정 자체를 바꾸는 액션이 없으므로, **사이트 파일 생성과 실제 Pages 공개 설정은 별개 단계**다. 배포 성공을 확인하지 않고 URL을 작동한다고 주장하지 않는다.

공식 문서: https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site
