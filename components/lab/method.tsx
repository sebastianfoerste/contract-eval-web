import { ArrowUpRight, Braces } from 'lucide-react';
import benchmark from '@/lib/benchmark';
import type { BenchmarkCase, Evaluation } from '@/lib/evaluation';
import { clauseLabel, referenceReleaseReady } from '@/lib/inspection';
import { download } from './primitives';

const formulas: { term: string; formula: string; note: string }[] = [
  { term: 'Risk recall', formula: 'reference risks the review flagged ÷ reference risks', note: 'Measures missed risks.' },
  { term: 'Severity accuracy', formula: 'shared risks with the reference severity ÷ shared risks', note: 'Only risks both sides flagged count. Where a clause carries several flags, the first severity is graded. N/A when no risk is shared.' },
  { term: 'Risk precision', formula: 'flagged clauses the reference treats as risks ÷ flagged clauses', note: 'Penalizes extra flags. N/A when the review flags nothing; the exported JSON keeps the Python value of 1.0.' },
  { term: 'Citation grounding', formula: 'quotations located in the contract ÷ quotations', note: 'Matching ignores case, punctuation and whitespace. N/A when no quotation is supplied.' },
  { term: 'Clause F1', formula: 'harmonic mean of clause precision and clause recall', note: 'Clause names resolve through the reference aliases first.' },
  { term: 'Span coverage', formula: 'reference clauses containing a located quotation ÷ reference clauses', note: 'A clause runs from its reference anchor to the next anchor in the contract.' },
];

export function Method({ item, run }: { item: BenchmarkCase; run: Evaluation }) {
  const evidence = benchmark.referenceEvidence;
  const ready = referenceReleaseReady(evidence);
  return <div className="method">
    <div className="method-grid">
      <section className="panel"><h2>Three synthetic contracts</h2><p>The cases test clause identification, risk identification, severity and quotation grounding. The fixtures contain deliberate errors.</p><p>Results describe fixture behavior on a small public reference set, not a blinded holdout. They are not a ranking of live models or a certification of legal reliability.</p></section>
      <section className="panel"><h2>{ready ? 'v2 evidence frozen, scores still on v1 answers' : 'Scored on v1 answers, v2 pending'}</h2><p>The gate tracks the v2 candidate reference answers. The scores on this page use the v1 answers. Evidence stage: <strong>{clauseLabel(evidence.stage)}</strong>. Final release eligible: <strong>{ready ? 'yes' : 'no'}</strong>.</p><p>{evidence.missing.length ? `Still required: ${evidence.missing.map(clauseLabel).join(', ')}.` : 'No missing artifacts are recorded.'} {evidence.errors.length ? `Recorded errors: ${evidence.errors.join('; ')}.` : ''}</p><p>{evidence.limitation} This web edition remains on the v1 scorer until the v2 scoring export and parity checks are complete.</p></section>
      <section className="panel"><h2>Read the dimensions together</h2><p>Risk precision penalizes extra flags; recall measures missed risks. Severity accuracy considers only jointly identified risks.</p><p>Grounding checks quotation matches. Span coverage measures where quotations land. Neither proves legal reasoning.</p></section>
      <section className="panel"><h2>Reproducible and bounded</h2><p>The hosted evaluator recomputes scores from fixed synthetic inputs. Its scoring port is checked against Python outputs. Scenarios remove evidence, remove risks or introduce a conflicting severity.</p><p>No live model is called. This public edition has no document uploads, paid API calls or shared user histories.</p></section>
    </div>

    <section className="panel formulas" aria-labelledby="formulas-heading">
      <div className="panel-heading"><div><h2 id="formulas-heading">How each score is computed</h2><p>Definitions follow the Python <code>score_review</code> function that this port reproduces.</p></div></div>
      <dl>{formulas.map(entry => <div key={entry.term}><dt>{entry.term}</dt><dd><code>{entry.formula}</code><span>{entry.note}</span></dd></div>)}</dl>
    </section>

    <section className="panel provenance" aria-labelledby="provenance-heading">
      <div className="panel-heading"><div><h2 id="provenance-heading">Current result provenance</h2><p>Hashes identify the original input files. The scenario and full evaluated review travel with the exported result.</p></div>
        <div className="provenance-actions">
          <a className="button button-quiet" href={benchmark.repository} target="_blank" rel="noreferrer">Harness source<ArrowUpRight aria-hidden="true" /></a>
          <button className="button button-quiet" onClick={() => download(`${item.id}-${run.scenario}-evaluation.json`, JSON.stringify(run, null, 2))}><Braces />Evaluation JSON</button>
        </div>
      </div>
      <dl>
        <dt>Source commit</dt><dd><a href={`${benchmark.repository}/tree/${benchmark.sourceCommit}`} target="_blank" rel="noreferrer">{benchmark.sourceCommit}</a></dd>
        <dt>Source contract</dt><dd>{item.hashes.source}</dd>
        <dt>Reference answers (v1, scored)</dt><dd>{item.hashes.gold}</dd>
        <dt>v2 candidate answers</dt><dd>{evidence.cases.find(entry => entry.case === item.id)?.candidateSha256 ?? 'Not recorded'}</dd>
        <dt>Original review fixture</dt><dd>{item.hashes.review}</dd>
        <dt>Evaluator</dt><dd>{run.provenance.evaluator}</dd>
        <dt>Adapter</dt><dd>{run.provenance.adapter}</dd>
      </dl>
    </section>
  </div>;
}
