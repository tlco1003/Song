# MOMENT AI / Pleos Native Host — SDK integration scaffold

> Status: implemented source adapter; **Android Gradle build and Pleos emulator execution NOT verified in this environment.**
> The public demo at `docs/moment-ai/index.html` remains independent of this host. No WITHU/ChefOS source code is bundled.

## Components

- `app/src/main/java/ai/moment/pleos/MainActivity.kt`: Pleos `Vehicle` and `NaviHelper` lifecycle, asynchronous read calls, main-frame/origin-restricted WebMessage bridge, local WebViewAssetLoader, music file chooser.
- `app/src/main/java/ai/moment/pleos/BridgeContract.kt`: data validation and fail-safe normalization shared by tests.
- `app/build.gradle.kts`: builds the **existing** `docs/moment-ai` web UI as an Android asset using `syncMomentWeb` (no fork or duplicate UI engine).
- `tests/`: Kotlin contract tests runnable without Android SDK via `bash tests/run-contract-tests.sh`.

## Actual SDK calls used

- `Vehicle(applicationContext).initialize()` and `getEvBattery().getEvBatteryStateOfCharge(...)`, onComplete/onFailed.
- `NaviHelper(applicationContext).initialize(onConnected,onFailed)`; register `NaviHelperEventListener`; on `onRoutingCompleted`, `onRouteStarted`, `onDestinationInfo`, `onRouteStateInfo`, `onError`.
- `getDestinationInfo()`, `getRouteStateInfo()`; `removeListener`, `release` in `onDestroy`.
- Permissions: `CAR_ENERGY`, `NAVI_ROUTE`; **no** control permissions and **no** route modification API.

These are real SDK method calls, but they have NOT yet returned genuine emulator/vehicle values in this environment. An initialized `Vehicle` object does not mean its Service is connected. Navigation readiness only follows `NaviHelper.initialize` success; EV readiness only follows a validated battery data callback.

## Why ETA, EV remaining range and actual waypoint addition are not displayed

- The official v3.0.5 NaviHelper SDK release lists a `remainTime` field, but its raw time unit and model behavior have not been verified against a real SDK artifact/service. `remainingMinutes` is therefore **null**, not a guessed 120/60 conversion.
- We have not verified a read-only `RangeRemaining` value/unit supported on all powertrains. Range is **null**.
- Adding a restaurant as a waypoint needs a valid Navigation app POI mapping/identifier, an active route, `NAVI_ROUTE_SEARCH` privilege, a user-initiated request, then confirmation from SDK callbacks. OSM/OSRM IDs must not be passed as if they were Pleos `poiId` values. This host intentionally implements **read-only navigation** first.
- EV battery SoC read can fail on ICE/unsupported hardware. It will be shown as unavailable rather than fabricated.

## Build with Pleos Connect SDK (outside this container)

1. Install Android Studio with SDK 35, JDK 17, Gradle 8.10.2 and the Pleos 2.1.0 AVD. Check GPU requirements: https://document.pleos.ai/docs/connect/guide/getting-started/application-development/configure-pleos-connect-emulator
2. Open `moment-ai-android` in Android Studio. Ensure the *sibling* `docs/moment-ai` directory exists in the repository checkout.
3. Gradle sync resolves `ai.pleos.playground:Vehicle:2.3.2`, `ai.pleos.playground:NaviHelper:3.0.5` from the official Pleos Maven. Run `./gradlew :app:assembleDebug`.
4. Run in Pleos Connect Emulator and inspect `MOMENT` WebView statuses. Test both cases: native Navi service absent and present. Never treat silent callbacks as success.
5. Check `onDestinationInfo` getter surface and SDK version before enabling ETA or POI write APIs. Add `CarUxRestrictions`/driving-mode restrictions and Android Media3 audio-focus support before a real driving-mode App Market submission.

## API and trust boundaries

- The `MomentNativeBridge` message object is only injected for `https://appassets.androidplatform.net` using AndroidX WebKit `WebViewCompat.addWebMessageListener`. Only main-frame messages, known schema and `ready`/`refreshState` commands pass validation.
- Native output is a restricted JSON schema (`moment.pleos.bridge.v1`). No raw vehicle SDK objects, VIN, health details or location coordinates are sent to JavaScript.
- The local app WebView cannot load arbitrary external sites. Links launch a separate system browser; file access and cleartext HTTP are disabled.
- Source code and placeholders on GitHub Pages DO NOT prove production safety or an approved Pleos category. This host must not be used while driving before UX restriction/Android Media3 review.

## Sources

- Vehicle introduction & permissions: https://document.pleos.ai/docs/pleos-only/connect-sdk-pleos/Vehicle/intro
- NaviHelper introduction: https://document.pleos.ai/docs/pleos-only/connect-sdk-pleos/NaviHelper/intro
- Latest SDK release: https://document.pleos.ai/docs/pleos-only/release-note/sdk-release-note
- Official sample: https://github.com/Pleos-Playground/pleos-sample-navi-app
- Official sample: https://github.com/Pleos-Playground/pleos-sample-vehicle-app