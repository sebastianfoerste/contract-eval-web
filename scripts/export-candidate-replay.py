"""Copy the synthetic, hand-authored replay and its authoritative Python score.

This is separate from the v1 benchmark export. No model is called and no score is
computed here. Run after the harness has validated and scored the source artifact.
"""
import hashlib
import json
from pathlib import Path

root = Path(__file__).resolve().parents[1]
harness = root.parent / "contract-review-eval-harness"
source = harness / "candidates/mycounsel"
run_bytes = (source / "replay-run.json").read_bytes()
score_bytes = (source / "replay-score.json").read_bytes()
run, score = json.loads(run_bytes), json.loads(score_bytes)
assert run["schema"] == "mycounsel.candidate-run.v1"
assert run["corpusKind"] == "SYNTHETIC" and run["run"]["mode"] == "REPLAY"
assert run["run"]["model"] == "hand-authored-replay-fixture"
assert score["schema"] == "mycounsel.candidate-score.v1"
assert score["issueMatch"] is None
assert score["recordingHashFormat"] == "utf8-json-sorted-keys-v1"
assert hashlib.sha256(json.dumps(run, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest() == score["recordingSha256"]
assert score["run"] == run["run"]
assert score["instructionsSha256"] == run["instructionsSha256"]
assert run["validation"] == {"status": "REJECTED", "errorCode": "CONTRACT_PLAYBOOK_REFERENCE"}
assert score["sourceSha256"] == run["source"]["sha256"]
assert score["playbookSha256"] == run["playbook"]["sha256"]
assert hashlib.sha256((source / "ict-base.docx").read_bytes()).hexdigest() == run["source"]["sha256"]
destination = root / "public/candidates"
destination.mkdir(parents=True, exist_ok=True)
(destination / "replay-run.json").write_bytes(run_bytes)
(destination / "replay-score.json").write_bytes(score_bytes)
manifest = {
    "schema": "evidence-lab.candidate-bundle.v1",
    "origin": "contract-review-eval-harness/candidates/mycounsel",
    "runSha256": hashlib.sha256(run_bytes).hexdigest(),
    "scoreSha256": hashlib.sha256(score_bytes).hexdigest(),
    "scorerPath": "src/contract_eval/candidates.py",
    "scorerSha256": hashlib.sha256((harness / "src/contract_eval/candidates.py").read_bytes()).hexdigest(),
    "scope": "One synthetic hand-authored replay; no independent issue annotation or live model result",
}
(destination / "provenance.json").write_text(json.dumps(manifest, indent=2) + "\n")
print("Copied the synthetic replay, Python score and file-hash provenance.")
