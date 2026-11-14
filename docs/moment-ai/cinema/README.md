# MOMENT AI CINEMA — immersive public-facing presentation layer

## What it does

This is a **separate, additive cinematic front end** that keeps the already-built MOMENT AI source files unchanged.

- Standalone route: `/Song/moment-ai/cinema/?screen=home` (intro)
- 3D Chrome Orbital object: custom WebGL2 shaders + sphere/torus meshes, full camera animation, mouse/touch dragging; CSS fallback without WebGL2.
- 7 deep-linkable chapters `home`, `music`, `journey`, `lounge`, `memory`, `wellness`, `creative` via `?screen=...`; native browser Back/Forward work.
- Actual MOMENT AI modules are rendered from same-origin `../?screen=<chapter>` in an embedded frame. No duplicate business logic or private WITHU/ChefOS code.
- The current app retains its local personal music player (IndexedDB), audio briefing, news, weather, route demo, wellness settings, and local journey memory.
- The `FULL EXPERIENCE` link opens the original full-screen app to avoid any limitations of embedding.
- Accessibility: keyboard navigation, reduced-motion preference and manual toggle, WebGL fallback, mobile-responsive layout.

## Why this architecture

The car-facing Android/Pleos prototype has an existing tested UI and data adapters. We do not discard or fork its calculations into a new, inconsistent frontend. This is a **separate brand/experience shell**, not a second nutrition/navigation/music engine. Existing features are only called through same-origin interface/frame.

## Privacy and security

- Does **not** contain private WITHU or ChefOS source, keys, model weights, or copyrighted music.
- Public GitHub Pages are **public**. This UI contains only showcase code. Do not upload confidential inventions, user health or travel records to the repository.
- Existing browser-local audio and memories are preserved under the existing domain; cross-origin URL changes require a migration strategy.
- If a private preview is necessary, use a separately authorized private deployment with authentication. GitHub Pages alone is not private.

## Dependency status

Self-contained: WebGL2 JavaScript and CSS animations. **No external Spline, GSAP, Three.js library used in this version**: real 3D is implemented directly with WebGL2 shaders to keep the showcase operational without an external 3D asset/license. Later Spline GLB assets can be integrated only after asset ownership/license is checked.

## Local preview

Place these files in `docs/moment-ai/cinema/`, and serve the parent `docs/moment-ai/` folder through `python3 -m http.server 8000 -d docs/moment-ai` with current directory as root. Then navigate to `/cinema/?screen=home`. The existing app is served at `/`.

## Known constraints

- Embedding full-screen legacy UI is a **transition architecture**: mobile embedded content may scroll internally. A native scene-level UI migration would require extracting original UI components and introducing a shared design system and state adapters.
- WebGL is decorative. Vehicle usage should provide safe audio-first mode without cinematic transitions while driving.
- No new Pleos vehicle SDK integration is added here. Existing Android SDK module remains unchanged; real vehicle callbacks require official emulator/hardware validation.
- Intro scene intentionally does not autoplay audio. Music only plays after a user action inside the existing app.