# Contract Review Evidence Lab — Interactive Web Explorer

A browser evaluation workspace for the synthetic NDA, SaaS and DPA cases in Sebastian Förste's [contract-review-eval-harness](https://github.com/sebastianfoerste/contract-review-eval-harness).

This application is the interactive explorer for the Contract Review Evaluation project. The authoritative Python engine owns evaluation methodology, reference answers, scoring and release evidence. The web app makes fixed results, failure scenarios and source quotations inspectable. It uses Next.js App Router conventions through vinext on Vite and runs as a Cloudflare Worker.

## Features

- Start with an existing fixture error: the synthetic NDA's permitted-disclosure clause is rated high in the reference and medium in the fixed review. Open that finding and its exact quotation, or move directly into exploration.
- Choose a contract and failure scenario. Each choice is re-scored by the bounded server API; the first view is a deterministic reference snapshot. A failed request keeps the previous result and offers a retry.
- Read a compact result summary first, then expand metric definitions and detailed scores.
- Work in a three-column desktop review sheet. On phones, use the finding, explanation and contract steps; transitions move keyboard focus to the selected panel.
- Findings are grouped and ordered by seriousness. Hidden exposure (a missed, under-rated or contradictory risk) ranks above any false alarm, and ties go to the higher-severity clause.
- See every quoted passage highlighted and numbered in the contract. The selected clause carries a margin rule and its reference anchor is underlined, so a missed risk shows where the review should have looked.
- Compare all four scenarios in a sensitivity matrix, list every clause, flag and quotation that differs between two scenarios, and reopen server runs from this session.
- Share contract, scenario, selected comparison, tab, list, finding, exact quotation index, phone panel and language. Removed comparison quotations have their own `cquote` index. Reference-edition mismatches show a warning; they do not silently claim to restore an old result. Legacy findings/evidence links still work.
- Use English or German controls, explanations and reports. Original English contracts, quotations, reference rationales, identifiers and raw JSON retain their original wording and are labeled accordingly.
- Download Markdown and JSON, or open `/report` for a readable print view with a browser **Print / Save as PDF** action. The app does not generate or confirm a saved PDF. The print route reconstructs the deterministic snapshot; export JSON or Markdown from the workspace to retain a session run's original timestamp and identifier. Historical print views are blocked when the reference edition differs.
- Light and dark themes follow the system and remain switchable when local storage fails. A versioned, vendored design package supplies the shared palette and licensed local Newsreader/Geist fonts. No font CDN is required.

The app calls no live model, accepts no contract uploads and stores no shared user history. Session runs are held in memory, capped at 30 and cleared on refresh. Reports must be downloaded for retention. The public API accepts only allowlisted synthetic cases and scenarios, with a 1 KiB input limit.

## Native My Counsel replay

`/candidates?lang=en` and `/candidates?lang=de` display one separate, **hand-authored REPLAY** in My Counsel's native format. The synthetic ICT agreement is reviewed with the commercial playbook. Four retained candidates include one duplicate and one unsupported playbook reference. The application rejected the original output; the Python evaluator retains and checks every finding. The view distinguishes exact quotation checks, missing-clause structure and playbook/category validity.

This is an artifact viewer, not a live model result or an additional v1 benchmark case. Issue precision/recall are unavailable without independent annotation. Native output has no severity or complete clause inventory; legal reasoning and amendment quality remain for lawyer review. The viewer makes no DORA compliance claim. Token usage and model cost are unavailable.

The original run and Python score are copied to `public/candidates/`. Before rendering, the server verifies the Python score's canonical recording SHA-256, source/playbook/instruction binding, complete run metadata and ordered finding indices. File hashes and the recorded dirty working-tree state remain visible. A hash binds bytes; it is not an independent attestation. Refresh only after validating and scoring in the adjacent harness:

```bash
python3 scripts/export-candidate-replay.py
```

This bounded exporter accepts the known synthetic replay and leaves the benchmark export and scoring algorithms untouched.

## Candidate experiment bundle

`/candidates/experiment?id=replay-dry-run&lang=en` and `/candidates/experiment?id=replay-dry-run&lang=de` display one preregistered experiment from the Python harness: the design, every planned cell with its denominators, the reference status per cell, each arm with its prompt version, code revision and model label, the comparison table for an iteration arm, provider-reported usage where a recording states it, and every recorded attempt with its recording hash and a download.

The bundled example is a zero-cost dry run. It holds one hand-authored attempt, the replay shown at `/candidates`, registered in a twelve-slot REPLAY design. Eleven attempts were not run and no model was called. It is no model result: no reference is registered, so issue precision and recall appear as N/A, and no comparison is drawn.

Python owns every number. `lib/candidate-experiment.ts` scores nothing and recomputes no rate. Before rendering, the server checks that `report.json` carries the SHA-256 of `experiment.json`, that each recording has the canonical digest its report row states and sits in the slot the experiment assigns to it, that the cells cover exactly arms × playbooks × variants, and that the integer counts of each cell agree with its attempt rows. A bundle that fails a check is not displayed. The bundler hands the page parsed JSON, so the page rebuilds the experiment file text in the harness's two-space JSON form; `tests/candidate-experiment.test.mjs` proves that this text equals the file bytes. A hash binds bytes; it is not an independent attestation.

