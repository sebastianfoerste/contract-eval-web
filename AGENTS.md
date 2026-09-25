# contract-eval-web

The public, interactive Evidence Lab for the Contract Review Evaluation project. Visitors explore deterministic AI contract review evaluations, toggle failure scenarios, inspect supporting evidence, and export reports without invoking live models.

Companion repository to [`contract-review-eval-harness`](https://github.com/sebastianfoerste/contract-review-eval-harness).

## Layout
- `app/page.tsx` — Server component; reads the shareable view (`?case=&scenario=&tab=&finding=`) and passes it to the workspace.
- `app/workspace.tsx` — Client state: current run, server evaluation queue, URL sync, WebMCP tool registration.
- `components/lab/` — Workspace views: `findings.tsx` (score cards, findings table, inspector, clause coverage), `evidence.tsx` (rendered contract with in-place quotation highlights), `compare.tsx` (scenario matrix, change ledger, session runs), `method.tsx`, `primitives.tsx`.
- `app/api/evaluate/route.ts` — Bounded evaluation server endpoint (1 KiB input cap, allowlisted cases only).
- `lib/scoring.ts` — Deterministic TypeScript scoring engine (`scoreReview`, `locate`, `normalize`). Port of Python `score_review`.
- `lib/inspection.ts` — Presentation logic: alias-resolved risk findings, severity direction, plain-language readout, clause coverage, run changes.
- `lib/document.ts` — Contract block parsing with source offsets and overlap-safe highlight segments.
- `lib/view.ts` — Allowlisted parsing and serialization of the shareable URL view.
- `lib/benchmark.json` — Static snapshot of synthetic cases (`nda`, `saas`, `dpa`), gold answers, stub fixtures, and cryptographic hashes.
- `scripts/export-benchmark.py` — Synchronizes synthetic inputs and parity vectors from `contract-review-eval-harness`.
- `tests/scoring.test.mjs` — 30 Python scoring parity vectors plus edge-case tests; `tests/inspection.test.mjs`, `tests/document.test.mjs` and `tests/view.test.mjs` check presentation, rendering and URL logic.
- `tests/python-parity.json` — Parity test vectors produced directly by the Python harness.
- `.openai/hosting.json` & `build/sites-vite-plugin.ts` — OpenAI Sites / Cloudflare Worker deployment configuration.

## Rules
- **Authoritative Source**: The Python harness is the single source of truth for evaluation methodology, gold answers, and scoring algorithms. Never modify `lib/benchmark.json` or `tests/python-parity.json` manually.
- **Scoring Parity Invariant**: Any change to `lib/scoring.ts` must pass all 30 parity vectors (`npm test`). If the Python scorer changes, regenerate vectors via `npm run export:benchmark` (or `make web-export` in the harness).
- **Public Safety & Privacy**: Synthetic contracts only. Zero live model calls, no arbitrary document uploads, no persistent shared state. Runs stay in-memory.
- **Sites Deployment Compatibility**: Keep the repository root compatible with OpenAI Sites / Cloudflare Worker requirements.

## Commands
- `npm run install:ci` — Install dependencies for the Sites environment.
- `npm test` — Run Node parity and inspection tests.
- `npm run test:types` — Typecheck TypeScript without emitting output (`tsc --noEmit`).
- `npm run dev` — Launch local development server.
- `npm run build` — Build production distribution for Sites runtime.
- `npm run check` — Run lint, types, Node tests, build, and local HTTP API checks.
- `npm run export:benchmark` — Refresh benchmark data from adjacent harness.
