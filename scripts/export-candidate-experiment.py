"""Copy one hash-bound candidate experiment bundle from the adjacent Python harness.

The harness owns every number, and this script computes none of its own. It checks that
the experiment file, its report and the registered attempt, reference and reference source
files belong together, has the harness aggregate the experiment once more and requires
report.json and report.md to equal the result byte for byte, copies the files byte for
byte and records their file hashes.
An empty attempt file, which a LIVE dispatch leaves when it produced no recording, is
copied as it is and counted apart from the recordings.
Run it after the harness has registered the attempts and written report.json and
report.md. The aggregation needs the harness's Python environment, so run it with the
harness's interpreter:

    ../contract-review-eval-harness/.venv/bin/python scripts/export-candidate-experiment.py [experiment-id]
    uv run --project ../contract-review-eval-harness python scripts/export-candidate-experiment.py [experiment-id]
"""
import hashlib
import json
import os
import re
import subprocess
import sys
from pathlib import Path

EXPERIMENT_SCHEMA = "mycounsel.candidate-experiment.v1"
REPORT_SCHEMA = "mycounsel.candidate-experiment-report.v1"
RECORDING_SCHEMA = "mycounsel.candidate-run.v1"
REFERENCE_SCHEMA = "mycounsel.candidate-reference.v1"
REPLAY_FIXTURE_MODEL = "hand-authored-replay-fixture"
# The code the harness writes in the report row of a dispatch that left no recording.
NO_RECORDING = "NO_RECORDING"
# Every module the aggregation runs through: the experiment itself, the scorer, the corpus
# and reference loaders, the re-derivation of adjudicated references and the spend ledger.
HARNESS_FILES = (
    "src/contract_eval/candidate_experiment.py",
    "src/contract_eval/candidates.py",
    "src/contract_eval/candidate_annotation.py",
    "src/contract_eval/candidate_adjudication.py",
    "src/contract_eval/candidate_budget.py",
)
RESERVED = {"experiment.json", "report.json", "provenance.json"}
SOURCE_ROLES = ("annotationA", "annotationB", "adjudication")
SOURCE_FILE = re.compile(r"references/sources/[A-Za-z0-9._-]+\.json")
INTEGER_KEY = re.compile(r"0|[1-9][0-9]*")
MAX_SAFE_INTEGER = 2**53 - 1


