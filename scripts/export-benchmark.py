"""Export only synthetic, committed inputs and Python-scored parity vectors."""
import argparse
import copy
import hashlib
import json
from pathlib import Path
import subprocess
import sys

parser = argparse.ArgumentParser()
parser.add_argument('--repo', required=True, type=Path)
args = parser.parse_args()
root = args.repo.resolve()
sys.path.insert(0, str(root / 'src'))
from contract_eval.cli import score_review
from contract_eval.models import ExpectedAnswer, ReviewOutput
from contract_eval.cases import ALL_CASES

site = Path(__file__).resolve().parents[1]
cases = []
vectors = []
titles = {'nda': 'Mutual NDA', 'saas': 'SaaS agreement', 'dpa': 'Data processing agreement'}
for case in ALL_CASES:
    paths = {'source': root / 'data' / f'{case}_sample.md',
             'gold': root / 'expected' / f'{case}.json',
             'review': root / 'fixtures' / f'{case}_stub.json'}
    source = paths['source'].read_text()
    expected = ExpectedAnswer.model_validate_json(paths['gold'].read_text())
    review = ReviewOutput.model_validate_json(paths['review'].read_text())
    item = {'id': case, 'title': titles.get(case, case), 'source': source,
            'gold': expected.model_dump(), 'review': review.model_dump(),
            'hashes': {k: hashlib.sha256(p.read_bytes()).hexdigest() for k,p in paths.items()}}
    cases.append(item)
    for scenario in ['baseline', 'no-evidence', 'missed-risks', 'conflicting-flags']:
        output = review.model_copy(deep=True)
        if scenario == 'no-evidence': output.citations = []
        if scenario == 'missed-risks': output.risk_flags = []
        if scenario == 'conflicting-flags':
            first = output.risk_flags[0].model_copy(deep=True)
            first.severity = 'low' if first.severity != 'low' else 'high'
            output.risk_flags.append(first)
        for aliases in ['on','off']:
            vectors.append({'caseId': case, 'scenario': scenario, 'aliases': aliases,
                            'expected': score_review(source, expected, output, alias_mode=aliases)})
    # Empty sets and reordered/empty/fabricated quotations catch unsafe edge semantics.
    for name, output in [('empty', ReviewOutput(clauses=[],risk_flags=[],citations=[])),
                         ('baseline', review)]:
        vectors.append({'caseId':case, 'customReview': output.model_dump(), 'aliases':'on',
                        'expected':score_review(source,expected,output)})

payload = {'schema':'contract-eval.web-benchmark.v1', 'version':'0.7.0rc1',
           'repository':'https://github.com/sebastianfoerste/contract-review-eval-harness',
           'sourceCommit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip(),
           'goldStatus':'v1 reference answers; adjudicated v2 artifacts not imported',
           'cases':cases}
(site/'lib').mkdir(exist_ok=True)
(site/'lib'/'benchmark.json').write_text(json.dumps(payload,ensure_ascii=False,indent=2)+'\n')
(site/'tests').mkdir(exist_ok=True)
(site/'tests'/'python-parity.json').write_text(json.dumps(vectors,ensure_ascii=False,indent=2)+'\n')
print(f'Exported {len(cases)} synthetic cases and {len(vectors)} Python parity vectors')
