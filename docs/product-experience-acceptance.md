# Product experience foundation: implementation and acceptance

Local implementation, 2026-10-10. No push, deployment, model call or independent legal acceptance is recorded here.

## Implemented

- Guided entry uses the existing NDA permitted-disclosure finding and exact quotation. The compact summary precedes expandable scores and metric definitions.
- English and German cover the guided flow, workspace, scenarios, method, status/error states and reports. English evidence and canonical identifiers remain original and labeled. JSON retains the native schemas.
- Phone review separates the list, explanation and contract into three explicit steps. Panel changes move focus. Desktop keeps the established three-column sheet, arrow-key navigation, quotation highlights and reference anchors.
- URLs preserve case/scenario, comparison, exact own or comparison quotation index, clause, list, tab, language, phone step and source edition. Unknown inputs are allowlisted or safely defaulted. Links reconstruct current deterministic snapshots, not historical server run IDs or session histories.
- The theme uses its applied DOM state when storage is denied. The shared design package is vendored for independent builds; Newsreader/Geist assets are local with their upstream licenses.
- Markdown/JSON actions say that a download was requested. `/report` provides browser printing with A4 styles, visible save instructions and edition checks. It does not generate a binary PDF or confirm that the user saved one.
- `/candidates` is separate from the benchmark. It displays one synthetic, hand-authored My Counsel recording and its original Python score. The complete recording hash, source/playbook/instruction hashes, run provenance and ordered result binding are checked before display. No live model, issue accuracy, DORA compliance, severity or document-coverage claim is made.
- `/candidates/experiment` (added 2026-10-11) is a second, separate viewer for hash-bound experiment bundles from the Python harness. In English and German it shows the preregistered design, the reference status per cell, every planned cell of each arm with its denominators, the comparison for an iteration arm, provider-reported usage and every recorded attempt. `lib/candidate-experiment.ts` checks the report's binding to the experiment file, each recording's digest and slot, the cell coverage and the consistency of the stated counts before display; it scores nothing. The bundled example `replay-dry-run` is a zero-cost dry run with one hand-authored attempt and eleven attempts not run. It is no model result. Checked on 2026-10-11 by unit tests, typecheck, lint, a production build and in-process requests to the built Worker handler under Node. No browser, print, screen-reader or local Worker HTTP check is recorded for this page.

## Verification evidence

- `npm run check`: lint, TypeScript, unit/parity tests, production build and local Worker HTTP checks. The HTTP suite includes 12 scored scenarios, five invalid requests and four report/replay-route checks.
- Unit coverage includes all 30 existing Python v1 parity vectors, locale identity invariance, exact URL restoration and range validation, English/German report preservation, missing denominators, complete replay hash and tamper checks, and theme cycles with denied storage.
- Chrome at 390 CSS pixels: finding to explanation to contract, focus placement, exact quotation highlight after reload and no document-level horizontal overflow. The comparison table intentionally has a labeled, keyboard-focusable horizontal scroll region.
- Chrome desktop: arrow navigation changed focus and selected finding together; scenario selection returned the expected server-scored result; DE/EN switches preserved selection. Own and removed comparison quotation links restored the exact passage. A changed harness edition visibly warned in the workspace and blocked the historical print report.
- EN/DE SaaS baseline reports were generated locally through Chromium, six A4 pages each. All 12 final page renders were inspected. Section grouping keeps quotation statuses with their text and findings intact; original evidence and complete hashes remain legible. Whitespace-normalized PDF text matches the displayed report. The local receipt is `outputs/acceptance/2026-10-10-pdf/receipt.json`. This verifies generated test files, not a user download or other browsers.
- The separately displayed replay retained four candidates, one duplicate, three valid quotation checks, three valid playbook references and the recorded rejected application-validation result. Original English evidence, source/code hashes and dirty working-tree provenance remained visible.
- Read-only WCAG contrast calculation: ink/muted/subtle against paper/surface/sunken; danger/warning/accent against their soft backgrounds; button text/accent; contract text/quotation highlight. All measured pairs exceeded 4.5:1 in both themes; the lowest was 5.10:1. This covers these pairs, not every possible state or a full accessibility audit.

## Remaining acceptance work

The planned lawyer/client-role usability sessions have not occurred. Screen-reader testing, a wider browser/device matrix, wider PDF/browser coverage and deployed smoke tests remain separate gates. The fixed examples and native replay do not establish general model quality or legal correctness. Independent annotations and any later live recording must enter through the harness workflow before the viewer can support new result claims.

The roadmap's editor, ownership handover and supervised public-document pilot are outside this repository's current implementation. The app continues to accept only bundled synthetic material.
