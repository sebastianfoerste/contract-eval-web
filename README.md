# Contract Review Evidence Lab — Interactive Web Explorer

A browser evaluation workspace for the synthetic NDA, SaaS and DPA cases in Sebastian Förste's [contract-review-eval-harness](https://github.com/sebastianfoerste/contract-review-eval-harness).

This application is the interactive explorer for the Contract Review Evaluation project. The authoritative Python engine owns evaluation methodology, reference answers, scoring and release evidence. The web app makes fixed results, failure scenarios and source quotations inspectable. It uses Next.js App Router conventions through the existing vinext/Vite Sites runtime.

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

`/candidates/experiment?id=replay-dry-run&lang=en` and `/candidates/experiment?id=replay-dry-run&lang=de` display one preregistered experiment from the Python harness, as its report states it:

- the design, with its declared injection variants and the playbook entries each variant is declared to repair, as the harness's Markdown report states them under its design line;
- each arm with its prompt version, code revision, model label, change and hypothesis, and for a LIVE experiment its budget reservation with state and settled amount;
- the reference of each cell with status, route, expected issues, low-confidence issues, whether doubts were recorded and whether the harness re-ran the derivation, beside the sentence that no reviewer identity is verified;
- per cell the planned, observed, not run, completed, refused and failed attempts, the attempts in which all findings are valid beside the recorder's accepted and rejected counts, findings, duplicates, trivial quotations and the validity counts as valid of checked;
- precision and recall as matched of denominator with the stated rate, the same figures after application validation, and entry-level recall;
- injection and repair counts where attempts completed, each beside the planned attempts and the number of attempts that hold such a finding, and validation disagreements, repetitions of the same findings and dispatches without a recording where they are not zero;
- for an iteration arm the observed of planned attempts of both cells, the baseline value, the iteration value and the difference per metric, or the stated reason where a cell is not comparable;
- provider-reported usage with the number of attempts that reported it, and every observed attempt: a recording with outcome, recorder validation, recording hash and download, or a dispatch that left no recording, shown as such without a hash, run data or a download;
- the five rules and the caveats as unchanged English source, and the export provenance.

A dispatch that left no recording exists only in a LIVE experiment. The recorder creates the attempt file empty before its call and fills it afterwards, so an empty file means that a call was dispatched and may have been billed. The harness counts it as a failed attempt that found nothing. The page counts it apart from the recordings and from the attempts not run.

A missing denominator appears as N/A, never as 0. Rates and differences are shown to two decimal places and rounded as the harness's Markdown report rounds them, so 1 of 8 reads 0.12 in both; `report.json` keeps the unrounded values.

The bundled example is a zero-cost dry run. It holds one hand-authored attempt, the replay shown at `/candidates`, registered in a twelve-slot REPLAY design. Eleven attempts were not run and no model was called. It is no model result: no reference is registered, so every matching figure appears as N/A, no comparison is drawn and no budget is reserved.

Python owns every number. `lib/candidate-experiment.ts` scores nothing and recomputes no rate. Before rendering, the server checks that:

- `report.json` carries the SHA-256 of `experiment.json` and states the same design and arms;
- the attempt slots are exactly what the design and the arms imply, and each recording has the canonical digest its report row states, sits in its slot and was produced by its arm;
- a dispatch that left no recording is stated by the experiment file, the report and the bundle alike, or it is refused: the experiment file registers the slot under the SHA-256 of an empty file, the report lists the row the harness writes for it (FAILED, NO_OUTPUT, NO_RECORDING, without hash, start, duration or usage), the bundle holds no recording for the slot, and the design is LIVE;
- the cells cover exactly arms × playbooks × variants, and the integer counts of each cell equal the sums over its attempt rows, where repetitions of the same findings count only completed attempts that returned at least one finding;
- a rate is absent exactly where its denominator is zero;
- issue matching counts every observed attempt, so an attempt without output contributes its expected issues as false negatives, and the figures after application validation count only the attempts in which all findings are valid;
- an injection block exists for each declared injection variant, and a repair block where the variant is declared to repair an entry that the cell's playbook holds;
- the comparisons cover every cell of an iteration arm, state a metric exactly where both cells state the value, and each difference equals iteration minus baseline within floating-point tolerance;
- the references block matches the experiment file and the bundled reference files, each bundled reference file has the hash the experiment registers for it and is bound to the document and playbook its recordings used, and `independentReviewClaimVerified` is false;
- a LIVE report carries the reservation of each arm as the experiment file binds it, each reservation snapshot states the SHA-256 of its ledger entry in the experiment file and in the report alike, an arm with a recording or a dispatch without one has an open or settled reservation, no LIVE recording comes from a dirty working tree or starts before the reservation of its arm, while a REPLAY report carries no ledger block and names only the hand-authored fixture as its model;
- the attempts listed as not run are the unregistered slots, and `provenance.json` lists the bundled files with their registered hashes.

