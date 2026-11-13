# WITHU video/AI-agent expansion — integration contract v1

Date: 2026-11-14. This is a design and assurance contract, NOT an integrated production multi-agent engine.

## Existing entry points (inspected)

- docs/index.html: public WITHU landing and media experience
- docs/checkout.html: display/checkout preparation; not a verified active payment flow
- docs/prices.json: existing music-gift price SSOT. Do not overwrite for commercial-ad pilot.
- src/commerce.mjs: intentionally fail-closed public commerce readiness and order states
- src/paid-order-pipeline.mjs: verified payment + atomic outbox contract (no new bypass)
- src/production-contract.mjs, src/production-runtime.mjs: existing production guards
- src/server.mjs: Node server; current modules must be inspected before any route change

## Pipeline and state ownership

```text
Private authorized intake (brief, consent, product assets)
  -> Project version + creative specification (human approves)
  -> Provider-independent job intent (idempotency key)
  -> Model/provider adapter (quote -> approved spend -> submit -> poll -> verify)
  -> Video/audio assets + scene timestamps (private, immutable references)
  -> Caption/motion-graphics composer (speech-aligned; measured data only)
  -> QA machine checks + human review + version approval
  -> Rights-verified private delivery, customer acceptance, invoice, repeat order
```

A stage cannot infer predecessor success from a prompt or filename; it requires a durable, idempotent event and a verified artifact. Use state transitions requested->reviewed->approved->submitted->running->output_ready->qa_passed->delivered, plus failed/blocked/retryable, with actor, UTC timestamp and immutable evidence reference. Do NOT equate reviewed with published or delivered.

## Suggested schema, design only (not installed as database)

- project: project_id, business_lane, owner_id, private_customer_ref, approved_spec_version, active_state
- brand: brand_id, private rights evidence refs, voice/visual policy, claims policy
- asset: asset_id, project_id, private location, content_sha256, type, origin/consent, license_scope, ttl
- generation_job: job_id, project_id, provider, model/version, external_job_ref, idempotency_key, quote_credits, approval_ref, status, errors
- timeline_event: scene_id, start_ms, end_ms, source_track, spoken_cue, overlay_kind, parameters
- qa_result: asset_id, check_kind, metric, value, evidence_ref, verdict, reviewer, UTC
- delivery: approved_asset_id, rights_verified, recipient_authorized, delivered_at, receipt_ref
- sales: authorized quote/order IDs and actual ledger references live in a PRIVATE transactional service; never inside public docs JSON.

## Media capabilities and integration truth

| Capability | 2026-11-14 state | Can do now | Not established |
| --- | --- | --- | --- |
| Higgsfield AI Influencer Builder | connector-assisted | Open builder; inspect trait sheet and quote | Integrated customer SaaS API, licensed automated service |
| Higgsfield image/video/Marketing Studio | connector-assisted | Interactive authorized generation with cost preflight | Server-side production adapter and sustained budget |
| Reel Effects: /tier-list /glass-graph /text-behind /captions /freeze-frame /over-the-shoulder | external tool verified | Editing of user-supplied confirmed MP4 using existing remote scripts; no paid model generation required for template render | A persistent production editor inside WITHU; verified rendered customer sample |
| InVideo AI agents/MCP | reference | Study vendor workflow and technical/legal terms | Connected InVideo account or callable integration |
| WITHU song checkout | code-only, fail closed | Read contracts and dry-run existing tests | PG authorization, commercial music rights, live payment + delivery |
| SONG-Vision custom model | R&D | Evaluate real code/datasets in its own validated environment | Production-quality singing video, verified learning on this task |

## Reel Effects behavior

- Source: authorized vertical or horizontal talking-head MP4, original spoken audio and real timestamps.
- /text-behind: foreground person matte + synchronized depth text; use verified speech key phrases.
- /glass-graph: overlays ONLY from actual spoken/user-supplied measurements, no invented values.
- /tier-list: ranks/items spoken in clip, never invented ranking.
- /captions: actual transcript, timed per word; inspect Hangul spelling.
- /freeze-frame and /over-the-shoulder: required contextual metadata/compared values, with user approval.
- Keep frame-safe layout, avoid face obstruction (except intentional occlusion), preserve audio and validate output duration/fps/codec.
- Higgsfield plugin scripts run in a separate ephemeral sandbox. They are not checked into this repository and are not production API calls.

## Learning and QA separation

Knowledge reuse: store vetted creative specs, descriptions, rights, prompts, versioned test results and failed cases as a structured, source-traceable dataset. Model training: consented media + correct phoneme/timing or video labels + actual trainer execution + checkpoint + independent holdout metrics. Passing a documentary audit is NOT training a neural network.

## Immediate implementation boundary

The business audit script and GitHub Actions workflow in this repository implement READ-ONLY contract auditing and agent onboarding; they do not change Song-Vision, payment, pricing or production output. Future production work must first inspect backend ports, verify provider API rights, and add adapter-specific tests. No parallel fake engine.
