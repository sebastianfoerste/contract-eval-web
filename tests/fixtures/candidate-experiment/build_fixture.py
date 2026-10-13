"""Build the two synthetic experiment bundles the viewer tests verify.

The Python harness produces every file: this script only calls its functions, in the order
an operator would, against a temporary copy of candidates/mycounsel. For each bundle it plans
a LIVE-shaped experiment, compiles DRAFT references from synthetic annotations, reserves and
settles a budget in a copy of the spend ledger, derives recordings from the hand-authored
replay, registers them together with the ledger and lets the harness aggregate the report.

synthetic-live-fixture holds two arms with references, comparisons, an injection cell and a
repairing variant. synthetic-lost-dispatch-fixture holds one settled arm in which three slot
files are empty, as the recorder leaves a slot whose dispatch produced no recording, and two
completed attempts that both returned nothing.

Nothing here is a model result. No model is called, no call is dispatched, no money is
reserved or spent, the price row is invented, and every annotation, rationale, hypothesis
and finding is test text.

Run it with the harness interpreter, without writing bytecode into the harness:

    ../contract-review-eval-harness/.venv/bin/python -B tests/fixtures/candidate-experiment/build_fixture.py \
        --harness ../contract-review-eval-harness --work "$TMPDIR/candidate-experiment-fixture" \
        --out "$TMPDIR/candidate-experiment-fixture/out"

The output directory then holds one folder per bundle. Replace the two folders of the same
names under tests/fixtures/candidate-experiment with them.
"""
import argparse
import hashlib
import json
import shutil
import subprocess
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path

import contract_eval
from contract_eval.candidate_annotation import Annotation, compile_reference, corpus_bindings, load_corpus
from contract_eval.candidate_budget import Price, load_ledger, save_ledger, set_price
from contract_eval.candidate_experiment import (
    Arm, Design, add_iteration, add_reference, aggregate, create_experiment, load_experiment, plan_experiment,
    register, render_markdown, reserve_arm, save_experiment, settle_arm,
)
from contract_eval.candidates import CandidateRun, anchor_id, document_paragraphs

EXPERIMENT_ID = "synthetic-live-fixture"
LOST_EXPERIMENT_ID = "synthetic-lost-dispatch-fixture"
MODEL = "synthetic-fixture-not-a-model"
PROMPT = "contracts/candidates/2026-09-11"
NEXT_PROMPT = "contracts/candidates/synthetic-fixture-iteration"
REVISION = "041d0157c364f0919ba5227c7159c3d6906507c4"
NOTES = ("Synthetic test fixture for the Evidence Lab viewer tests. Every recording is derived from the "
         "hand-authored replay. No model was called and no money was spent. Not a model result.")
LOST_NOTES = ("Synthetic test fixture for the Evidence Lab viewer tests. Three slot files were written empty to "
              "stand for dispatches that left no recording; the three recordings are derived from the "
              "hand-authored replay. No model was called, no call was dispatched and no money was spent. "
              "Not a model result.")
SCOPE = ("Synthetic test fixture for the Evidence Lab viewer tests: a LIVE-shaped experiment that the harness "
         "aggregated from recordings derived from the hand-authored replay. No model was called, no money was "
         "reserved or spent, and nothing here is a model result. A file hash binds bytes; it is not an "
         "independent attestation.")
LOST_SCOPE = ("Synthetic test fixture for the Evidence Lab viewer tests: a LIVE-shaped experiment that the harness "
              "aggregated from three recordings derived from the hand-authored replay and three slot files written "
              "empty to stand for dispatches that left no recording. No model was called, no call was dispatched, "
              "no money was reserved or spent, and nothing here is a model result. A file hash binds bytes; it is "
              "not an independent attestation.")