The report is read strictly: a field the viewer does not know stops the page, so a later change of the report shape cannot leave a statement out unnoticed. A bundle that fails a check is not displayed. The bundler hands the page parsed JSON, so the page rebuilds the text of the experiment file and of each reference file in the harness's two-space JSON form; `tests/candidate-experiment.test.mjs` proves that this text equals the file bytes. A hash binds bytes; it is not an independent attestation.

Three limits follow from what a bundle holds and from the rule that the browser scores nothing. The spend ledger stays in the harness, so the page shows the reservation state and the settled amount that the report states and cannot check them against the ledger. The same holds for the hash of the ledger entry in a reservation snapshot: the viewer requires it in both files and holds the two to each other, cannot hold it to the entry, and does not display it. The annotation and adjudication files of an adjudicated reference are bound by their hashes in `provenance.json`; the viewer does not read them and does not repeat the harness's derivation. The verifier takes each stated rate and each scoring count of an attempt row (validity, duplicates, matches, stale findings, quotations of the injected paragraph) from the report: it checks their sums and that a rate is absent exactly without a denominator, and it derives none of them from the recordings.

Only experiments imported in `app/candidates/experiment/page.tsx` are addressable. Any other id shows a not-found state. Refresh a bundle after the harness has registered the attempts and written `report.json` and `report.md`. The exporter has the harness aggregate the experiment once more, which needs the harness's Python environment, so run it with the harness's interpreter:

```bash
../contract-review-eval-harness/.venv/bin/python scripts/export-candidate-experiment.py replay-dry-run
# or
uv run --project ../contract-review-eval-harness python scripts/export-candidate-experiment.py replay-dry-run
```

The exporter refuses a bundle whose schemas, hashes, attempt slots, reference description, ledger block or synthetic-corpus marker do not match, and a reference file that is not in the harness's two-space JSON form, because the viewer could not rebuild its bytes. It also refuses a corpus path that leaves the harness and any copied file that names a directory of the exporting machine, a corpus manifest that changed since the experiment was planned, and a destination that holds files outside the bundle.

`provenance.json` records the hashes of five harness modules as the code behind the report. Before the exporter records them, it imports those modules from the harness checkout beside this repository, aggregates the experiment with them and requires `report.json` and `report.md` to equal the result byte for byte, as the harness's own `scripts/check_candidate_experiments.py` does. It refuses a report that does not reproduce, an experiment that the harness refuses to aggregate, and an aggregation that ran through other harness modules than the five it records. File times play no part: a module edited after the aggregation passes when the code still writes the same report, and touching an outdated report does not make it pass. An interpreter that cannot import the harness's modules, such as a plain `python3` without the harness's packages, gets a refusal in one sentence that names the two commands above; the exporter never copies a bundle without this check. It writes nothing into the harness, not even bytecode. After a changed manifest, or a module change that changes the report, aggregate again in the harness before exporting.

It copies `experiment.json`, `report.json`, the registered attempt and reference files and, for a reference with registered sources, its two annotation files and its adjudication record byte for byte to `public/candidates/experiments/<id>/`. It writes `provenance.json` with their hashes, the harness commit and the hashes of the five harness modules the aggregation runs through. Annotation and adjudication files carry the names or labels their authors wrote. The exporter prints a notice when it copies them into the public directory; read them before the site is deployed. A new recording or reference file also needs its import in the page; `npm test` fails until the page imports every bundled file it reads.

The empty attempt file of a dispatch that left no recording is copied as it is, zero bytes under its registered hash. The exporter refuses it unless the design is LIVE and the report lists it as such a dispatch, counts it apart from the recordings in the `scope` of `provenance.json` and names it in a notice. It is no JSON, so the page does not import it.

The bundled example has one arm, no reference and no comparison. The tests therefore verify two further bundles under `tests/fixtures/candidate-experiment/`, which the harness aggregated from synthetic annotations and recordings in a temporary copy of its corpus. `synthetic-live-fixture/` holds two arms, references and comparisons. `synthetic-lost-dispatch-fixture/` holds one settled arm with three dispatches that left no recording and two completed attempts without a finding. Both are test material and no model result, and no route serves them. `tests/fixtures/candidate-experiment/README.md` states how they were built and how to rebuild them after the harness changes a file shape.

The exporter tests run the exporter beside a stand-in harness in a temporary directory, whose stand-in modules plain `python3` can import. One further test runs it with the harness's own aggregation on a temporary copy of the harness; it is skipped where `contract-review-eval-harness` with its `.venv` is not checked out beside this repository.

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

The Sites build is Cloudflare Worker compatible. Logical hosting metadata is in `.openai/hosting.json`. The site is maintained in its own source repository, separately from the Python harness. See [PROJECT_ARCHITECTURE.md](https://github.com/sebastianfoerste/contract-review-eval-harness/blob/main/docs/PROJECT_ARCHITECTURE.md) for architectural details.

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
