# Song 보호 재생: 구현 범위와 활성화 조건

2026-11-15. 상태: 저장소 코드 및 모의 라이선스 통합검사 완료. 실제 공급자 DRM·패키징·단말 화면 녹화 제한은 미검증. 기본 비활성.

## 기존 흐름 확장

기존 고객 전달 세션 → 주문·실결제·전달완료 검사 → 곡별 `drm` 정책 → 암호화 HLS/DASH 재생 → 동일 출처 라이선스 API → 자산별 60초 서명 JWT → 검증된 외부 DRM gateway → CDM.

- `src/production-drm.mjs`: DRM 정책, config API, 바이너리 라이선스 중계, 주문 단위 10분당 120건 제한. 이 한도는 서비스 정책값이며 DRM 표준이나 실측 최적값이 아니다.
- `src/production-runtime.mjs`: 기존 고객 응답에 선택적 `protectedPlayback` 추가. 원본 저장 위치·공급자 URL·비밀키는 응답하지 않는다.
- `src/production-delivery.mjs`: DRM곡은 기존 `delivery-assets` 원본/Range 재생 차단. 별도 구매·권리 검증된 원본 재다운로드는 유지.
- `src/production-admin.mjs`: 기존 Firebase 관리자 인증을 통과한 운영자만 전달 전 곡에 DRM 연결. DRM 연결 뒤 원본 단독 교체 차단.
- `docs/protected-media.js`, `docs/song.js`, `docs/my-music.html`, `docs/song.html`: Shaka 4.16.11, DRM 구성, CDM 정리, 곡 전환 직렬 처리, 보호 로드 실패시 원본 우회 없음. 보호곡인데 실제 DRM 정보가 없으면 재생 실패.
- `docs/vendor/shaka-player-4.16.11.js`: npm shaka-player@4.16.11 배포 파일 그대로, Apache 2.0 라이선스 동봉. 공개 예시곡과 DRM 미지정곡의 기존 재생 유지.

## 활성화 전 필수 작업

1. 상용 사용이 허가된 Widevine/FairPlay/PlayReady 공급자 계약·계정·라이선스 설정 확보. 지원 시스템은 실제 패키지와 브라우저에 맞춰 지정한다.
2. 원본을 공급자 패키저로 암호화한다. HLS/FairPlay 및 DASH/CENC 등 자산·KID를 등록하고 HTTPS manifest/segment 경로와 CORS를 구성한다. 일반 MP3, 단순 HLS AES-128, ClearKey는 이 구현의 상용 DRM으로 취급하지 않는다. 원본·키·패키징 서비스는 본 코드가 생성하거나 자동 배포하지 않는다.
3. 아래 gateway 계약을 구현한 공급자 어댑터를 준비하고 자산 간 라이선스 요청 차단을 실제 CDM challenge로 검사한다. 기존 공급자 API에 이 JWT를 무작정 보내면 작동하지 않는다. 공급자별 SPC/CKC, XML/JSON 포장 등은 gateway에서 변환해야 한다.
4. Firebase Secret Manager에 `WITHU_DRM_GATEWAY_SIGNING_KEY`(최소 32문자)를 만든다. 비밀값을 git이나 브라우저에 넣지 않는다. gateway에 같은 비밀을 안전하게 설정한다.
5. `WITHU_DRM_GATEWAY_URL` HTTPS 주소와 `WITHU_DRM_GATEWAY_VERIFIED=true`를 배포 환경에 설정한다. true일 때만 Functions Secret을 바인딩한다. 기존 DRM 미사용 서비스는 새 비밀키 없이 유지된다. 기존 apiSecrets의 다른 필수 비밀값과 Firebase 운영 가드는 그대로 필요하다.
6. 운영자 인증 Bearer 토큰과 같은 출처 Origin으로 `POST /api/admin/orders/{orderId}/tracks/{1|2}/drm`을 호출한다. 아래는 **스키마 예시**이며 실제 자산 주소가 아니다.

```json
{
  "required": true,
  "packagingVerified": true,
  "assetId": "actual_provider_asset_id",
  "systems": ["widevine"],
  "manifestUrl": "https://YOUR_AUTHORIZED_CDN/actual_asset/manifest.mpd"
}
```

`packagingVerified`는 운영자 검수 선언이다. 서버가 콘텐츠 패키징을 자동 증명한 결과가 아니다. 실제 공급자 자산 매핑을 운영자가 확인해야 한다. FairPlay는 systems에 `fairplay`를 지정하고 공개 DER 인증서의 `fairplayCertificateBase64`를 추가한다. 인증서 비밀키는 절대 포함하지 않는다. 이 API의 관리자 화면 입력 UI는 아직 없다. 현재 기본 원본 업로드 검증은 25MB MP3/M4A/WAV이다.