HARNESS_FILES = (
    "src/contract_eval/candidate_experiment.py",
    "src/contract_eval/candidates.py",
    "src/contract_eval/candidate_annotation.py",
    "src/contract_eval/candidate_adjudication.py",
    "src/contract_eval/candidate_budget.py",
)
CATEGORY = {
    "COM-FEES": "NEGOTIATED_PREFERENCE", "COM-SLA": "COMMERCIAL_RISK", "COM-SUSPENSION": "COMMERCIAL_RISK",
    "COM-EXIT": "NEGOTIATED_PREFERENCE", "DORA-LOCATIONS": "STATUTORY_REQUIREMENT",
    "DORA-AUDIT": "STATUTORY_REQUIREMENT", "DORA-EXIT": "STATUTORY_REQUIREMENT",
}
# Expected issues per cell as (playbook entry, paragraph); no paragraph means a missing clause.
# commercial/changed expects nothing, so its recall has no denominator.
EXPECTED = {
    ("commercial", "base"): [("COM-FEES", 2), ("COM-SLA", 4), ("COM-EXIT", None)],
    ("commercial", "changed"): [],
    ("commercial", "injection"): [("COM-FEES", 2), ("COM-SLA", 4), ("COM-EXIT", None)],
    ("dora", "base"): [("DORA-LOCATIONS", 5), ("DORA-AUDIT", 8), ("DORA-EXIT", None)],
    ("dora", "changed"): [("DORA-AUDIT", 8), ("DORA-EXIT", None)],
    ("dora", "injection"): [("DORA-LOCATIONS", 5), ("DORA-AUDIT", 8)],
}
LOW_CONFIDENCE = {("commercial", "base"): ("COM-SLA",)}
DOUBTS = {("commercial", "base"): "Synthetic test doubt about the availability clause; not a legal view."}
# An empty slot file. The recorder creates a slot empty before its call and fills it afterwards.
# The harness binds an empty file as a dispatch that left no recording once the operator names it.
NO_RECORDING = ""


def sha(value: bytes | str) -> str:
    return hashlib.sha256(value.encode("utf-8") if isinstance(value, str) else value).hexdigest()


def dump(value: object) -> str:
    return json.dumps(value, indent=2, ensure_ascii=False) + "\n"


def at(hour: int, minute: int = 0) -> datetime:
    return datetime(2026, 10, 12, hour, minute, 0, tzinfo=timezone.utc)


parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
parser.add_argument("--harness", type=Path, required=True)
parser.add_argument("--work", type=Path, required=True, help="scratch directory; it is replaced")
parser.add_argument("--out", type=Path, required=True, help="where the two bundles are written; it must not exist")
args = parser.parse_args()
harness = args.harness.resolve()
if not Path(contract_eval.__file__).resolve().is_relative_to(harness / "src"):
    raise SystemExit(f"this interpreter imports contract_eval from {contract_eval.__file__}, not from {harness}")
if args.out.exists():
    raise SystemExit(f"{args.out} exists; a fixture is built into a new directory")

# The corpus keeps its place relative to an experiment directory, so corpusDir stays "../..".
if args.work.exists():
    shutil.rmtree(args.work)
corpus = args.work / "contract-review-eval-harness" / "candidates" / "mycounsel"
shutil.copytree(harness / "candidates" / "mycounsel", corpus, ignore=shutil.ignore_patterns(
    "annotation-pack", "annotation-bundle", "experiments", "__pycache__", ".DS_Store"))
replay = (corpus / "replay-run.json").read_text(encoding="utf-8")
manifest = load_corpus(corpus)
bindings = corpus_bindings(corpus)

SOURCE = {}
for variant in ("base", "changed", "injection"):
    document = manifest.document(variant)
    paragraphs = document_paragraphs((corpus / document.filename).read_bytes())
    SOURCE[variant] = {"sha256": document.sha256, "filename": document.filename, "clauses": [
        {"id": anchor_id(document.sha256, number, text), "paragraph": number, "text": text, "editable": True}
        for number, text in enumerate(paragraphs)]}


def finding(entry: str, paragraph: int, variant: str, **changes) -> dict:
    """A located finding that quotes its whole paragraph under the entry's own category."""
    clause = SOURCE[variant]["clauses"][paragraph]
    return {"anchorId": clause["id"], "insertionAnchorId": None, "quote": clause["text"], "missingClause": False,
            "category": CATEGORY.get(entry, "NEGOTIATED_PREFERENCE"),
            "explanation": "Synthetic test finding, derived from the hand-authored replay. Not a model output.",
            "proposedAmendment": "", "playbookReference": entry} | changes


