# MOMENT AI CINEMA — Motion Atelier v2 (2026-11-14)

Standalone cinematic presentation layer for the existing MOMENT AI web demo. This directory does not contain WITHU, ChefOS, private AI models, API keys or training data. The original app's features are reached via same-origin `../?screen=<feature>` deep links and an embedded iframe, and remain implemented by the original app.

## Experience

`?screen=home&step=0` through `?screen=home&step=5` — a scroll, swipe, keyboard, or button-controlled six-chapter **procedurally modeled 3D vehicle assembly**:

0. The Blueprint — immersive opening
1. Chassis — structural rails and frame
2. Motion — four wheel units
3. Form — body panels
4. Cabin — upper body / glazed enclosure and trim
5. Your World — completed vehicle with six clickable services

On the final chapter, tapping the choices opens the existing MOMENT AI functionality:

`?screen=music`, `?screen=lounge`, `?screen=journey`, `?screen=wellness`, `?screen=memory`, `?screen=creative`.

The cinematic scene includes an original brand-neutral concept vehicle. It is **not** a licensed Hyundai/Kia model, a scanned CAD design, a factory assembly simulation, nor an assertion that all vehicle features are ready to use in a real car. The vehicle is procedurally rendered on an HTML canvas using original 3D vertices projected to 2D, without external GLB assets or paid AI endpoints. The atmospheric backdrop retains the existing WebGL2/CPU fallback scene. Motion is limited by user preferences and the motion toggle; controls are keyboard accessible.

## Input and URL semantics

- Desktop: scroll down/up on the intro (one chapter per deliberate wheel input); ArrowDown/ArrowUp and PageDown/PageUp; previous/next chapter buttons; step dots.
- Touch: swipe up/down on the intro to change chapters; horizontal drag to rotate the car; controls and chapter dots can be tapped.
- Each step is deep-linkable as `?screen=home&step=N`, and changes are stored in browser history. Back/Forward restores the relevant chapter.
- After the final chapter, six actual buttons navigate to the feature screens without resetting the user's music, daily-news or route logic in the original app.
- When inside the feature page, regular internal scroll is left alone; the assembly scroll handler applies only to the intro screen.

## Implementation

- `index.html`: layout, controls, menu and accessible chapter markers
- `cinema.css`: editorial visual system, responsive grid, focus and motion reduction
- `scene.js`: existing atmospheric WebGL2 + software scene
- `car.js`: *new* isolated procedural vehicle and progressive assembly renderer
- `cinema.js`: extended state machine, URL routing, touch/wheel/keyboard events and iframe bridge

## Verified locally

- JavaScript syntax checked with `node --check`.
- Browser tests in desktop 1440 × 900 and touch-enabled 390 × 844: step buttons, final chapter menu, navigation to previous application modules, no page JavaScript errors.
- Browser gesture tests: mouse wheel, ArrowDown and touch swipe advance stages; feature URL receives the correct screen parameter.
- Rendering was evaluated in headless Chromium with software canvas; this does not prove real-car Pleos WebView/GPU performance or embedded-app end-to-end network data correctness.

## Limits and protection

- Existing business logic, news pipeline, vehicle SDK, native Android host, music library and health service connectors were not altered or reimplemented.
- Pleos hardware SDK can only be verified in a supported Android host/car emulator. No vehicle sensor data is fabricated in the cinematic scene.
- No secret URL, private API, repository key or source code from WITHU/ChefOS is included.
- GitHub Pages is public. A restricted private preview needs access-controlled hosting and should be addressed before submitting confidential material.