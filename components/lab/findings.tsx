'use client';
import { useState, type KeyboardEvent } from 'react';
import { ArrowRight, ChevronRight, Search } from 'lucide-react';
import type { BenchmarkCase, Evaluation } from '@/lib/evaluation';
import { clauseFindings, clauseLabel, displayMetric, type MetricKey, type ReadoutPoint, type RiskFinding } from '@/lib/inspection';
import { FindingTag, GroundedTag, Severity, ToneIcon, percent } from './primitives';

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

export function Delta({ value, suffix = ' pp' }: { value: number | null; suffix?: string }) {
  if (value === null) return <span className="delta">N/A</span>;
  const rounded = Math.round(value * 10) / 10;
  return <span className={`delta ${rounded < 0 ? 'delta-down' : rounded > 0 ? 'delta-up' : ''}`}>{rounded > 0 ? '+' : rounded < 0 ? '−' : '±'}{Math.abs(rounded).toFixed(suffix ? 1 : 0)}{suffix}</span>;
}

export function ScoreCards({ run, base, points, onSelectFinding }: { run: Evaluation; base: Evaluation; points: ReadoutPoint[]; onSelectFinding: (key: string) => void }) {
  return <div className="scorecards">
    {metrics.map(metric => {
      const display = displayMetric(metric.key, run.scores, run.review);
      const point = points.find(value => value.metric === metric.key);
      return <article className={`scorecard tone-${point?.tone ?? 'info'}`} key={metric.key}>
        <header><h3>{metric.title}</h3>{run.scenario !== 'baseline' && <Delta value={metricDelta(metric.key, run, base)} />}</header>
        <strong className="scorecard-value">{display.value}</strong>
        <div className="meter" aria-hidden="true"><span style={{ width: display.defined ? percent(run.scores[metric.key]) : '0%' }} /></div>
        {point ? <div className="scorecard-readout">
          <p className="scorecard-title"><ToneIcon tone={point.tone} />{point.title}</p>
          <p>{point.detail}</p>
          {point.findings.length > 0 && <button className="link-button" onClick={() => onSelectFinding(point.findings[0])}>Inspect {clauseLabel(point.findings[0]).toLowerCase()}<ArrowRight /></button>}
        </div> : <p className="scorecard-readout muted">{display.detail || metric.description}</p>}
      </article>;
    })}
  </div>;
}

export function FindingsTable({ rows, selected, onSelect }: { rows: RiskFinding[]; selected: string; onSelect: (key: string) => void }) {
  const [query, setQuery] = useState('');
  const [issuesOnly, setIssuesOnly] = useState(false);
  const issues = rows.filter(row => row.status !== 'Match').length;
  const visible = rows.filter(row => (!issuesOnly || row.status !== 'Match') && clauseLabel(row.key).toLowerCase().includes(query.trim().toLowerCase()));

  function move(event: KeyboardEvent<HTMLTableSectionElement>) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button[data-key]')];
    const index = buttons.findIndex(button => button === document.activeElement);
    const next = buttons[index + (event.key === 'ArrowDown' ? 1 : -1)];
    if (!next) return;
    event.preventDefault();
    next.focus();
    onSelect(next.dataset.key!);
  }

  return <section className="panel findings" aria-labelledby="findings-heading">
    <div className="panel-heading">
      <div><h3 id="findings-heading">Risk findings</h3><p>Reference judgment against the review’s flag, most serious first: hidden exposure before false alarms. Use ↑ ↓ to step through.</p></div>
    </div>
    <div className="toolbar">
      <label className="search"><Search aria-hidden="true" /><input type="search" aria-label="Search findings" placeholder="Find a clause" value={query} onChange={event => setQuery(event.target.value)} /></label>
      <div className="chip-toggle" role="group" aria-label="Filter findings">
        <button aria-pressed={!issuesOnly} onClick={() => setIssuesOnly(false)}>All <span>{rows.length}</span></button>
        <button aria-pressed={issuesOnly} onClick={() => setIssuesOnly(true)}>Issues <span>{issues}</span></button>
      </div>
    </div>
    <div className="table-scroll">
      <table className="data-table findings-table">
        <thead><tr><th scope="col">Clause</th><th scope="col">Reference</th><th scope="col">Review</th><th scope="col">Finding</th></tr></thead>
        <tbody onKeyDown={move}>
          {visible.map(row => <tr key={row.key} className={selected === row.key ? 'is-selected' : ''}>
            <th scope="row"><button className="row-button" data-key={row.key} aria-current={selected === row.key ? 'true' : undefined} onClick={() => onSelect(row.key)}>{clauseLabel(row.key)}<ChevronRight aria-hidden="true" /></button></th>
            <td data-label="Reference"><Severity value={row.expected} /></td>
            <td data-label="Review">{row.severities.length > 1 ? <span className="severity-stack">{[...new Set(row.severities)].map(value => <Severity key={value} value={value} />)}</span> : <Severity value={row.predicted} />}</td>
            <td className="finding-cell"><FindingTag finding={row} /></td>
          </tr>)}
          {!visible.length && <tr><td colSpan={4} className="empty-row">No findings match. <button className="link-button" onClick={() => { setQuery(''); setIssuesOnly(false); }}>Clear filters</button></td></tr>}
        </tbody>
      </table>
    </div>
  </section>;
}