def missing(entry: str, variant: str) -> dict:
    """A missing-clause finding that names the last numbered paragraph as its place of insertion."""
    return {"anchorId": None, "insertionAnchorId": SOURCE[variant]["clauses"][12]["id"], "quote": "",
            "missingClause": True, "category": CATEGORY[entry],
            "explanation": "Synthetic test finding, derived from the hand-authored replay. Not a model output.",
            "proposedAmendment": "", "playbookReference": entry}


def recording(arm: Arm, playbook: str, variant: str, hour: int, minute: int, findings=(), *,
              outcome: str = "COMPLETED", verdict: str = "ACCEPTED", error: str | None = None,
              usage: tuple[int, int] | None = None) -> dict:
    """One recording for a slot, derived from the committed replay and validated by the harness."""
    data = json.loads(replay)
    book = (corpus / f"{playbook}.json").read_text(encoding="utf-8")
    data["source"] = deepcopy(SOURCE[variant])
    data["playbook"] = {"sha256": sha(book), "instructions": book}
    data["run"].update(mode="LIVE", model=arm.model, promptVersion=arm.promptVersion, codeRevision=arm.codeRevision,
                       workingTreeDirty=False, startedAt=f"2026-10-12T{hour:02d}:{minute:02d}:00.000Z",
                       elapsedMs=1000 + 100 * minute, outcome=outcome)
    if usage is None:
        data["run"].update(usage=None, usageUnavailableReason="Synthetic test attempt: no provider usage is recorded.")
    else:
        data["run"].update(usageUnavailableReason=None, usage={
            "inputTokens": usage[0], "outputTokens": usage[1], "cacheReadTokens": None, "thinkingTokens": None,
            "providerRequestId": f"synthetic-request-{arm.id}-{playbook}-{variant}-{minute:02d}"})
    if outcome == "COMPLETED":
        data["findings"] = list(findings)
        data["validation"] = {"status": verdict, "errorCode": error if verdict == "REJECTED" else None}
    else:
        data["findings"] = None
        data["validation"] = {"status": "NO_OUTPUT", "errorCode": "SYNTHETIC_TEST_NO_OUTPUT"}
    CandidateRun.model_validate(data)
    return data


def slot(arm: Arm, playbook: str, variant: str, repetition: int) -> str:
    return f"attempts/{arm.id}/{playbook}-{variant}-r{repetition}.json"


# The ledger copy gets an invented price row for a model name that names no model. Both
# experiments reserve in this one copy, in time order, as two experiments of one portfolio would.
ledger_path = corpus / "spend-ledger.json"
ledger = load_ledger(ledger_path)
set_price(ledger, Price(
    model=MODEL, provider="synthetic-provider", region="eu", currency="EUR", listCurrency="EUR",
    inputMinorUnitsPerMillionTokens=300, outputMinorUnitsPerMillionTokens=1500, verifiedOn="2026-10-10",
    sourceUrl="https://example.invalid/synthetic-test-price"))
save_ledger(ledger, ledger_path)


def plan(experiment_id: str, design: Design, arm: Arm, notes: str) -> Path:
    """The preregistration: baseline arm only, as planned before anything runs."""
    directory = corpus / "experiments" / experiment_id
    planned = plan_experiment(corpus, experiment_id=experiment_id, design=design, arms=[arm], corpus_ref="../..")
    create_experiment(planned.model_copy(update={"notes": notes}), directory)
    return directory


def refer(directory: Path, playbook: str, variant: str, *, saw_model_output: bool = False) -> None:
    """One DRAFT reference for a cell, compiled by the harness from a synthetic annotation."""
    raw = dump({
        "schema": "mycounsel.candidate-annotation.v1", "variant": variant, "playbook": playbook,
        "documentSha256": manifest.document(variant).sha256, "playbookSha256": manifest.playbooks[playbook],
        **bindings,
        "annotator": "Synthetic test annotator (no person)", "annotatedOn": "2026-10-12",
        "sawModelOutput": saw_model_output,
        "issues": [{"playbookReference": entry, "paragraph": paragraph, "missingClause": paragraph is None,
                    "rationale": f"Synthetic test rationale for {entry}; not a legal view.",
                    "confidence": "LOW" if entry in LOW_CONFIDENCE.get((playbook, variant), ()) else "HIGH"}
                   for entry, paragraph in EXPECTED[(playbook, variant)]],
        "uncertainties": DOUBTS.get((playbook, variant), ""),
    })
    reference = compile_reference(Annotation.model_validate_json(raw), corpus, annotation_sha256=sha(raw))
    path = directory / "references" / f"{playbook}-{variant}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(dump(reference), encoding="utf-8")
    save_experiment(add_reference(load_experiment(directory), directory, playbook=playbook, variant=variant), directory)


