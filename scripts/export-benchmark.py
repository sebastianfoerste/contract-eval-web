"""Use the canonical Python exporter; never maintain reference state in the web app."""
import argparse
from pathlib import Path
import sys

site = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument("--repo", type=Path, default=site.parent / "contract-review-eval-harness")
args = parser.parse_args()
root = args.repo.resolve()
sys.path.insert(0, str(root / "src"))
try:
    from contract_eval.web_export import write_web_snapshot
    write_web_snapshot(root, site)
except (ImportError, OSError, ValueError) as exc:
    raise SystemExit(f"Export failed: {exc}. Run with the harness Python environment.")
print("Exported canonical cases, reference evidence and complete Python parity vectors.")
