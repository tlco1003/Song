# WITHU BUSINESS OS — revenue-first operating plan

Status: working operating specification, 2026-11-14. Owner approval exists for non-destructive preparation and evidence-based extension. No confirmed live sales, completed production payments or business return is implied.

## Mission and product lanes

**Lane A — immediate pilot:** premium product/food/lifestyle AI commercial videos, quoting and human-supervised delivery. First proposed TEST price: KRW 590,000 for one 15–20-second video, 4–6 shots, one vertical deliverable and two scoped revision rounds. This is a hypothesis, NOT an existing SKU, verified market-clearing price, or an offer publicly activated in WITHU. Legal advertising claims and client IP licenses need review. Use a written pilot contract and true delivery evidence.

**Lane B — repeatable sales:** brand content subscription. Proposed pilot: two scoped edits/month for KRW 1,290,000/month, only after actual cost/time/customer feedback. It is a test proposition, not a booked contract. Track time, rework, gross margin, renewal and collections. Never misstate a recurring subscription as passive income.

**Lane C — existing WITHU:** custom lyrics/music-gift flow, existing docs/prices.json (SSOT: KRW 29,000 audio; 39,000 audio_duo; 300,000 starting-at quote for audio_video). Do NOT replace those prices with Lane A/B ideas; Lane A/B are a SEPARATE commercial service requiring a separate catalog, terms, workflow and verified rights.

**Lane D — R&D:** SONG-Vision engine training and ChefOS food-science computation are separately evaluated long-horizon technology projects, NOT a substitute for selling a verified product. ChefOS belongs to tlco1003/whthu; do not copy data or blend pipelines without explicit architectural and licensing review.

## Verified starting point

- WITHU is hosted in repository tlco1003/Song (PUBLIC, default main).
- UI files exist: docs/index.html, docs/create.html, docs/checkout.html; the price catalog is docs/prices.json.
- The repository has a publicCommerceReadiness contract in src/commerce.mjs that intentionally returns canCharge=false and blocks unapproved commerce. Other Firebase/Toss-related source files exist, but their presence does not verify live deployments, credentials, commercial agreements or transactions.
- Higgsfield ChatGPT account/plugin and editable Reel Effects scripts were individually inspected on 2026-11-14; the external interactive tool is not integrated into the WITHU server. Available creative workflows and rights/credits can change.
- InVideo agent capability is a separate reference. No usable InVideo ChatGPT connector was established at this review.
- No measured customer pipeline, actual margin, external production API, agent-to-agent memory system or third-party production contract was validated in this review.

## 0–90-day milestones (goals, NOT predictions)

| Window | Execution | Evidence for progression |
| --- | --- | --- |
| Days 1–14 | Choose ONE food/lifestyle use-case; produce 3 authorized portfolio samples; quote and usage-rights template | Real media files, source rights, measured hours and direct costs |
| Days 15–30 | Contact 30–50 appropriate brands with individual proposals, record contact consent, aim for 1 paid pilot | Actual leads, quotes, contract, payment receipt (in private CRM) |
| Days 31–60 | Fulfill and document client feedback; measure editing iterations and provider credit cost | Approved delivery, client acceptance, profitability and repeat request |
| Days 61–90 | Trial 2–3 retainers and a small manually produced WITHU music-order cohort (only with approved rights) | Signed terms, repeat orders, actual payment and churn evidence |

**Go/no-go:** with no qualified inquiries, revise positioning rather than add model features. With excessive production hours/revisions, revise scope and price. Do not activate online charges before legal, PG, licensed provider, refund, fulfillment and privacy reviews. Payment evidence is server-owned only.

## KPI semantics

- lead_count = distinct consented inbound/outbound qualified opportunities, without personal names in git.
- quote_count = formal quotes sent; conversion = verified wins / qualified quotes, undefined when denominator 0.
- realized_revenue_krw = settled business receipts net of refunds, from actual accounting only; UNKNOWN until ledger connected.
- direct_cost_krw = billed provider credits + contractor/hosting expenses attributable to the order.
- gross_margin = (realized_revenue - direct_cost)/realized_revenue; undefined when revenue 0. Report operator labor/time separately unless accounting method includes it.
- revision_hours, delivery_days, repeat_purchase_rate, cancellations and refunds require observed event logs. Do not populate dummy observations as true results.
- Free trials, posted prices, proposed quotas and repository artifacts do not count as sales.

## Sales and creative SOP

1. Validate client identity, product claim evidence, asset license, references, and advertising disclosure requirements.
2. Capture project brief and written deliverable scope, version, acceptance criteria, commercial rights, music/sfx usage and revision policy.
3. Lock a versioned creative spec (shots, duration, fps, format, brand constraints). Use human approval before paid media generation.
4. Run one provider at a time behind an adapter; record returned job ID, cost estimate/actual usage, asset hashes, provider model/version.
5. Transcribe/reference-align video; build overlays, captions and chart callouts from verified spoken words/data only. QA: identity, safe area, spelling, motion, sync, audio, disclosure.
6. Deliver a signed-off MP4 in private authorized storage. Invoice only through an authorized lawful channel. Follow up for objective feedback and repeat offer.
7. Record non-sensitive status and next gate in PROGRESS.md; sensitive client records in private CRM, NOT PUBLIC git.

## Provider and automation boundaries

- Internal agent steps share persisted project-level state: project_id, asset_id/hash, approved identity reference, approved creative spec/version, rights approvals, transcript/timestamps, job_id, step state, cost and review outcomes.
- External video generators, AI-influencer builders and reel-effects editors are replaceable adapters. The ChatGPT Higgsfield tool is interactive assistance, not a production server integration or customer credential.
- Song-Vision training requires consent, labeled data, reproducible training code, checkpoint/model digest, metrics and holdout test. A prompt or capability ledger is NOT ML training.
- No client PII, face recordings, vendor secrets or sensitive revenue figures in this public repository.

## Routine every implementation session

Read root AGENTS.md, this document, VIDEO_AGENT_CONTRACT.md, PROGRESS.md and capabilities.json. Inspect actual source, run scripts/business-ops-audit.mjs, relevant tests and npm test, then update evidence/status and report work performed. CI audit rechecks repository contracts but cannot verify external SaaS accounts, private data or commercial agreements. If review is impossible, report UNKNOWN, not PASS.

## Continuity

Persistent source of truth: this repository's documents and audited code, not conversation memory. Weekly decisions should be recorded as versioned commits. Use issue tickets or a private CRM for actionable work. Changes require evidence; avoid auto-merging, enabling billing, or paid generation.
