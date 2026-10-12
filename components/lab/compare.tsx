'use client';
import { ArrowRight, Braces, GitCompareArrows } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { findCase, type BenchmarkCase, type Evaluation } from '@/lib/evaluation';
import { displayMetric, reviewChanges } from '@/lib/inspection';
import { locateSource, scenarios, type Scenario, type Scores } from '@/lib/scoring';
import { Delta, metricDelta, metrics } from './scores';
import { download } from './primitives';
import { useLocale } from './locale';
export function Compare({ item, run, matrix, target, onTarget, runs, busy, onReopen, onShowQuote }: {
  item: BenchmarkCase; run: Evaluation; matrix: Record<Scenario, Evaluation>; target: Scenario; onTarget: (scenario: Scenario) => void;
  runs: Evaluation[]; busy: boolean; onReopen: (run: Evaluation) => void; onShowQuote: (quote: string, clause: string, comparisonIndex: number | null) => void;
}) {
  const { t, locale, label, scenarioTitle, caseTitle, metricTitle, statusText, severityText } = useLocale();
  const order = Object.keys(scenarios) as Scenario[];
  const counts: { title: string; value: (scores: Scores) => number }[] = [
    {title:t('Missed reference risks','Übersehene Referenzrisiken'),value:scores=>scores.risk_missed.length},
    {title:t('Extra risk flags','Zusätzliche Risikohinweise'),value:scores=>scores.risk_false_positives.length},
    {title:t('Contradictory severities','Widersprüchliche Schweregrade'),value:scores=>scores.risk_conflicting_flags.length},
    {title:t('Ungrounded quotations','Nicht belegte Zitate'),value:scores=>scores.hallucination_count},
  ];
  const base = matrix.baseline, other = matrix[target], changes = reviewChanges(other.review, run.review);
  return <div className="compare">
    <section className="panel" aria-labelledby="matrix-heading">
      <div className="panel-heading"><div><h2 id="matrix-heading">{t('Scenario sensitivity', 'Einfluss der Szenarien')}</h2><p>{t('Same source and reference answers. Changes are relative to the original fixture.', 'Identischer Vertrag und Referenzstand. Änderungen beziehen sich auf das ursprüngliche Beispiel.')}</p></div></div>
      <div className="table-scroll" tabIndex={0} role="region" aria-label={t('Scenario comparison table; scroll horizontally', 'Szenariovergleich; horizontal scrollbar')}>
        <table className="data-table matrix"><caption className="sr-only">{t('Five evaluation dimensions across four scenarios', 'Fünf Bewertungsdimensionen in vier Szenarien')}</caption>
          <thead><tr><th scope="col">{t('Measure', 'Kennzahl')}</th>{order.map(scenario => <th scope="col" key={scenario} className={scenario === run.scenario ? 'is-current' : ''}>{scenarioTitle(scenario)}{scenario === run.scenario && <span className="current-tag">{t('Showing', 'Aktuell')}</span>}</th>)}</tr></thead>
          <tbody>{metrics.map(metric => <tr key={metric.key}><th scope="row">{metricTitle(metric.key)}</th>{order.map(scenario => {
            const result = matrix[scenario], display = displayMetric(metric.key, result.scores, result.review);
            return <td key={scenario} className={scenario === run.scenario ? 'is-current' : ''}><span className="matrix-value">{display.value}</span>{scenario !== 'baseline' && display.defined && <Delta value={metricDelta(metric.key, result, base)} quiet />}</td>;
          })}</tr>)}{counts.map(count=><tr key={count.title}><th scope="row">{count.title}</th>{order.map(scenario=>{const value=count.value(matrix[scenario].scores),change=value-count.value(base.scores);return <td key={scenario} className={scenario===run.scenario?'is-current':''}><span className="matrix-value">{value}</span>{scenario!=='baseline'&&change!==0&&<span className="delta">{change>0?'+':'−'}{Math.abs(change)}</span>}</td>;})}</tr>)}</tbody>
        </table>
      </div>
    </section>
    <section className="panel" aria-labelledby="pair-heading">
      <div className="panel-heading pair-heading"><div><h2 id="pair-heading">{t('What changed in the review', 'Änderungen der Prüfung')}</h2><p>{t('Every added or removed clause, risk flag and quotation.', 'Alle hinzugefügten oder entfernten Klauseln, Risikohinweise und Zitate.')}</p></div>
        <div className="pair-controls"><label htmlFor="compare-target">{t('From', 'Von')}</label><Select value={target} onValueChange={value => onTarget(value as Scenario)}><SelectTrigger id="compare-target"><SelectValue /></SelectTrigger><SelectContent>{order.filter(scenario => scenario !== run.scenario).map(scenario => <SelectItem key={scenario} value={scenario}>{scenarioTitle(scenario)}</SelectItem>)}</SelectContent></Select>
          <span className="pair-to">{t('to', 'zu')} <strong>{scenarioTitle(run.scenario)}</strong></span>
          <button className="button button-quiet" onClick={() => download(`${item.id}-${target}-vs-${run.scenario}.json`, JSON.stringify({ baseline: other, current: run, changes }, null, 2))}><Braces aria-hidden="true" />{t('Export JSON', 'JSON exportieren')}</button>
        </div>
      </div>
      <div className="pair-metrics">{metrics.map(metric => <div key={metric.key}><span>{metricTitle(metric.key)}</span><strong>{displayMetric(metric.key, other.scores, other.review).value}<ArrowRight aria-hidden="true" />{displayMetric(metric.key, run.scores, run.review).value}</strong><Delta value={metricDelta(metric.key, run, other)} /></div>)}</div>
      {!changes.length ? <p className="change-empty">{t('No changes between these reviews.', 'Keine Unterschiede zwischen diesen Prüfungen.')}</p> : <ul className="change-list">{changes.map((change, index) => {
        const located = change.kind === 'Quotation' && locateSource(item.source, change.quote || '') !== null;
        const comparisonIndex = change.change === 'Removed' ? other.review.citations.findIndex(citation => citation.quote === change.quote && citation.clause_type === change.key) : null;
        return <li key={`${change.kind}-${change.change}-${index}`}><span className={`change-kind ${change.change === 'Added' ? 'is-added' : 'is-removed'}`}>{statusText(change.change)}</span><div className="change-body"><strong>{statusText(change.kind)}: {label(change.key)}{change.kind === 'Risk flag' && <span className="change-detail"> ({severityText(change.detail)})</span>}</strong>{change.kind === 'Quotation' && <blockquote lang="en">“{change.quote}”</blockquote>}</div>{located && <button className="link-button" onClick={() => onShowQuote(change.quote || '', change.key, comparisonIndex)}>{t('Show in contract', 'Im Vertrag anzeigen')}</button>}</li>;
      })}</ul>}
    </section>
    <section className="session" aria-labelledby="session-heading"><div className="panel-heading flat"><div><h2 id="session-heading">{t('Runs in this session', 'Prüfungen dieser Sitzung')}</h2><p>{t('Up to 30 results, newest first. Refresh clears this list; export to retain a result.', 'Bis zu 30 Ergebnisse, neueste zuerst. Neuladen leert die Liste; zum Aufbewahren exportieren.')}</p></div></div>
      {!runs.length ? <div className="panel empty-state"><GitCompareArrows aria-hidden="true" /><p className="empty-title">{t('Explore another scenario', 'Weiteres Szenario ausprobieren')}</p><p>{t('Choose a contract or scenario to add a result here.', 'Die Auswahl eines Vertrags oder Szenarios ergänzt hier ein Ergebnis.')}</p></div> : <ol className="run-list">{runs.map(saved => <li key={saved.id}><button className={`panel saved-run ${saved.id === run.id ? 'is-current' : ''}`} disabled={busy} onClick={() => onReopen(saved)}><span><strong>{caseTitle(saved.caseId, findCase(saved.caseId).title)}, {scenarioTitle(saved.scenario)}</strong><small>{t('Evaluated', 'Ausgewertet')} {new Date(saved.scoredAt).toLocaleTimeString(locale === 'de' ? 'de-DE' : 'en-GB')}</small></span><span className="saved-run-score">{metricTitle('risk_recall')} {displayMetric('risk_recall', saved.scores, saved.review).value}, {metricTitle('citation_grounding')} {displayMetric('citation_grounding', saved.scores, saved.review).value}</span></button></li>)}</ol>}
    </section>
  </div>;
}
