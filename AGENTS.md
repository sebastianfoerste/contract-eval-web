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
- `app/candidates/experiment/page.tsx` — Separate viewer for hash-bound candidate experiment bundles (`/candidates/experiment?id=…`), allowlisted by static imports from `public/candidates/experiments/`. Python owns every number; `lib/candidate-experiment.ts` verifies the bundle against the harness's experiment and report shape (references, ledger block, reservation snapshots with the hash of their ledger entry, dispatches that left no recording, matching over all observed attempts, injection and repair blocks, comparisons with both values and their difference), reads the report strictly and fails closed, and `scripts/export-candidate-experiment.py` copies a bundle from the harness. Run the exporter with the harness's interpreter (`../contract-review-eval-harness/.venv/bin/python scripts/export-candidate-experiment.py <id>`, or `uv run --project ../contract-review-eval-harness python scripts/export-candidate-experiment.py <id>`): before it records the hashes of the harness modules, it imports them from the harness checkout, aggregates the experiment again and requires `report.json` and `report.md` to equal the result byte for byte. With an interpreter that cannot import the harness's modules it refuses and copies nothing; never add a way around that check. It writes nothing into the harness. An empty attempt file is a LIVE dispatch that left no recording: the exporter copies it as zero bytes, the page never imports it, and the verifier hands the page `recording: null` for its row. The bundled `replay-dry-run` is a zero-cost dry run with one hand-authored attempt and eleven attempts not run; it is no model result. `tests/fixtures/candidate-experiment/` holds two synthetic bundles for the tests only (`synthetic-live-fixture`, `synthetic-lost-dispatch-fixture`), aggregated by the harness through `build_fixture.py`; no route serves them. The exporter tests use a stand-in harness that plain `python3` can import; one further test runs the harness's own aggregation on a temporary copy and is skipped where the harness with its `.venv` is not checked out beside this repository. When the harness changes an experiment or report shape, update exporter, verifier and page together, export the example again and rebuild the fixtures. Never edit a bundled report or a fixture by hand.
- `lib/i18n.ts`, `lib/presentation.ts`, `components/lab/locale.tsx` — EN/DE presentation. Original source text, quotes, identifiers, scores and reference rationales remain unchanged.
- `lib/scoring.ts` — Deterministic TypeScript scoring engine (`scoreReview`, `locate`, `normalize`). Port of Python `score_review`.
- `lib/inspection.ts` — Presentation logic: alias resolution, risk findings, their priority and tier, plain-language readout, clause coverage, run changes.
- `lib/document.ts` — Contract block parsing with source offsets, clause sections and overlap-safe highlight segments.
- `lib/view.ts` — Allowlisted parsing and serialization of the shareable URL view.
- `lib/benchmark.json` — Static snapshot of synthetic cases (`nda`, `saas`, `dpa`), gold answers, stub fixtures, and cryptographic hashes.
- `scripts/export-benchmark.py` — Synchronizes synthetic inputs and parity vectors from `contract-review-eval-harness`.
- `tests/scoring.test.mjs` — 30 Python scoring parity vectors plus edge-case tests; `tests/inspection.test.mjs`, `tests/document.test.mjs`, `tests/view.test.mjs` and `tests/report.test.mjs` check presentation, rendering, URL and report logic; `tests/export.test.mjs` verifies the export's integrity hashes, edition and release.
- `tests/python-parity.json` — Parity test vectors produced directly by the Python harness.
- `.openai/hosting.json` & `build/sites-vite-plugin.ts` — OpenAI Sites / Cloudflare Worker deployment configuration.

## Rules
- **Authoritative Source**: The Python harness is the single source of truth for evaluation methodology, gold answers, and scoring algorithms. Never modify `lib/benchmark.json` or `tests/python-parity.json` manually.
- **Node-loadable library modules**: Tests import `lib/*.ts` directly under Node type stripping. A module the tests load must import runtime helpers with explicit `.ts` extensions and receive `benchmark` data as a parameter rather than importing `lib/benchmark.ts`.
- **Colour and theme**: `app/globals.css` maps local semantics to `vendor/legal-ai-design-system/tokens.css`. Refresh that versioned package from its source rather than editing vendored tokens independently. Local font faces use explicit vendor asset paths because Tailwind import rebasing does not work for this pipeline. Red marks hidden exposure and amber marks false alarms; severity uses the neutral meter. Check new text and background pairs for a 4.5:1 contrast ratio in both themes.
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
