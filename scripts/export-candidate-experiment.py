"""Copy one hash-bound candidate experiment bundle from the adjacent Python harness.

The harness owns every number. Nothing is scored or aggregated here: the script checks
that the experiment file, its report and the registered attempt and reference files
belong together, copies them byte for byte and records their file hashes. Run it after
the harness has registered the attempts and written report.json.

    python3 scripts/export-candidate-experiment.py [experiment-id]
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
HARNESS_FILES = ("src/contract_eval/candidate_experiment.py", "src/contract_eval/candidates.py")
RESERVED = {"experiment.json", "report.json", "provenance.json"}
MAX_SAFE_INTEGER = 2**53 - 1


def check(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(f"Export refused: {message}")


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def browser_reproducible(value: object) -> bool:
    """True when JSON.stringify writes the same number text as Python: safe integers only."""
    if isinstance(value, bool) or value is None or isinstance(value, str):
        return True
    if isinstance(value, int):
        return abs(value) <= MAX_SAFE_INTEGER
    if isinstance(value, list):
        return all(browser_reproducible(item) for item in value)
    if isinstance(value, dict):
        return all(browser_reproducible(item) for item in value.values())
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
            design.get("injectionVariants", []))


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
# only true while neither file changed after report.json was written.
for name in HARNESS_FILES:
    check((harness / name).is_file() and (harness / name).stat().st_mtime_ns <= (source / "report.json").stat().st_mtime_ns,
          f"{name} is missing or changed after report.json was written, so its hash would not describe the code "
          "that wrote the report; aggregate again in the harness, then export")
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
if mode == "REPLAY":
    check(all(arm["model"] == REPLAY_FIXTURE_MODEL for arm in experiment["arms"]),
          "a REPLAY arm is not the hand-authored fixture the viewer describes")

slots = {attempt["file"]: attempt for attempt in experiment["attempts"]}
check(len(slots) == len(experiment["attempts"]), "two attempt slots share a file")
registered = {file: slot for file, slot in slots.items() if slot.get("sha256") is not None}
rows = {}
for cell in report["cells"]:
    for row in cell["attempts"]:
        check(row["file"] not in rows, f"the report lists {row['file']} twice")
        rows[row["file"]] = (cell, row)
check(set(rows) == set(registered), "the report's attempts are not exactly the registered attempt files")
check(set(report["missingAttemptFiles"]) == set(slots) - set(registered),
      "the report's missing attempt files are not exactly the unregistered slots")
for file in set(slots) - set(registered):
    check(not bundled(file).exists(), f"{file} exists but is not registered; register and aggregate in the harness first")

copies: dict[str, bytes] = {"experiment.json": experiment_bytes, "report.json": report_bytes}
for file, slot in registered.items():
    path = bundled(file)
    check(path.is_file(), f"registered attempt {file} is missing")
    data = path.read_bytes()
    check(sha256(data) == slot["sha256"], f"registered attempt {file} has changed on disk")
    recording = json.loads(data)
    cell, row = rows[file]
    check(recording["schema"] == RECORDING_SCHEMA, f"{file} has an unknown recording schema")
    check(recording["corpusKind"] == "SYNTHETIC", f"{file} is not a synthetic recording")
    check(recording["run"]["mode"] == mode, f"{file} ran in {recording['run']['mode']}, the design is {mode}")
    check((cell["arm"], cell["playbook"], cell["variant"], row["repetition"])
          == (slot["arm"], slot["playbook"], slot["variant"], slot["repetition"]),
          f"the report lists {file} outside the slot the experiment assigns to it")
    canonical = json.dumps(recording, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    check(sha256(canonical.encode("utf-8")) == row["recordingSha256"],
          f"{file} does not have the canonical recording digest its report row states")
    copies[file] = data

reference_cells = set()
for reference_slot in experiment.get("references", []):
    file, key = reference_slot["file"], f"{reference_slot['playbook']}/{reference_slot['variant']}"
    check(file not in copies, f"{file} is registered twice")
    path = bundled(file)
    check(path.is_file(), f"registered reference {file} is missing")
    data = path.read_bytes()
    check(sha256(data) == reference_slot["sha256"], f"reference {file} does not match its registered hash")
    reference = json.loads(data)
    stated = report["references"].get(key)
    check(reference["schema"] == REFERENCE_SCHEMA, f"{file} has an unknown reference schema")
    check(stated is not None and stated["status"] == reference["status"]
          and stated["expectedIssues"] == len(reference["issues"])
          and stated["reviewerEvidence"] == reference["reviewerEvidence"],
          f"the report does not describe reference {file}")
    reference_cells.add(key)
    copies[file] = data
check(set(report["references"]) == reference_cells, "the report names a reference the experiment does not register")

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
scope = (
    f"One preregistered {mode} experiment over the synthetic My Counsel corpus: {len(registered)} recorded attempt "
    f"file(s) copied, {missing} planned attempt file(s) not run, {len(reference_cells)} reference file(s). "
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
    # identify the code that wrote the report, which is why the two file hashes follow.
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
print(f"Copied experiment {experiment_id}: {len(registered)} attempt file(s), {len(reference_cells)} reference "
      f"file(s), experiment.json, report.json and provenance.json to {destination.relative_to(root)}.")
