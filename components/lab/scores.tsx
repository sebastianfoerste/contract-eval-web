import type { Evaluation } from '@/lib/evaluation';
import { clauseLabel, displayMetric, type MetricKey, type ReadoutPoint } from '@/lib/inspection';
import { ToneIcon, percent } from './primitives';

export const metrics: { key: MetricKey; title: string; description: string }[] = [
  { key: 'risk_recall', title: 'Risk recall', description: 'Reference risks the review found' },
  { key: 'risk_severity_accuracy', title: 'Severity accuracy', description: 'Correct severity among shared risks' },
  { key: 'risk_precision', title: 'Risk precision', description: 'Flags the reference supports' },
  { key: 'citation_grounding', title: 'Citation grounding', description: 'Quotations located in the contract' },
  { key: 'clause_f1', title: 'Clause F1', description: 'Balance of clause precision and recall' },
];

export function metricDelta(key: MetricKey, current: Evaluation, base: Evaluation) {
  const a = displayMetric(key, base.scores, base.review), b = displayMetric(key, current.scores, current.review);
  return a.defined && b.defined ? (current.scores[key] - base.scores[key]) * 100 : null;
}

/** A change in percentage points. `quiet` hides an unchanged value where a grid of them would bury the real changes. */
export function Delta({ value, quiet = false }: { value: number | null; quiet?: boolean }) {
  if (value === null) return <span className="delta">N/A</span>;
  const rounded = Math.round(value * 10) / 10;
  if (rounded === 0) return quiet ? null : <span className="delta">No change</span>;
  return <span className={`delta ${rounded < 0 ? 'delta-down' : rounded > 0 ? 'delta-up' : ''}`}>{rounded > 0 ? '+' : '−'}{Math.abs(rounded).toFixed(1)} pp</span>;
}

export function ScoreBand({ run, base, points, onSelectClause }: { run: Evaluation; base: Evaluation; points: ReadoutPoint[]; onSelectClause: (key: string) => void }) {
  return <section className="scoreband" aria-label="Scores">
    {metrics.map(metric => {
      const display = displayMetric(metric.key, run.scores, run.review);
      const point = points.find(value => value.metric === metric.key);
      return <article className={`score tone-${point?.tone ?? 'info'}`} key={metric.key}>
        <header><h2>{metric.title}</h2>{run.scenario !== 'baseline' && display.defined && <Delta value={metricDelta(metric.key, run, base)} />}</header>
        <p className="score-value">{display.value}</p>
        <div className="meter" aria-hidden="true"><span style={{ width: display.defined ? percent(run.scores[metric.key]) : '0%' }} /></div>
        {point ? <>
          <p className="score-title"><ToneIcon tone={point.tone} />{point.title}</p>
          <p className="score-detail">{point.detail}</p>
          {point.findings.length > 0 && <button className="link-button" onClick={() => onSelectClause(point.findings[0])}>Open {clauseLabel(point.findings[0])}</button>}
        </> : <p className="score-detail">{display.detail || metric.description}</p>}
      </article>;
    })}
  </section>;
}
