# Candidate experiment test fixtures

`synthetic-live-fixture/` and `synthetic-lost-dispatch-fixture/` are synthetic test material for `tests/candidate-experiment.test.mjs`. It is not a model result. No model was called, no call was dispatched, no money was reserved or spent, and every annotation, rationale, hypothesis, finding and price in them is test text. The model label is `synthetic-fixture-not-a-model`, and each experiment file says the same in its `notes`.

The bundled example under `public/candidates/experiments/replay-dry-run/` has one arm, no reference and no comparison. The verifier's checks for references, matching, comparisons, injection and repair counts, the spend ledger and dispatches without a recording need reports that state those blocks. These fixtures are those reports.

## How they were produced

`build_fixture.py` calls the functions of the Python harness in the order an operator would, against a temporary copy of `contract-review-eval-harness/candidates/mycounsel`. For each fixture the harness plans the experiment, compiles the DRAFT references from synthetic annotations, reserves and settles in a copy of the spend ledger, registers the slot files together with that ledger and aggregates `report.json`. Each reservation snapshot in `experiment.json` and `report.json` carries the hash of its entry in that ledger copy (`ledgerEntrySha256`). The recordings are derived from the hand-authored `replay-run.json` and validated by the harness. No number in either `report.json` was written by hand.

Both designs are LIVE-shaped so that the ledger block exists.

`synthetic-live-fixture/` has two arms, two playbooks, three document variants and two repetitions. The baseline arm is settled and the iteration arm is reserved and open. It holds completed, refused and failed attempts, attempts with and without provider usage, an output the recorder rejected, an injection cell, a repairing variant with stale findings, a reference that expects no issue, a cell that neither arm completed and slots that never ran.

`synthetic-lost-dispatch-fixture/` has one settled arm, one playbook, three document variants and two repetitions, and every slot is registered. Three slot files are empty. The recorder creates a slot file empty before its call and fills it afterwards, so an empty file means a call that is still out or one that ended without a recording, and only the operator knows which. The harness therefore binds an empty slot only when the operator names it (`register --lost attempts/<arm>/<slot>.json`); `build_fixture.py` names the three through `register(..., lost=[...])`. The harness then registers each as a dispatch that left no recording, reports it as a failed attempt that found nothing and settles it at its full hold. One of the three stands beside a completed attempt and two share a cell. The third cell holds two completed attempts that both returned nothing, which the harness does not count as identical outputs. One annotation states that its author had seen model output, so the report carries that caveat. The three empty files are zero bytes on disk; `provenance.json` lists them under the SHA-256 of an empty file.

Each `provenance.json` is written by `build_fixture.py`, not by `scripts/export-candidate-experiment.py`. It records the harness commit and the hashes of the five harness modules at the time of the build, and its `scope` states that the bundle is a test fixture.

The fixtures live outside `public/` and are not imported by `app/candidates/experiment/page.tsx`, so no route serves or displays them.

## Rebuild

After the harness changes the shape of an experiment file or a report, rebuild the fixtures instead of editing them. From the repository root, with the harness checked out beside this repository:

```sh
../contract-review-eval-harness/.venv/bin/python -B tests/fixtures/candidate-experiment/build_fixture.py \
  --harness ../contract-review-eval-harness \
  --work "$TMPDIR/candidate-experiment-fixture" \
  --out "$TMPDIR/candidate-experiment-fixture/out"
```

The output directory then holds one folder per fixture. Replace the two folders of the same names here with them and run `npm test`. The script writes nothing into the harness: `-B` keeps Python from writing bytecode there, and every file it creates lies under `--work` or `--out`.

Built on 2026-10-13 against harness commit `cce3c46666ec15227e9286ead26baa1163a98e29`; the harness working tree held untracked files at that time, which each `provenance.json` records. A second build into another directory was byte-identical.