def check(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(f"Export refused: {message}")


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def browser_reproducible(value: object) -> bool:
    """True when JSON.stringify writes the same text as Python: safe integers, keys in file order."""
    if isinstance(value, bool) or value is None or isinstance(value, str):
        return True
    if isinstance(value, int):
        return abs(value) <= MAX_SAFE_INTEGER
    if isinstance(value, list):
        return all(browser_reproducible(item) for item in value)
    if isinstance(value, dict):
        # A browser lists integer-like keys first, whatever their place in the file.
        return all(INTEGER_KEY.fullmatch(key) is None and browser_reproducible(item) for key, item in value.items())
    return False


root = Path(__file__).resolve().parents[1]
harness = root.parent / "contract-review-eval-harness"
experiment_id = sys.argv[1] if len(sys.argv) > 1 else "replay-dry-run"
check(re.fullmatch(r"[a-z0-9][a-z0-9-]{2,63}", experiment_id) is not None, "the experiment id is not a valid id")
source = (harness / "candidates/mycounsel/experiments" / experiment_id).resolve()
check((source / "experiment.json").is_file() and (source / "report.json").is_file(),
      f"{source} has no experiment.json and report.json")


def bundled(relative: str) -> Path:
    """A registered file must sit inside the experiment directory under a plain relative path."""
    parts = relative.split("/")
    check(bool(relative) and "\\" not in relative and all(part not in ("", ".", "..") for part in parts)
          and relative not in RESERVED, f"{relative!r} is not a plain path inside the experiment directory")
    path = (source / relative).resolve()
    check(path.is_relative_to(source), f"{relative!r} leaves the experiment directory")
    return path


def design_of(design: dict) -> tuple:
    # The report is a full model dump; a hand-written experiment file may leave defaults out.
    return (design["mode"], design["playbooks"], design["variants"], design["repetitions"],
            design.get("injectionVariants", []), design.get("repairedEntries", {}))


def arm_of(arm: dict) -> tuple:
    return (arm["id"], arm["role"], arm["promptVersion"], arm["codeRevision"], arm["model"],
            arm.get("hypothesis"), arm.get("change"), arm.get("budgetReservation"))


experiment_bytes = (source / "experiment.json").read_bytes()
report_bytes = (source / "report.json").read_bytes()
experiment, report = json.loads(experiment_bytes), json.loads(report_bytes)

check(experiment["schema"] == EXPERIMENT_SCHEMA, "unknown experiment schema")
check(report["schema"] == REPORT_SCHEMA, "unknown report schema")
check(experiment["experimentId"] == experiment_id == report["experimentId"], "the experiment id does not match its directory")
check(report["experimentSha256"] == sha256(experiment_bytes), "report.json is bound to a different experiment.json")
check(report["corpusManifestSha256"] == experiment["corpusManifestSha256"], "the report names a different corpus")
# The file is published as it is, so it must not carry a path from this machine. A relative
# path can carry one too: enough ".." steps reach the home directory, and the directory names
# after them are local. Every step from the experiment directory therefore stays in the harness.
corpus_dir = experiment["corpusDir"]
check(isinstance(corpus_dir, str) and not Path(corpus_dir).is_absolute(),
      "corpusDir is an absolute local path; plan the experiment with a relative corpus path")
position = source
for part in Path(corpus_dir).parts:
    position = Path(os.path.normpath(position / part))
    check(position.is_relative_to(harness.resolve()),
          "corpusDir leaves the harness, so the published experiment file would name directories of this machine; "
          "keep the corpus inside the harness")
# The harness refuses to aggregate once the corpus has moved on. A report from before that
# point is no longer what the harness would write, so it is not exported either.
check((position / "manifest.json").is_file()
      and sha256((position / "manifest.json").read_bytes()) == experiment["corpusManifestSha256"],
      "the corpus manifest is missing or changed since the experiment was planned; plan, record and aggregate again in the harness")
# provenance.json records the hashes of these modules as the code behind the report. That is
# true when this code writes this report. The modules of this harness checkout therefore
# aggregate the experiment once more, and report.json and report.md must equal the result byte
# for byte, as the harness's own scripts/check_candidate_experiments.py requires. A file time
# shows nothing of the kind: a checkout sets it anew, and an edit after the aggregation need
# not change what the code writes.
sys.dont_write_bytecode = True  # The export writes nothing into the harness, not even bytecode.
sys.path.insert(0, str(harness / "src"))
try:
    if not (harness / "src" / "contract_eval").is_dir():
        # A copy of the package installed in this interpreter must not stand in for a
        # checkout that has none: the hashes recorded below are those of this checkout.
        raise ModuleNotFoundError("No module named 'contract_eval'")
    from contract_eval.candidate_experiment import aggregate, render_markdown
except Exception as error:  # Missing packages, or a Python too old for the harness: either way no check can run.
    check(False, f"this interpreter cannot import the harness's contract_eval modules ({type(error).__name__}: {error}), "
                 "so the report cannot be aggregated again and compared; run the export with the harness's interpreter, "
                 f"for example ../contract-review-eval-harness/.venv/bin/python scripts/export-candidate-experiment.py "
                 f"{experiment_id}, or uv run --project ../contract-review-eval-harness python "
                 f"scripts/export-candidate-experiment.py {experiment_id}")
try:
    aggregated = aggregate(source)
    current = {"report.json": (json.dumps(aggregated, indent=2, ensure_ascii=False) + "\n").encode("utf-8"),
               "report.md": render_markdown(aggregated).encode("utf-8")}
except Exception as error:
    check(False, f"the harness does not aggregate this experiment as it stands ({type(error).__name__}: {error}), "
                 "so its report cannot be confirmed; resolve this in the harness, aggregate, then export")
for name, written in current.items():
    check((source / name).is_file(), f"{name} is missing; aggregate in the harness, then export")
    check((source / name).read_bytes() == written,
          f"{name} is not what the harness modules of this checkout write for this experiment now, byte for byte, "
          "so their hashes would not describe the code that wrote the report; aggregate again in the harness, "
          "then export")
# The modules that just ran are the ones whose hashes are recorded: these five files of this
# checkout and no other module of the harness, a package's own __init__.py aside.
package = (harness / "src").resolve()
ran = {Path(module.__file__).resolve() for module in list(sys.modules.values()) if getattr(module, "__file__", None)}
ran = {path for path in ran if path.is_relative_to(package) and path.name != "__init__.py"}
recorded = {(harness / name).resolve() for name in HARNESS_FILES}
check(ran == recorded,
      "the aggregation did not run through exactly the harness modules whose hashes this export records; it differs in "
      + ", ".join(sorted(path.relative_to(harness.resolve()).as_posix() for path in ran ^ recorded))
      + "; either HARNESS_FILES no longer lists the harness's modules, or this interpreter loaded contract_eval "
        "from another place than the src folder of this checkout")
check(design_of(report["design"]) == design_of(experiment["design"])
      and [arm_of(arm) for arm in report["arms"]] == [arm_of(arm) for arm in experiment["arms"]],
      "the report states a different design or different arms than the experiment file")
# The viewer receives parsed JSON from its bundler and rebuilds the file text to recompute
# the hash above. That only works for the exact form the harness writes.
check(browser_reproducible(experiment)
      and (json.dumps(experiment, indent=2, ensure_ascii=False) + "\n").encode("utf-8") == experiment_bytes,
      "experiment.json is not in the harness's two-space JSON form, so the viewer could not reproduce its bytes")

mode = experiment["design"]["mode"]
check(mode in ("REPLAY", "LIVE"), "unknown design mode")
ledger = report["ledger"]
if mode == "REPLAY":
    check(all(arm["model"] == REPLAY_FIXTURE_MODEL for arm in experiment["arms"]),
          "a REPLAY arm is not the hand-authored fixture the viewer describes")
    # A REPLAY experiment reserves nothing. The viewer says so, and that no model was called.
    check(ledger is None and all(arm.get("budgetReservation") is None for arm in experiment["arms"]),
          "a REPLAY experiment carries a ledger block or a budget reservation")
else:
    check(isinstance(ledger, dict) and list(ledger) == [arm["id"] for arm in experiment["arms"]],
          "the ledger block of the report does not name exactly the arms of the experiment")
    for arm in experiment["arms"]:
        bound, state = arm.get("budgetReservation"), ledger[arm["id"]]
        check((bound is None) == (state is None) and (state is None or (
            state["reservation"], state["reservedMinorUnits"], state["reservedAt"]) == (
            bound["ledgerEntryId"], bound["amountMinorUnits"], bound["recordedAt"])),
              f"the ledger state of arm {arm['id']} is not the reservation the experiment file binds to it")

slots = {attempt["file"]: attempt for attempt in experiment["attempts"]}
check(len(slots) == len(experiment["attempts"]), "two attempt slots share a file")
registered = {file: slot for file, slot in slots.items() if slot.get("sha256") is not None}
rows = {}
for cell in report["cells"]:
    for row in cell["attempts"]:
        check(row["file"] not in rows, f"the report lists {row['file']} twice")
        rows[row["file"]] = (cell, row)
check(set(rows) == set(registered), "the report's attempts are not exactly the registered attempt files")
check(report["notRun"] == [file for file in slots if file not in registered],
      "the report's attempts not run are not exactly the unregistered slots")
for file in set(slots) - set(registered):
    check(not bundled(file).exists(), f"{file} exists but is not registered; register and aggregate in the harness first")

copies: dict[str, bytes] = {"experiment.json": experiment_bytes, "report.json": report_bytes}
without_recording = []
for file, slot in registered.items():
    path = bundled(file)
    check(path.is_file(), f"registered attempt {file} is missing")
    data = path.read_bytes()
    check(sha256(data) == slot["sha256"], f"registered attempt {file} has changed on disk")
    cell, row = rows[file]
    check((cell["arm"], cell["playbook"], cell["variant"], row["repetition"])
          == (slot["arm"], slot["playbook"], slot["variant"], slot["repetition"]),
          f"the report lists {file} outside the slot the experiment assigns to it")
    if not data:
        # The recorder creates a slot empty before its call and fills it afterwards. The harness
        # registers an empty slot file as a dispatch that left no recording. It is copied as it
        # is, zero bytes under its registered hash, and counted apart from the recordings.
        check(mode == "LIVE", f"{file} is empty; only a LIVE dispatch leaves an empty slot")
        check((row["recordingSha256"], row["findingsSha256"], row["startedAt"], row["elapsedMs"], row["usage"]) == (None,) * 5
              and (row["outcome"], row["recorderValidation"], row["recorderValidationError"], row["findingCount"])
              == ("FAILED", "NO_OUTPUT", NO_RECORDING, 0),
              f"{file} is empty, but the report does not list it as a dispatch that left no recording")
        copies[file] = data
        without_recording.append(file)
        continue
    recording = json.loads(data)
    check(recording["schema"] == RECORDING_SCHEMA, f"{file} has an unknown recording schema")
    check(recording["corpusKind"] == "SYNTHETIC", f"{file} is not a synthetic recording")
    check(recording["run"]["mode"] == mode, f"{file} ran in {recording['run']['mode']}, the design is {mode}")
    canonical = json.dumps(recording, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    check(sha256(canonical.encode("utf-8")) == row["recordingSha256"],
          f"{file} does not have the canonical recording digest its report row states")
    copies[file] = data

reference_cells, source_files = set(), []
for reference_slot in experiment.get("references", []):
    file, key = reference_slot["file"], f"{reference_slot['playbook']}/{reference_slot['variant']}"
    check(file not in copies, f"{file} is registered twice")
    path = bundled(file)
    check(path.is_file(), f"registered reference {file} is missing")
    data = path.read_bytes()
    check(sha256(data) == reference_slot["sha256"], f"reference {file} does not match its registered hash")
    reference = json.loads(data)
    stated = report["references"].get(key)
    compiled = reference.get("provenance") or {}
    sources = reference_slot.get("sources")
    check(reference["schema"] == REFERENCE_SCHEMA, f"{file} has an unknown reference schema")
    # The viewer holds a bundled reference to its registered hash and, like the experiment file, has to
    # rebuild the file text from parsed JSON. Both reference compilers of the harness write this form.
    check(browser_reproducible(reference)
          and (json.dumps(reference, indent=2, ensure_ascii=False) + "\n").encode("utf-8") == data,
          f"reference {file} is not in the harness's two-space JSON form, so the viewer could not reproduce its bytes; "
          "write it with the harness's reference compiler and register it in a new experiment")
    check(stated is not None and stated["file"] == file and stated["sha256"] == reference_slot["sha256"]
          and stated["status"] == reference["status"]
          and stated["expectedIssues"] == len(reference["issues"])
          and stated["reviewerEvidence"] == reference["reviewerEvidence"]
          and stated["route"] == compiled.get("route")
          and stated["lowConfidenceIssues"] == compiled.get("lowConfidenceIssues")
          and stated["uncertaintiesRecorded"] == compiled.get("uncertaintiesRecorded"),
          f"the report does not describe reference {file}")
    # The harness re-derives a reference exactly when its source files are registered, and
    # it never verifies who a reviewer is.
    check(stated["derivationVerified"] is (sources is not None) and stated["independentReviewClaimVerified"] is False,
          f"the report claims a derivation or a verified review for reference {file} that the harness does not establish")
    reference_cells.add(key)
    copies[file] = data
    if sources is not None:
        check(sorted(sources) == sorted(SOURCE_ROLES), f"reference {file} does not name its two annotations and its adjudication record")
        for role in SOURCE_ROLES:
            source_file = sources[role]["file"]
            check(SOURCE_FILE.fullmatch(source_file) is not None and source_file not in copies,
                  f"{source_file!r} is not a source file of exactly one reference under references/sources")
            source_path = bundled(source_file)
            check(source_path.is_file() and sha256(source_path.read_bytes()) == sources[role]["sha256"],
                  f"source file {source_file} of reference {file} is missing or does not match its registered hash")
            copies[source_file] = source_path.read_bytes()
            source_files.append(source_file)
check(set(report["references"]) == reference_cells, "the report names a reference the experiment does not register")

# Every copied file is published as it is. None of them may name a directory of this machine:
# the home directory or the harness checkout. A home directory of "/" names nothing and is skipped.
for local in {str(Path.home()), str(harness.resolve())}:
    for name, data in copies.items():
        check(len(Path(local).parts) < 2 or local.encode("utf-8") not in data, f"{name} names a directory of this machine")

destination = root / "public/candidates/experiments" / experiment_id
if destination.exists():
    stale = sorted(path.relative_to(destination).as_posix() for path in destination.rglob("*")
                   if path.is_file() and not path.name.startswith(".")
                   and path.relative_to(destination).as_posix() not in copies.keys() | {"provenance.json"})
    check(not stale, f"{destination} holds files outside this bundle; remove them first: {', '.join(stale)}")


def git(*arguments: str) -> str:
    # --no-optional-locks keeps this read-only: git status would otherwise refresh the index.
    return subprocess.run(["git", "--no-optional-locks", "-C", str(harness), *arguments],
                          check=True, capture_output=True, text=True).stdout.strip()


head = git("rev-parse", "HEAD")
check(re.fullmatch(r"[a-f0-9]{40}", head) is not None, "the harness HEAD is not a commit hash")
missing = len(slots) - len(registered)
recorded = len(registered) - len(without_recording)
scope = (
    f"One preregistered {mode} experiment over the synthetic My Counsel corpus: {recorded} recorded attempt "
    f"file(s) copied, "
    # Stated only where it applies, and never counted as a recording.
    + (f"{len(without_recording)} empty slot file(s) copied for dispatches that left no recording, "
       if without_recording else "")
    + f"{missing} planned attempt file(s) not run, {len(reference_cells)} reference file(s), "
    f"{len(source_files)} annotation or adjudication source file(s). "
    + ("The recorded attempts are hand-authored fixtures; no model was called and no model result is claimed. "
       if mode == "REPLAY" else
       "The recorded attempts are retained model outputs from a small sample; matching is a rule and anchor "
       "proxy and no legal-quality claim is made. ")
    + "A file hash binds bytes; it is not an independent attestation."
)
provenance = {
    "schema": "evidence-lab.candidate-experiment-bundle.v1",
    "experimentId": experiment_id,
    "origin": f"contract-review-eval-harness/candidates/mycounsel/experiments/{experiment_id}",
    "harnessHead": head,
    # True when the harness had uncommitted or untracked files: the commit alone does not
    # identify the code that wrote the report, which is why the module hashes follow.
    "harnessWorkingTreeDirty": bool(git("status", "--porcelain")),
    "harnessFiles": {name: sha256((harness / name).read_bytes()) for name in HARNESS_FILES},
    "files": {name: sha256(data) for name, data in sorted(copies.items())},
    "scope": scope,
}

for name, data in copies.items():
    target = destination / name
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)
(destination / "provenance.json").write_text(json.dumps(provenance, indent=2) + "\n", encoding="utf-8")
print(f"Copied experiment {experiment_id}: {recorded} recorded attempt file(s), {len(without_recording)} empty slot "
      f"file(s) of dispatches that left no recording, {len(reference_cells)} reference file(s), {len(source_files)} "
      f"reference source file(s), experiment.json, report.json and provenance.json to {destination.relative_to(root)}.")
if without_recording:
    print("Notice: an empty slot file is no recording and cannot be imported as JSON. Do not import it in the page; "
          "the viewer shows its report row as a dispatch without a recording: " + ", ".join(without_recording))
if source_files:
    print("Notice: annotation and adjudication files carry the names or labels their authors wrote. They are now "
          "in the public directory; read them before the site is deployed: " + ", ".join(source_files))