type Citation = { clause_type: string; quote: string; sourceSpan: [number, number] | null; index: number };

export function Inspector({ item, run, finding, row, citations, canonical, onShowCitation }: {
  item: BenchmarkCase; run: Evaluation; finding: string; row?: RiskFinding; citations: Citation[]; canonical: (key: string) => string; onShowCitation: (index: number) => void;
}) {
  const rationale = item.gold.severity_rationale[finding];
  const flags = run.review.risk_flags.filter(flag => canonical(flag.clause_type) === finding);
  const quotes = citations.filter(citation => canonical(citation.clause_type) === finding);
  return <aside className="panel inspector" aria-labelledby="inspector-heading" aria-live="polite">
    <div className="inspector-top"><span className="eyebrow">Finding</span>{row && <FindingTag finding={row} />}</div>
    <h3 id="inspector-heading">{clauseLabel(finding)}</h3>
    <div className="severity-compare">
      <div><span>Reference</span><Severity value={item.gold.risk_flags[finding]} /></div>
      <ArrowRight aria-hidden="true" />
      <div><span>Review</span>{flags.length ? <span className="severity-stack">{flags.map((flag, index) => <Severity key={index} value={flag.severity} />)}</span> : <Severity />}</div>
    </div>
    <h4>Reference rationale</h4>
    <p className="prose">{rationale || 'The reference set does not treat this clause as a risk.'}</p>
    <h4>Review’s reasoning</h4>
    {flags.length ? flags.map((flag, index) => <p className="prose" key={index}>{flag.rationale}</p>) : <p className="muted">The review did not flag this clause.</p>}
    <h4>Supporting quotations <span className="count">{quotes.length}</span></h4>
    {quotes.length ? quotes.map(citation => <figure className={`quote ${citation.sourceSpan ? '' : 'is-ungrounded'}`} key={citation.index}>
      <blockquote>“{citation.quote}”</blockquote>
      <figcaption><GroundedTag grounded={!!citation.sourceSpan} />{citation.sourceSpan && <button className="link-button" onClick={() => onShowCitation(citation.index)}>Show in contract<ArrowRight /></button>}</figcaption>
    </figure>) : <p className="muted">No quotation was supplied for this clause.</p>}
  </aside>;
}

export function Coverage({ item, run }: { item: BenchmarkCase; run: Evaluation }) {
  const clauses = clauseFindings(item.gold, run.review);
  const rank = (status: string) => ['Missed', 'Extra', 'Matched via alias', 'Matched'].indexOf(status);
  const ordered = [...clauses].sort((a, b) => rank(a.status) - rank(b.status));
  const expected = clauses.filter(clause => clause.expected).length;
  const missed = clauses.filter(clause => clause.status === 'Missed').length;
  const extra = clauses.filter(clause => clause.status === 'Extra').length;
  return <section className="panel coverage" aria-labelledby="coverage-heading">
    <div className="panel-heading">
      <div><h3 id="coverage-heading">Clause coverage</h3><p>Clauses the reference expects against clauses the review named. Aliases resolve through the reference set.</p></div>
      <span className="count">{expected - missed}/{expected} found · {extra} extra</span>
    </div>
    <ul className="coverage-grid">
      {ordered.map(clause => <li key={clause.key} className={`coverage-item status-${clause.status.toLowerCase().replaceAll(' ', '-')}`}>
        <span className="coverage-dot" aria-hidden="true" />
        <span className="coverage-name">{clauseLabel(clause.key)}</span>
        <span className="coverage-status">{clause.status === 'Extra' ? 'Not in reference set' : clause.status === 'Matched via alias' ? `Named “${clause.reportedAs.filter(name => name !== clause.key).map(clauseLabel).join(', ')}”` : clause.status}</span>
        {clause.abstentions.map((abstention, index) => <span className="coverage-note" key={index}>Abstained: {abstention.reason}</span>)}
      </li>)}
    </ul>
  </section>;
}
