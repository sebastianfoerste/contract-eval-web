import { readout, riskFindings, orderFindings, clauseFindings, type ReadoutPoint } from './inspection.ts';
import type { Gold, Review, Scores } from './scoring.ts';
import { label, severityText, type Locale } from './i18n.ts';
/** UI copy only. Numeric scores and original source content never change with locale. */
export function localizedReadout(gold: Gold, review: Review, scores: Scores, locale: Locale): ReadoutPoint[] {
  const points = readout(gold, review, scores);
  if (locale === 'en') return points;
  const rows = orderFindings(riskFindings(gold, review, scores));
  const shared = rows.filter(row => row.expected && row.predicted);
  const refs = Object.keys(gold.risk_flags).length;
  const clauses = clauseFindings(gold, review);
  const missedClauses = clauses.filter(clause => clause.status === 'Missed');
  const extraClauses = clauses.filter(clause => clause.status === 'Extra');
  const names = (keys: string[]) => keys.map(key => label(locale, key)).join(', ');
  return points.map(point => {
    switch (point.metric) {
      case 'risk_recall': return {...point, title: review.risk_flags.length ? `${refs - scores.risk_missed.length} von ${refs} Referenzrisiken erkannt` : 'Keine Risiken genannt', detail: scores.risk_missed.length ? `Übersehen: ${names(scores.risk_missed)}.` : 'Kein Referenzrisiko übersehen.'};
      case 'risk_severity_accuracy': return {...point, title: `${shared.filter(row => row.gap === 0).length} von ${shared.length} Schweregraden stimmen überein`, detail: shared.filter(row => row.gap !== 0).map(row => `${label(locale, row.key)}: ${severityText(locale, row.expected)} → ${severityText(locale, row.predicted)}.`).join(' ') || 'Alle beiderseits erkannten Risiken tragen den Referenzschweregrad.'};
      case 'risk_precision': return {...point, title: `${scores.risk_false_positives.length} zusätzliche, ${scores.risk_conflicting_flags.length} widersprüchliche Hinweise`, detail: [scores.risk_false_positives.length ? `Kein Referenzrisiko: ${names(scores.risk_false_positives)}.` : '', scores.risk_conflicting_flags.length ? `Mehrere Schweregrade: ${names(scores.risk_conflicting_flags)}.` : ''].filter(Boolean).join(' ') || 'Jeder Hinweis entspricht einem Referenzrisiko und trägt genau einen Schweregrad.'};
      case 'citation_grounding': return {...point, title: scores.citation_total ? `${scores.citation_grounded} von ${scores.citation_total} Zitaten im Vertrag gefunden` : 'Keine Zitate angegeben', detail: scores.citation_total ? `${scores.hallucination_count} Zitate ohne Beleg. Zitate erreichen ${Object.keys(gold.clause_anchors).length - scores.span_uncovered_clauses.length} von ${Object.keys(gold.clause_anchors).length} Referenzklauseln.` : 'Ohne Zitate lassen sich die Feststellungen nicht zum Vertragstext zurückverfolgen.'};
      case 'clause_f1': return {...point, title: `${clauses.filter(clause => clause.expected).length - missedClauses.length} von ${gold.clause_types.length} Referenzklauseln erkannt`, detail: [missedClauses.length ? `Übersehen: ${names(missedClauses.map(clause => clause.key))}.` : '', extraClauses.length ? `Zusätzlich außerhalb der Referenz: ${names(extraClauses.map(clause => clause.key))}.` : ''].filter(Boolean).join(' ') || 'Die Prüfung nennt genau die erwarteten Referenzklauseln.'};
    }
  });
}