def reserve(directory: Path, arm: Arm, entry_id: str, when: datetime) -> None:
    experiment = load_experiment(directory)
    reserve_arm(experiment, directory, ledger, arm_id=arm.id, entry_id=entry_id,
                provider="synthetic-provider", region="eu", max_input_tokens=6000, max_output_tokens=12096,
                retry_multiplier=2, now=when)
    save_ledger(ledger, ledger_path)
    save_experiment(experiment, directory)


def record(directory: Path, files: dict[str, dict | str]) -> None:
    """Write recordings into their slots and register them with the ledger, as the operator does after a run."""
    for relative, data in files.items():
        path = directory / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(data if isinstance(data, str) else dump(data), encoding="utf-8")
    experiment = load_experiment(directory)
    # The harness binds an empty slot only when the operator names it: the file cannot tell a call that
    # ended without a recording from one that is still out. Here every empty slot stands for the former.
    lost = [relative for relative, data in files.items() if data == NO_RECORDING]
    if register(experiment, directory, ledger, lost=lost) != len(files):
        raise SystemExit("the harness did not register every new slot file")
    save_experiment(experiment, directory)


def settle(directory: Path, arm: Arm, settlement_id: str, when: datetime) -> None:
    settle_arm(directory, ledger, arm_id=arm.id, settlement_id=settlement_id, now=when)
    save_ledger(ledger, ledger_path)


def git(*arguments: str) -> str:
    return subprocess.run(["git", "--no-optional-locks", "-C", str(harness), *arguments],
                          check=True, capture_output=True, text=True).stdout.strip()


def bundle(directory: Path, experiment_id: str, scope: str) -> int:
    """Let the harness aggregate, then copy the experiment's files as the exporter would."""
    # The report is written exactly as the harness's command line writes it.
    report = aggregate(directory, ledger)
    (directory / "report.json").write_text(dump(report), encoding="utf-8")
    experiment = json.loads((directory / "experiment.json").read_text(encoding="utf-8"))
    copies = {"experiment.json": (directory / "experiment.json").read_bytes(),
              "report.json": (directory / "report.json").read_bytes()}
    for attempt in experiment["attempts"]:
        if attempt["sha256"] is not None:
            # An empty slot file is copied as it is: zero bytes under its registered hash.
            copies[attempt["file"]] = (directory / attempt["file"]).read_bytes()
    for reference in experiment["references"]:
        copies[reference["file"]] = (directory / reference["file"]).read_bytes()
    provenance = {
        "schema": "evidence-lab.candidate-experiment-bundle.v1",
        "experimentId": experiment_id,
        "origin": "tests/fixtures/candidate-experiment/build_fixture.py, run against a temporary copy of "
                  "contract-review-eval-harness/candidates/mycounsel",
        "harnessHead": git("rev-parse", "HEAD"),
        "harnessWorkingTreeDirty": bool(git("status", "--porcelain")),
        "harnessFiles": {name: sha((harness / name).read_bytes()) for name in HARNESS_FILES},
        "files": {name: sha(data) for name, data in sorted(copies.items())},
        "scope": scope,
    }
    for name, data in copies.items():
        target = args.out / experiment_id / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
    (args.out / experiment_id / "provenance.json").write_text(json.dumps(provenance, indent=2) + "\n", encoding="utf-8")
    print(render_markdown(report), end="")
    return len(copies) + 1


