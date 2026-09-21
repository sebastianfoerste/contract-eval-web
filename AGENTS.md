# contract-eval-web

The public, interactive Evidence Lab for the Contract Review Evaluation project. Visitors explore deterministic AI contract review evaluations, toggle failure scenarios, inspect supporting evidence, and export reports without invoking live models.

Companion repository to [`contract-review-eval-harness`](https://github.com/sebastianfoerste/contract-review-eval-harness).

## Layout
- `app/workspace.tsx` — Main interactive workspace: findings table, inspector, evidence viewer, side-by-side scenario comparisons.
- `app/api/evaluate/route.ts` — Bounded evaluation server endpoint (1 KiB input cap, allowlisted cases only).
- `lib/scoring.ts` — Deterministic TypeScript scoring engine (`scoreReview`, `locate`, `normalize`). Port of Python `score_review`.
- `lib/benchmark.json` — Static snapshot of synthetic cases (`nda`, `saas`, `dpa`), gold answers, stub fixtures, and cryptographic hashes.
- `scripts/export-benchmark.py` — Synchronizes synthetic inputs and parity vectors from `contract-review-eval-harness`.
- `tests/scoring.test.mjs` — 32 automated tests verifying scoring parity against Python outputs.
- `tests/python-parity.json` — Parity test vectors produced directly by the Python harness.
- `.openai/hosting.json` & `build/sites-vite-plugin.ts` — OpenAI Sites / Cloudflare Worker deployment configuration.

## Rules
- **Authoritative Source**: The Python harness is the single source of truth for evaluation methodology, gold answers, and scoring algorithms. Never modify `lib/benchmark.json` or `tests/python-parity.json` manually.
- **Scoring Parity Invariant**: Any change to `lib/scoring.ts` must pass all 32 parity tests (`npm test`). If the Python scorer changes, regenerate vectors via `npm run export:benchmark` (or `make web-export` in the harness).
- **Public Safety & Privacy**: Synthetic contracts only. Zero live model calls, no arbitrary document uploads, no persistent shared state. Runs stay in-memory.
- **Sites Deployment Compatibility**: Keep the repository root compatible with OpenAI Sites / Cloudflare Worker requirements.

## Commands
- `npm run install:ci` — Install dependencies for the Sites environment.
- `npm test` — Run Node parity test suite (all 32 tests must pass).
- `npm run test:types` — Typecheck TypeScript without emitting output (`tsc --noEmit`).
- `npm run dev` — Launch local development server.
- `npm run build` — Build production distribution for Sites runtime.
- `npm run export:benchmark` — Refresh benchmark data from adjacent harness.