7. `npm run build:firebase` 이후 승인된 배포 절차를 수행하고 테스트 주문으로 재생·공유·구매자 재다운로드·실패·환불·세션 만료를 실제 확인한다. 이 변경에서 배포나 기존 공개 미디어 이동은 수행하지 않았다. `withuDrmLimits.deleteAfter`의 Firestore TTL 정리를 설정한다(미설정 시 자동 삭제 없음).

## Gateway의 필수 보안 계약

- HTTPS POST 요청 본문은 CDM challenge 원본 바이너리다. JWT는 Authorization Bearer에만 실린다.
- HS256 서명, 허용 알고리즘, `iss=withu`, `aud=withu-drm-gateway`, iat/exp, jti를 검증한다. JWT는 자산 ID·DRM 시스템·주문 ID에 바인딩되며 60초 만료다. 필요시 재전송 방지는 gateway의 jti 저장소로 수행한다.
- **challenge의 모든 KID/content ID가 JWT.assetId 소유인지 공급자 측에서 검증해야 한다.** 불투명한 바이너리 challenge를 본 Node 코드가 직접 분석하지 않는다. 이 검사가 없으면 다른 곡의 라이선스를 발급할 수 있으므로 VERIFIED를 켜면 안 된다.
- 공급자 인증키로 라이선스를 요청하고, 공급자별 포장을 해제한 raw Widevine/PlayReady/FairPlay 라이선스를 바이너리로 반환한다. 실패 응답·비밀키·복호화 키를 고객에게 반환하지 않는다.
- 갱신은 다시 고객 세션 및 최신 주문 상태를 검사한다. 단, 이미 발급된 CDM 라이선스는 환불 즉시 회수되지 않는다. 공급자의 짧은 재생·갱신 기간과 지속 라이선스 금지 정책으로 제한해야 한다. 서버의 60초 JWT 만료는 CDM 라이선스 만료와 다르다.
- 최대 challenge/응답 2MiB, 15초 제한, redirect 차단. 네트워크 게이트웨이에 추가 서비스 보호를 적용할 수 있다.

## 보장하지 않는 항목

- 웹 JavaScript가 OS 화면 녹화·루프백 녹음을 보편적으로 감지하거나 잡음을 주입하지 않는다. 우클릭/단축키 차단으로 DRM을 흉내 내지 않는다.
- Apple 공식 문서에 따르면 FPS 비디오는 화면 녹화에서 제외되지만 오디오는 포함될 수 있다. 네이티브 앱의 캡처 상태 관찰과 재생 중단이 별도로 필요하다. 웹사이트만으로 iPhone 오디오 녹음 차단을 보장하지 않는다.
- 하드웨어 Protected Media Path는 OS/CDM/단말 정책이다. 이 코드가 하드웨어 보안 경로를 직접 생성하지 않는다. 특정 보안 강도/HDCP는 공급자 정책과 실제 지원 단말 검증이 필요하다.
- 구매자가 원본 MP3를 다운로드하면 그 파일에는 이 스트리밍 DRM이 적용되지 않는다. 기존 별도 유료 다운로드·공유 권한을 임의 삭제하지 않았다.
- 공개 저장소/기존 공개 MP3 URL로 이미 제공한 파일은 소급 보호되지 않는다. 합법적으로 허용된 공개 예시곡은 그대로 둔다.
- 단말·브라우저 재생, 외부 녹음 장치 차단, 실제 공급자 연동, 실기기 화면 녹화/백그라운드 재생은 검증 대기다.

## 공식 근거

- https://www.w3.org/TR/encrypted-media/ — EME/CDM 인터페이스.
- https://developers.google.com/widevine/drm/overview — Widevine, 라이선스 계약과 지원 플랫폼.
- https://developer.apple.com/streaming/fps/ — 암호화 전달 및 운영 자격증명 승인.
- https://developer.apple.com/documentation/uikit/uiscreen/iscaptured — FPS 영상과 오디오 캡처의 차이. 현재 API는 sceneCaptureState 사용 안내가 있으므로 향후 네이티브 앱은 대상 iOS 버전에 맞춰 구현한다.
- https://shaka-project.github.io/shaka-player/docs/api/tutorial-drm-config.html
- https://shaka-project.github.io/shaka-player/docs/api/tutorial-fairplay.html