# ---------------------------------------------------------------------------------------------
# synthetic-live-fixture: two arms, references, comparisons, an injection cell, a repairing variant.
# ---------------------------------------------------------------------------------------------
baseline = Arm(id="baseline", role="BASELINE", promptVersion=PROMPT, codeRevision=REVISION, model=MODEL)
iteration = Arm(id="iteration", role="ITERATION", promptVersion=NEXT_PROMPT, codeRevision=REVISION, model=MODEL,
                change="Synthetic test change: the prompt names the playbook entry before the clause.",
                hypothesis="Synthetic test hypothesis: fewer findings cite an entry the playbook does not hold.")
directory = plan(EXPERIMENT_ID, Design(
    mode="LIVE", playbooks=["commercial", "dora"], variants=["base", "changed", "injection"], repetitions=2,
    injectionVariants=["injection"], repairedEntries={"changed": ["DORA-LOCATIONS"]}), baseline, NOTES)
for playbook, variant in EXPECTED:
    refer(directory, playbook, variant)

# The baseline arm: reserved at 09:00, eleven attempts from 10:01, one slot never run, settled at 12:00.
reserve(directory, baseline, "res-synthetic-baseline", at(9))
stale = [finding("DORA-LOCATIONS", 5, "changed"), finding("DORA-AUDIT", 8, "changed")]
record(directory, {
    # Rejected by the recorder: a repeated finding and an entry the playbook does not hold.
    slot(baseline, "commercial", "base", 1): recording(
        baseline, "commercial", "base", 10, 1,
        [finding("COM-FEES", 2, "base"), finding("COM-FEES", 2, "base"), finding("UNSUPPORTED-ENTRY", 2, "base"),
         missing("COM-EXIT", "base")],
        verdict="REJECTED", error="CONTRACT_PLAYBOOK_REFERENCE", usage=(1000, 200)),
    # Every finding valid, one of them on an eight-character quotation.
    slot(baseline, "commercial", "base", 2): recording(
        baseline, "commercial", "base", 10, 2,
        [finding("COM-SLA", 4, "base"), finding("COM-FEES", 2, "base", quote="2. Fees.")], usage=(1300, 450)),
    # Completed without a finding against a reference that expects none: no rate has a denominator.
    slot(baseline, "commercial", "changed", 1): recording(baseline, "commercial", "changed", 10, 3, usage=(1200, 15)),
    slot(baseline, "commercial", "changed", 2): recording(baseline, "commercial", "changed", 10, 10, outcome="FAILED"),
    # Followed the injected instruction: completed without a finding.
    slot(baseline, "commercial", "injection", 1): recording(
        baseline, "commercial", "injection", 10, 4, usage=(1400, 20)),
    # Resisted it, and anchored one finding on the injected paragraph.
    slot(baseline, "commercial", "injection", 2): recording(
        baseline, "commercial", "injection", 10, 5,
        [finding("COM-FEES", 2, "injection"), finding("COM-SLA", 13, "injection")], usage=(1400, 380)),
    slot(baseline, "dora", "base", 1): recording(baseline, "dora", "base", 10, 6, outcome="REFUSED"),
    # Every finding valid, yet rejected by the recorder: a validation disagreement.
    slot(baseline, "dora", "base", 2): recording(
        baseline, "dora", "base", 10, 7,
        [finding("DORA-LOCATIONS", 5, "base"), finding("DORA-AUDIT", 8, "base"), missing("DORA-EXIT", "base")],
        verdict="REJECTED", error="SYNTHETIC_TEST_REJECTION", usage=(1500, 520)),
    # Both repetitions still cite the repaired entry and return identical findings.
    slot(baseline, "dora", "changed", 1): recording(baseline, "dora", "changed", 10, 8, stale, usage=(1500, 400)),
    slot(baseline, "dora", "changed", 2): recording(baseline, "dora", "changed", 10, 9, stale, usage=(1500, 410)),
    # The only observation of this cell in either arm produced no output, so the cell is not compared.
    slot(baseline, "dora", "injection", 1): recording(baseline, "dora", "injection", 10, 11, outcome="FAILED"),
})
settle(directory, baseline, "set-synthetic-baseline", at(12))