Only experiments imported in `app/candidates/experiment/page.tsx` are addressable. Any other id shows a not-found state. Refresh a bundle after the harness has registered the attempts and written `report.json`:

```bash
python3 scripts/export-candidate-experiment.py replay-dry-run
```

The exporter refuses a bundle whose schemas, hashes, attempt slots or synthetic-corpus marker do not match. It also refuses a corpus path that leaves the harness, because the published experiment file would name local directories, a corpus manifest that changed since the experiment was planned, and a harness module that changed after `report.json` was written. In the last two cases, aggregate again in the harness before exporting. It copies `experiment.json`, `report.json` and the registered attempt and reference files byte for byte to `public/candidates/experiments/<id>/` and writes `provenance.json` with their hashes, the hashes of two harness modules and the harness commit. A new attempt or reference file also needs its import in the page; `npm test` fails until the page imports every bundled file.

## Reference status

This release scores reviews against the v1 reference answers from the Python repository. At the recorded harness commit, the exported evidence gate for the v2 candidate answers stands at `awaiting_returns`: independent returns, written adjudication and a verified freeze are still missing. This app cannot verify or publish a v2 benchmark until those artifacts are imported and checked in the Python harness. It issues no release certificate. The Python harness version remains 0.7.0rc1.

The interface reads the exported `referenceEvidence` gate directly. The gate describes the v2 candidate answers, not the v1 answers used for scoring, and the report and Method tab label the two separately. A missing denominator appears as N/A in the interface and report; JSON results retain the Python-compatible numeric values.

## Development

Use Node 22.13 or later.

```bash
npm run install:ci
npm run dev
npm test
npm run test:types
npm run build
npm run check
```

This repository is the app's source, maintained separately from the Python harness. See [PROJECT_ARCHITECTURE.md](https://github.com/sebastianfoerste/contract-review-eval-harness/blob/main/docs/PROJECT_ARCHITECTURE.md) for architectural details.

The production scoring port is `lib/scoring.ts`. Regenerate inputs and expected parity scores from the harness:

```bash
npm run export:benchmark
# or with an explicit harness path:
python3 scripts/export-benchmark.py --repo /path/to/contract-review-eval-harness
```

`npm run check` also starts the built local Worker and runs the HTTP contract checks. To check a deployed URL separately:

```bash
node tests/api-check.mjs https://YOUR_SITE
```

Every supported case and scenario is checked against Python `score_review` (30 parity vectors in `tests/scoring.test.mjs`). Additional tests cover edge cases, score presentation, alias-resolved risk findings, severity direction, the plain-language readout, clause coverage, comparison changes, contract rendering offsets, source offsets after characters outside the Basic Multilingual Plane, the evidence report, shareable URL parsing and the reference gate. `tests/export.test.mjs` recomputes the export's integrity and source hashes and checks that its schema, scoring edition and release match this app, so a hand-edited `lib/benchmark.json` fails `npm test`. The HTTP suite checks 12 supported case-scenario combinations and five invalid requests. These checks cover the bounded public inputs; they do not establish general equivalence for arbitrary documents or Unicode inputs.

## Deployment

The app is deployed to Cloudflare Workers as the Worker `contract-eval-web`. Cloudflare Workers Builds is connected to this repository: every push to `main` runs `npm run build` and then `npx wrangler deploy`. GitHub Actions runs lint, types, tests, the build and the local Worker API check on every pull request first. `.node-version` keeps the Cloudflare build on the same Node major as CI. The Worker uses no database, storage bucket or secret.

To deploy by hand, sign in once with `npx wrangler login`, then run:

```bash
npm run build
npx wrangler deploy
```

`npm run build` writes the Worker and its configuration to `dist/`, and `.wrangler/deploy/config.json` points `wrangler deploy` there.

## Incorporating adjudicated evidence

1. Import all three original independent return files and the written adjudication records into the Python repository.
2. Validate the return hashes and source offsets, resolve every disagreement, and freeze the v2 gold sets through the repository's workflow.
3. Regenerate and verify the evidence-bound campaign and certificates there.
4. Extend this app's versioned input export and scoring parity coverage to the v2 scorer before displaying v2 validation status.

Never replace missing annotation evidence with generated answers or remove the Python release hold based on this web deployment.

An [independent challenge-set protocol](docs/challenge-set-protocol.md) records the acceptance criteria for a future blinded evaluation. No unseen, independently adjudicated challenge set is claimed in this release.

## Validation limits

The 2026-10-10 local browser check covered guided entry, DE/EN switching, keyboard finding navigation, a 390 CSS-pixel phone view, exact own/comparison quotation restoration, theme cycling, server scenario selection, reference-edition warnings and EN/DE print views. Print CSS was inspected; no saved PDF or deployment is claimed. Core text and status color pairs were checked at 4.5:1 or better in both themes. This is not a full screen-reader, browser-matrix or WCAG conformance audit.

Tests cover denied-storage theme behavior, locale-invariant score identities, URL allowlists, replay hash binding and tamper rejection. The HTTP gate checks the report and replay routes alongside the original scoring requests. See [implementation and acceptance notes](docs/product-experience-acceptance.md) for the scope and remaining human acceptance work.

The optional WebMCP registration is feature-detected. Ordinary app functions use the visible controls and evaluation API independently of WebMCP.

## License

MIT. Python-derived scoring and synthetic reference inputs copyright 2026 Sebastian Förste. See LICENSE.
