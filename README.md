# Contract Review Evidence Lab — Interactive Web Explorer

A public, hosted evaluation workspace for the synthetic NDA, SaaS and DPA cases in Sebastian Förste's [contract-review-eval-harness](https://github.com/sebastianfoerste/contract-review-eval-harness).

This application serves as the **interactive explorer** tier of the Contract Review Evaluation project. While the authoritative Python engine develops the evaluation methodology, release certificates, and model adapters, this web app provides a zero-dependency, browser-safe environment for visitors to explore evaluation results, inspect failure scenarios, and download reports.

## Features

- Recompute deterministic review scores with a bounded server API.
- Compare original fixtures, removed evidence, missed risks and conflicting severities.
- Inspect reference severity, review reasoning, supporting quotations and full synthetic sources.
- Compare runs within the current session and export Markdown reports or complete JSON results.
- See source hashes and the exact originating Python repository commit.

The app calls no live model, accepts no contract uploads and stores no shared user history. Session runs are held in memory, capped at 30 and cleared on refresh. Reports must be downloaded for retention. The public API accepts only allowlisted synthetic cases and scenarios, with a 1 KiB input limit.

## Reference status

This release uses v1 reference answers from the Python repository. Independent v2 annotation returns and written adjudication artifacts were not available in the checkout. Their completion has been reported by the owner, but this app cannot verify or publish a v2 benchmark until the files are imported and checked. It issues no release certificate. The Python harness version remains 0.7.0rc1.

## Development

Use Node 22.13 or later.

```bash
npm run install:ci
npm run dev
npm test
npm run test:types
npm run build
```

The Sites build is Cloudflare Worker compatible. Logical hosting metadata is in `.openai/hosting.json`. The site is maintained in its own source repository, separately from the Python harness. See [PROJECT_ARCHITECTURE.md](https://github.com/sebastianfoerste/contract-review-eval-harness/blob/main/docs/PROJECT_ARCHITECTURE.md) for architectural details.

The production scoring port is `lib/scoring.ts`. Regenerate inputs and expected parity scores from the harness:

```bash
npm run export:benchmark
# or with an explicit harness path:
python3 scripts/export-benchmark.py --repo /path/to/contract-review-eval-harness
```

Run the HTTP integration checks against an actual local or deployed URL:

```bash
node tests/api-check.mjs https://YOUR_SITE
```

Every supported case and scenario is checked against Python `score_review` (32 tests in `tests/scoring.test.mjs`). Empty reviews, conflicting flags and quote matching have additional checks. These checks cover the bounded public inputs; they do not establish general equivalence for arbitrary documents or Unicode inputs.

## Incorporating adjudicated evidence

1. Import all three original independent return files and the written adjudication records into the Python repository.
2. Validate the return hashes and source offsets, resolve every disagreement, and freeze the v2 gold sets through the repository's workflow.
3. Regenerate and verify the evidence-bound campaign and certificates there.
4. Extend this app's versioned input export and scoring parity coverage to the v2 scorer before displaying v2 validation status.

Never replace missing annotation evidence with generated answers or remove the Python release hold based on this web deployment.

## Validation limits

Browser visual and interaction QA was not requested and was not performed. The optional WebMCP registration is feature-detected; no supported browser validation context was available. Ordinary app functions use the visible controls and evaluation API independently of WebMCP.

## License

MIT. Python-derived scoring and synthetic reference inputs copyright 2026 Sebastian Förste. See LICENSE.