# The iteration arm: declared and reserved after the baseline ran, six attempts from 13:01, left open.
save_experiment(add_iteration(load_experiment(directory), directory, iteration), directory)
reserve(directory, iteration, "res-synthetic-iteration", at(12, 30))
record(directory, {
    slot(iteration, "commercial", "base", 1): recording(
        iteration, "commercial", "base", 13, 1,
        [finding("COM-FEES", 2, "base"), finding("COM-SLA", 4, "base"), missing("COM-EXIT", "base")],
        usage=(1100, 300)),
    slot(iteration, "commercial", "base", 2): recording(
        iteration, "commercial", "base", 13, 2,
        [finding("COM-FEES", 2, "base"), finding("COM-SLA", 4, "base")], usage=(1100, 260)),
    # One finding against a reference that expects none: precision 0 of 1, recall without a denominator.
    slot(iteration, "commercial", "changed", 1): recording(
        iteration, "commercial", "changed", 13, 3, [finding("COM-FEES", 2, "changed")], usage=(1200, 150)),
    slot(iteration, "commercial", "injection", 1): recording(
        iteration, "commercial", "injection", 13, 4,
        [finding("COM-FEES", 2, "injection"), finding("COM-SLA", 4, "injection"), missing("COM-EXIT", "injection")],
        usage=(1400, 310)),
    slot(iteration, "dora", "base", 1): recording(
        iteration, "dora", "base", 13, 5,
        [finding("DORA-LOCATIONS", 5, "base"), finding("DORA-AUDIT", 8, "base")]),
    slot(iteration, "dora", "changed", 1): recording(
        iteration, "dora", "changed", 13, 6,
        [finding("DORA-AUDIT", 8, "changed"), missing("DORA-EXIT", "changed")], usage=(1500, 330)),
})
written = bundle(directory, EXPERIMENT_ID, SCOPE)
print(f"\nWrote {written} files to {args.out / EXPERIMENT_ID}.\n")

# ---------------------------------------------------------------------------------------------
# synthetic-lost-dispatch-fixture: one arm, every slot dispatched, three dispatches without a recording.
# ---------------------------------------------------------------------------------------------
lost_arm = Arm(id="baseline", role="BASELINE", promptVersion=PROMPT, codeRevision=REVISION, model=MODEL)
directory = plan(LOST_EXPERIMENT_ID, Design(
    mode="LIVE", playbooks=["dora"], variants=["base", "changed", "injection"], repetitions=2,
    injectionVariants=["injection"], repairedEntries={"changed": ["DORA-LOCATIONS"]}), lost_arm, LOST_NOTES)
refer(directory, "dora", "base")
refer(directory, "dora", "changed")
# This annotation states that its author had seen model output, so the report carries that caveat.
refer(directory, "dora", "injection", saw_model_output=True)

# Reserved at 14:00, six dispatches from 15:01, settled at 16:00. Each empty slot costs its full hold.
reserve(directory, lost_arm, "res-synthetic-lost-dispatch", at(14))
record(directory, {
    # One dispatch without a recording beside a completed attempt: the cell misses three issues once.
    slot(lost_arm, "dora", "base", 1): NO_RECORDING,
    slot(lost_arm, "dora", "base", 2): recording(
        lost_arm, "dora", "base", 15, 2,
        [finding("DORA-LOCATIONS", 5, "base"), finding("DORA-AUDIT", 8, "base")], usage=(2000, 3000)),
    # Two dispatches without a recording in one cell: two attempts, not one recording filed twice.
    slot(lost_arm, "dora", "changed", 1): NO_RECORDING,
    slot(lost_arm, "dora", "changed", 2): NO_RECORDING,
    # Two completed attempts that both returned nothing: not the same findings twice.
    slot(lost_arm, "dora", "injection", 1): recording(lost_arm, "dora", "injection", 15, 5, usage=(1400, 20)),
    slot(lost_arm, "dora", "injection", 2): recording(lost_arm, "dora", "injection", 15, 6),
})
settle(directory, lost_arm, "set-synthetic-lost-dispatch", at(16))
written = bundle(directory, LOST_EXPERIMENT_ID, LOST_SCOPE)
print(f"\nWrote {written} files to {args.out / LOST_EXPERIMENT_ID}.")
