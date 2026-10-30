# contract-eval-web

The public, interactive Evidence Lab for the Contract Review Evaluation project. Visitors explore deterministic AI contract review evaluations, toggle failure scenarios, inspect supporting evidence, and export reports without invoking live models.

Companion repository to [`contract-review-eval-harness`](https://github.com/sebastianfoerste/contract-review-eval-harness).

## Layout
- `app/page.tsx` — Server component; reads the allowlisted shareable view, including exact quotation/comparison indices, locale and reference edition, and passes it to the workspace.
- `app/workspace.tsx` — Client state: current run, server evaluation queue with retry, selection, URL sync, WebMCP tool registration.
- `app/layout.tsx` — Metadata, viewport and the inline script that applies a stored theme before first paint. Keep that script in the body: a hand-written head element shifts React's generated ids and breaks hydration of the tabs.
- `components/lab/` — Workspace views: `review.tsx` (the review sheet: list, clause notes, marked-up contract), `scores.tsx` (score band), `compare.tsx` (scenario matrix, change ledger, session runs), `method.tsx`, `primitives.tsx` (severity meter, tags, segmented control, theme switch).
- `app/api/evaluate/route.ts` — Bounded evaluation server endpoint (1 KiB input cap, allowlisted cases only).
- `app/report/page.tsx` — Deterministic print-ready report. Browser Save as PDF is a user action, not a confirmed download.
- `app/candidates/page.tsx` — Separate bundled synthetic My Counsel REPLAY viewer. Python owns these scores; `lib/candidate-replay.ts` verifies complete-recording hash binding and presentation scope. This is not a v1/v2 benchmark result.
- `app/candidates/experiment/page.tsx` — Separate viewer for hash-bound candidate experiment bundles (`/candidates/experiment?id=…`), allowlisted by static imports from `public/candidates/experiments/`. Python owns every number; `lib/candidate-experiment.ts` verifies the bundle and fails closed, and `scripts/export-candidate-experiment.py` copies it from the harness. The bundled `replay-dry-run` is a zero-cost dry run with one hand-authored attempt and eleven attempts not run; it is no model result.
- `lib/i18n.ts`, `lib/presentation.ts`, `components/lab/locale.tsx` — EN/DE presentation. Original source text, quotes, identifiers, scores and reference rationales remain unchanged.
- `lib/scoring.ts` — Deterministic TypeScript scoring engine (`scoreReview`, `locate`, `normalize`). Port of Python `score_review`.
- `lib/inspection.ts` — Presentation logic: alias resolution, risk findings, their priority and tier, plain-language readout, clause coverage, run changes.
- `lib/document.ts` — Contract block parsing with source offsets, clause sections and overlap-safe highlight segments.
- `lib/view.ts` — Allowlisted parsing and serialization of the shareable URL view.
- `lib/benchmark.json` — Static snapshot of synthetic cases (`nda`, `saas`, `dpa`), gold answers, stub fixtures, and cryptographic hashes.
- `scripts/export-benchmark.py` — Synchronizes synthetic inputs and parity vectors from `contract-review-eval-harness`.
- `tests/scoring.test.mjs` — 30 Python scoring parity vectors plus edge-case tests; `tests/inspection.test.mjs`, `tests/document.test.mjs`, `tests/view.test.mjs` and `tests/report.test.mjs` check presentation, rendering, URL and report logic; `tests/export.test.mjs` verifies the export's integrity hashes, edition and release; `tests/annotator-names.test.mjs` mirrors the harness guard that fails if either annotator's personal name appears in a tracked file.
- `tests/python-parity.json` — Parity test vectors produced directly by the Python harness.
- `tests/grounding-vectors.json` — Hand-authored quotation-grounding vectors, byte-identical to the harness's `tests/fixtures/grounding-vectors.json`. Change both copies together.
- `vite.config.ts` — vinext and Cloudflare Worker build configuration. Cloudflare Workers Builds deploys every push to `main` (see README, Deployment).

## Rules
- **Authoritative Source**: The Python harness is the single source of truth for evaluation methodology, gold answers, and scoring algorithms. Never modify `lib/benchmark.json` or `tests/python-parity.json` manually.
- **Node-loadable library modules**: Tests import `lib/*.ts` directly under Node type stripping. A module the tests load must import runtime helpers with explicit `.ts` extensions and receive `benchmark` data as a parameter rather than importing `lib/benchmark.ts`.
- **Colour and theme**: `app/globals.css` maps local semantics to `vendor/legal-ai-design-system/tokens.css`. Refresh that versioned package from its source rather than editing vendored tokens independently. Local font faces use explicit vendor asset paths because Tailwind import rebasing does not work for this pipeline. Red marks hidden exposure and amber marks false alarms; severity uses the neutral meter. Check new text and background pairs for a 4.5:1 contrast ratio in both themes.
- **Scoring Parity Invariant**: Any change to `lib/scoring.ts` must pass all 30 parity vectors (`npm test`). If the Python scorer changes, regenerate vectors via `npm run export:benchmark` (or `make web-export` in the harness).
- **Public Safety & Privacy**: Synthetic contracts only. Zero live model calls, no arbitrary document uploads, no persistent shared state. Runs stay in-memory.
- **Cloudflare Workers Deployment**: Every push to `main` deploys. Keep `npm run build` producing a Worker that `npx wrangler deploy` can publish from the repository root, and keep `npm run check` passing before merging.

## Commands
- `npm run install:ci` — Install dependencies, including dev and optional packages.
- `npm test` — Run Node parity and inspection tests.
- `npm run test:types` — Typecheck TypeScript without emitting output (`tsc --noEmit`).
- `npm run dev` — Launch local development server.
- `npm run build` — Build the production Cloudflare Worker into `dist/`.
- `npm run check` — Run lint, types, Node tests, build, and local HTTP API checks.
- `npm run export:benchmark` — Refresh benchmark data from adjacent harness.
