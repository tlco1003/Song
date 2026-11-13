# WITHU — Agent execution contract (2026-11-14)

This repository hosts the public WITHU music-gift web experience and related production code. Before ANY change involving business operations, media generation, AI agents, customer orders, payments, marketing, or workflow automation:

1. Read this file, [the business operating plan](docs/business/OPERATING_PLAN.md), [the video-agent contract](docs/business/VIDEO_AGENT_CONTRACT.md), and [the verified capability ledger](docs/business/capabilities.json).
2. Inspect CURRENT code, configuration, branches, tests, and provider permissions. Do not assume this document proves that a live API, commercial licence, deployment or model training exists.
3. Use the existing modules and contracts. In particular, preserve src/commerce.mjs, src/production-contract.mjs, src/paid-order-pipeline.mjs, order-price SSOT docs/prices.json, verified-payment barriers and private-delivery controls. Never bypass disabled commerce readiness or replace proven logic with hard-coded demonstrations.
4. On every implementation session run: node scripts/business-ops-audit.mjs, npm run check, npm test where the environment permits. Report EXACT commands, exit codes, changes, and unavailable checks. An automated scheduled audit does not replace full integration tests.
5. Separate VERIFIED (measured/tested), CONNECTOR_ASSISTED (interactive ChatGPT plugin), DESIGNED (contract only), BLOCKED (rights/deployment/credentials), and UNKNOWN. Never call AI-generated assets trained models unless actual model training and evaluation artifacts exist.
6. External Higgsfield or InVideo connected ChatGPT features are NOT proof of a deployable commercial API. No paid generation, live checkout, publication, customer contact, or provider subscription changes without user approval and applicable permissions.
7. Record every business/pipeline change in docs/business/PROGRESS.md with date, Git commit, verification evidence and next blocker; update docs/business/capabilities.json ONLY after verifying evidence.
8. No real customer or model-training personal data, email lists, biometric media, credentials or commercial secrets in this PUBLIC repository. Private/consented assets must remain in authorized private storage.
9. For customers: do not claim a company registration, partner approval, customer success, model accuracy, license grant, actual completed sale, or campaign effectiveness without evidence.
10. Avoid destructive rewrites, branch switches, merges, releases and production deployment without explicit authorization. Preserve existing features and regression tests.

**Execution sequence:** inspect -> reproduce -> modify existing source of truth -> focused tests -> full regression -> record evidence -> report blockers. Plan and audit data are not self-training; model learning requires licensed data, training code, checkpoint and independent evaluation.

All other project areas (SONG-Vision research and unrelated experiments) remain intact. This file does not authorize code modification outside the user's request.
