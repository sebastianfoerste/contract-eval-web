'use client';
import { ArrowRight, Braces, GitCompareArrows } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { findCase, type BenchmarkCase, type Evaluation } from '@/lib/evaluation';
import { clauseLabel, displayMetric, reviewChanges } from '@/lib/inspection';
import { locateSource, scenarios, type Scenario, type Scores } from '@/lib/scoring';
import { Delta, metricDelta, metrics } from './findings';
import { download } from './primitives';

export const scenarioLabels: Record<Scenario, string> = {
  baseline: 'Original',
  'no-evidence': 'No citations',
  'missed-risks': 'No risk flags',
  'conflicting-flags': 'Conflicting severity',
};

const counts: { title: string; value: (scores: Scores) => number }[] = [
  { title: 'Missed reference risks', value: scores => scores.risk_missed.length },
  { title: 'Extra risk flags', value: scores => scores.risk_false_positives.length },
  { title: 'Contradictory severities', value: scores => scores.risk_conflicting_flags.length },
  { title: 'Ungrounded quotations', value: scores => scores.hallucination_count },
];

export function Compare({ item, run, matrix, target, onTarget, runs, busy, onReopen, onShowQuote }: {
  item: BenchmarkCase; run: Evaluation; matrix: Record<Scenario, Evaluation>; target: Scenario; onTarget: (scenario: Scenario) => void;
  runs: Evaluation[]; busy: boolean; onReopen: (run: Evaluation) => void; onShowQuote: (quote: string) => void;
}) {
  const order = Object.keys(scenarios) as Scenario[];
  const base = matrix.baseline;
  const other = matrix[target];
  const changes = reviewChanges(other.review, run.review);
  return <div className="compare">
    <section className="panel" aria-labelledby="matrix-heading">
      <div className="panel-heading">
        <div><h3 id="matrix-heading">Scenario sensitivity</h3><p>Every scenario scored against the same contract and reference answers. Changes are against the original fixture.</p></div>
      </div>
      <div className="table-scroll">
        <table className="data-table matrix">
          <thead><tr><th scope="col">Measure</th>{order.map(scenario => <th scope="col" key={scenario} className={scenario === run.scenario ? 'is-current' : ''}>{scenarioLabels[scenario]}{scenario === run.scenario && <span className="current-tag">Showing</span>}</th>)}</tr></thead>
          <tbody>
            {metrics.map(metric => <tr key={metric.key}>
              <th scope="row">{metric.title}</th>
              {order.map(scenario => {
                const result = matrix[scenario];
                const display = displayMetric(metric.key, result.scores, result.review);
                return <td key={scenario} className={scenario === run.scenario ? 'is-current' : ''}><span className="matrix-value">{display.value}</span>{scenario !== 'baseline' && display.defined && <Delta value={metricDelta(metric.key, result, base)} />}</td>;
              })}
            </tr>)}
            {counts.map(count => <tr key={count.title}>
              <th scope="row">{count.title}</th>
              {order.map(scenario => {
                const value = count.value(matrix[scenario].scores);
                const change = value - count.value(base.scores);
                return <td key={scenario} className={scenario === run.scenario ? 'is-current' : ''}><span className="matrix-value">{value}</span>{scenario !== 'baseline' && change !== 0 && <span className="delta">{change > 0 ? '+' : '−'}{Math.abs(change)}</span>}</td>;
              })}
            </tr>)}
          </tbody>
        </table>
      </div>
    </section>

    <section className="panel" aria-labelledby="pair-heading">
      <div className="panel-heading pair-heading">
        <div><h3 id="pair-heading">What changed in the review</h3><p>Every clause, flag and quotation that differs between two scenarios. The entries explain the score movement.</p></div>
        <div className="pair-controls">
          <label htmlFor="compare-target">From</label>
          <Select value={target} onValueChange={value => onTarget(value as Scenario)}>
            <SelectTrigger id="compare-target"><SelectValue /></SelectTrigger>
            <SelectContent>{order.filter(scenario => scenario !== run.scenario).map(scenario => <SelectItem key={scenario} value={scenario}>{scenarios[scenario].title}</SelectItem>)}</SelectContent>
          </Select>
          <span className="pair-to">to <strong>{scenarios[run.scenario].title}</strong> (showing)</span>
          <button className="button button-quiet" onClick={() => download(`${item.id}-${target}-vs-${run.scenario}.json`, JSON.stringify({ baseline: other, current: run, changes }, null, 2))}><Braces />Export</button>
        </div>
      </div>
      <>
          <div className="pair-metrics">
            {metrics.map(metric => <div key={metric.key}>
              <span>{metric.title}</span>
              <strong>{displayMetric(metric.key, other.scores, other.review).value}<ArrowRight aria-hidden="true" />{displayMetric(metric.key, run.scores, run.review).value}</strong>
              <Delta value={metricDelta(metric.key, run, other)} />
            </div>)}
          </div>
          {!changes.length ? <p className="change-empty">No clause, risk flag or quotation changed between these runs.</p>
            : <ul className="change-list">{changes.map((change, index) => {
              const located = change.kind === 'Quotation' && locateSource(item.source, change.quote || '') !== null;
              return <li key={`${change.kind}-${change.change}-${change.key}-${index}`}>
                <span className={`change-kind ${change.change === 'Added' ? 'is-added' : 'is-removed'}`}>{change.change}</span>
                <div className="change-body">
                  <strong>{change.kind} · {clauseLabel(change.key)}{change.kind === 'Risk flag' && <span className="change-detail"> ({change.detail})</span>}</strong>
                  {change.kind === 'Quotation' && <blockquote>“{change.quote}”</blockquote>}
                </div>
                {located && <button className="link-button" onClick={() => onShowQuote(change.quote || '')}>Show in contract<ArrowRight /></button>}
              </li>;
            })}</ul>}
      </>
    </section>

    <section className="session" aria-labelledby="session-heading">
      <div className="panel-heading flat"><div><h3 id="session-heading">Runs in this session</h3><p>Server-scored runs, newest first. Refreshing clears the list; export to keep a result. Up to 30 are kept.</p></div></div>
      {!runs.length ? <div className="panel empty-state"><GitCompareArrows aria-hidden="true" /><h3>No server runs yet</h3><p>Choose a contract or scenario above. Each choice is scored on the server and listed here.</p></div>
        : <ol className="run-list">{runs.map(saved => <li key={saved.id}><button className={`panel saved-run ${saved.id === run.id ? 'is-current' : ''}`} disabled={busy} onClick={() => onReopen(saved)}>
          <span><strong>{findCase(saved.caseId).title} · {scenarioLabels[saved.scenario]}</strong><small>Scored {new Date(saved.scoredAt).toLocaleTimeString()}</small></span>
          <span className="saved-run-score">{displayMetric('risk_recall', saved.scores, saved.review).value} recall · {displayMetric('citation_grounding', saved.scores, saved.review).value} grounded<ArrowRight aria-hidden="true" /></span>
        </button></li>)}</ol>}
    </section>
  </div>;
}
