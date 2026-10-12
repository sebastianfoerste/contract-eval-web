import { caseTitle, label, metricTitle, severityText, scenarioTitle, statusText, type Locale } from './i18n.ts';
import { localizedReadout } from './presentation.ts';
import type benchmark from './benchmark';
import type { BenchmarkCase, Evaluation } from './evaluation';
import { locateSource, scenarios } from './scoring.ts';
import { canonicalClause, clauseFindings, clauseLabel as title, displayMetric, readout, riskFindings, type RiskFinding } from './inspection.ts';

/** Export metadata the report needs. Passed in so the report stays loadable by the Node test runner. */
export type ReportContext = Pick<typeof benchmark, 'repository' | 'referenceEvidence'>;

const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
const findingText = (finding: RiskFinding) => finding.gap < 0 ? `${finding.status} (under-rated)` : finding.gap > 0 ? `${finding.status} (over-rated)` : finding.status;

function englishReport(item: BenchmarkCase, run: Evaluation, context: ReportContext): string {
  const scores = run.scores;
  const canonical = (key: string) => canonicalClause(item.gold.clause_aliases, key);
  const evidence = context.referenceEvidence;
  const candidate = evidence.cases.find(entry => entry.case === item.id);
  const lines = [
    '# Contract Review Evidence Lab',
    '',
    `Contract: ${item.title}`,
    `Scenario: ${scenarios[run.scenario].title}`,
    `Scored: ${run.scoredAt || 'Reference snapshot'}`,
    `Reference status: ${run.provenance.goldStatus}`,
    `Review perspective: ${item.gold.review_context?.party || 'Not specified'}`,
    '',
    'This report evaluates a fixed synthetic review. No live model was called. Grounding means a quotation was located in the source after normalization; it does not establish legal correctness.',
    '',
    '## Summary',
    '',
    ...readout(item.gold, run.review, scores).map(point => `- ${point.title}. ${point.detail}`),
    '',
    '## Scores',
    '',
    `- Clause F1: ${percent(scores.clause_f1)}`,
    `- Risk precision: ${displayMetric('risk_precision', scores, run.review).value}${run.review.risk_flags.length ? '' : ' (no risk flags supplied)'}`,
    `- Risk recall: ${percent(scores.risk_recall)}`,
    `- Severity accuracy: ${displayMetric('risk_severity_accuracy', scores, run.review).value}`,
    `- Citation grounding: ${displayMetric('citation_grounding', scores, run.review).value} (${scores.citation_grounded} of ${scores.citation_total})`,
    `- Source span coverage: ${percent(scores.span_coverage)}`,
    `- Ungrounded quotations: ${scores.hallucination_count}`,
    `- Missed reference risks: ${scores.risk_missed.length}`,
    `- Extra risk flags: ${scores.risk_false_positives.length}`,
    `- Contradictory severities: ${scores.risk_conflicting_flags.length}`,
    '',
    'N/A means the review supplied no observations for that metric. The JSON export retains the Python-compatible numeric scoring values.',
    '',
    '## Clause coverage',
  ];

  for (const clause of clauseFindings(item.gold, run.review)) {
    lines.push(`- ${title(clause.key)}: ${clause.status}; reference: ${clause.expected ? 'yes' : 'no'}; reported as: ${clause.reportedAs.join(', ') || 'none'}${clause.abstentions.length ? `; abstention: ${clause.abstentions.map(value => value.reason).join(' | ')}` : ''}`);
  }

  lines.push('', '## Findings and evidence');

  for (const finding of riskFindings(item.gold, run.review, run.scores)) {
    lines.push('', `### ${title(finding.key)}`, '',
      `- Finding: ${findingText(finding)}`,
      `- Reference severity: ${finding.expected || 'none'}`,
      `- Review severity: ${finding.predicted || 'none'}`,
      `- Reference rationale: ${item.gold.severity_rationale[finding.key] || 'No reference risk flag for this clause.'}`);
    const flags = run.review.risk_flags.filter(flag => canonical(flag.clause_type) === finding.key);
    if (flags.length) {
      for (const flag of flags) lines.push(`- Review reasoning (${flag.severity}): ${flag.rationale}`);
    } else {
      lines.push('- Review reasoning: No risk flag supplied.');
    }
    const citationCount = run.review.citations.filter(citation => canonical(citation.clause_type) === finding.key).length;
    lines.push(`- Supporting quotations: ${citationCount} (see quotation ledger).`);
  }

  lines.push('', '## Quotation ledger', '',
    `Every quotation in the evaluated review is listed here (${run.review.citations.length} total).`);
  if (!run.review.citations.length) lines.push('', 'No quotations were supplied.');
  for (const [index, citation] of run.review.citations.entries()) {
    const grounded = locateSource(item.source, citation.quote) !== null;
    lines.push('', `### ${index + 1}. ${title(citation.clause_type)}`, '',
      `Status: ${grounded ? 'Located in source' : 'Not found in source'}`, '',
      ...citation.quote.split('\n').map(line => `> ${line}`));
  }

  lines.push('', '## Provenance', '',
    `- Harness repository: ${context.repository}`,
    `- Harness source commit: ${run.provenance.sourceCommit}`,
    `- Source contract SHA-256: ${run.provenance.hashes.source}`,
    `- Reference answers used for scoring (v1) SHA-256: ${run.provenance.hashes.gold}`,
    `- Original review fixture SHA-256: ${run.provenance.hashes.review}`,
    `- Evaluator: ${run.provenance.evaluator}`,
    `- Adapter: ${run.provenance.adapter}`,
    '',
    '## Reference evidence gate (v2 candidate answers)',
    '',
    'The gate tracks the v2 candidate reference answers. It does not describe the v1 reference answers used for the scores above.',
    '',
    `- v2 candidate answers SHA-256: ${candidate?.candidateSha256 || 'not recorded'}`,
    `- Evidence stage: ${evidence.stage}`,
    `- Final release eligible: ${evidence.finalReleaseEligible ? 'yes' : 'no'}`,
    `- Missing evidence: ${evidence.missing.join(', ') || 'none'}`,
    '',
    'Hashes identify the original exported inputs. They do not prove reviewer independence, adjudication, or legal accuracy.');
  return `${lines.join('\n')}\n`;
}

/** Keep original English evidence byte-for-byte; only the presentation is translated. */
export function renderReport(item: BenchmarkCase, run: Evaluation, context: ReportContext, locale: Locale = 'en'): string {
  if (locale === 'en') return englishReport(item, run, context);
  const scores = run.scores, evidence = context.referenceEvidence;
  const canonical = (key: string) => canonicalClause(item.gold.clause_aliases, key);
  const candidate = evidence.cases.find(entry => entry.case === item.id);
  const lines = ['# Contract Review Evidence Lab', '',
    `Vertrag: ${caseTitle(locale, item.id, item.title)}`, `Szenario: ${scenarioTitle(locale, run.scenario)}`,
    `Auswertung: ${run.scoredAt || 'Referenz-Snapshot'}`, 'Bewertung: v1-Referenzantworten; v2-Nachweisstand gesondert ausgewiesen.',
    `Prüfperspektive (englische Originalvorgabe): ${item.gold.review_context?.party || 'Nicht angegeben'}`, '',
    'Dieser Bericht bewertet eine feste synthetische Prüfung. Es wurde kein Live-Modell aufgerufen. Gefundene Zitate belegen keine rechtliche Richtigkeit. Alle Zitate, Referenzbegründungen und Prüfungsausgaben bleiben im englischen Original erhalten.', '',
    '## Zusammenfassung', '', ...localizedReadout(item.gold, run.review, scores, locale).map(point => `- ${point.title}. ${point.detail}`), '', '## Kennzahlen', '',
    ...(['clause_f1', 'risk_precision', 'risk_recall', 'risk_severity_accuracy', 'citation_grounding'] as const).map(key => `- ${metricTitle(locale, key)}: ${displayMetric(key, scores, run.review).value}`),
    `- Gefundene Zitate: ${scores.citation_grounded} von ${scores.citation_total}`, `- Textabdeckung: ${percent(scores.span_coverage)}`, `- Unbelegte Zitate: ${scores.hallucination_count}`, `- Übersehene Referenzrisiken: ${scores.risk_missed.length}`, `- Zusätzliche Risikohinweise: ${scores.risk_false_positives.length}`, `- Widersprüchliche Schweregrade: ${scores.risk_conflicting_flags.length}`, '',
    'N/A bedeutet, dass für diese Kennzahl keine Beobachtungen vorliegen. JSON enthält weiterhin die mit Python kompatiblen numerischen Werte.', '', '## Klauselabdeckung'];
  for (const clause of clauseFindings(item.gold, run.review)) lines.push(`- ${label(locale, clause.key)}: ${statusText(locale, clause.status)}; Referenz: ${clause.expected ? 'ja' : 'nein'}; Originalbezeichnung: ${clause.reportedAs.join(', ') || 'keine'}${clause.abstentions.length ? `; Enthaltung (englisches Original): ${clause.abstentions.map(value => value.reason).join(' | ')}` : ''}`);
  lines.push('', '## Feststellungen und Belege');
  for (const finding of riskFindings(item.gold, run.review, scores)) {
    lines.push('', `### ${label(locale, finding.key)}`, '', `- Feststellung: ${statusText(locale, finding.status)}${finding.gap < 0 ? ' (unterschätzt)' : finding.gap > 0 ? ' (überschätzt)' : ''}`, `- Referenzschweregrad: ${severityText(locale, finding.expected)}`, `- Schweregrad der Prüfung: ${finding.severities.map(value => severityText(locale, value)).join(', ') || 'keiner'}`, `- Referenzbegründung (englisches Original): ${item.gold.severity_rationale[finding.key] || 'Kein Referenzrisiko.'}`);
    const flags = run.review.risk_flags.filter(flag => canonical(flag.clause_type) === finding.key);
    if (flags.length) for (const flag of flags) lines.push(`- Begründung der Prüfung (englisches Original, ${severityText(locale, flag.severity)}): ${flag.rationale}`);
    else lines.push('- Die Prüfung hat keinen Risikohinweis abgegeben.');
    lines.push(`- Zugeordnete Zitate: ${run.review.citations.filter(citation => canonical(citation.clause_type) === finding.key).length} (siehe Zitatverzeichnis).`);
  }
  lines.push('', '## Zitatverzeichnis', '', `Alle ${run.review.citations.length} Zitate der Prüfung im unveränderten englischen Original.`);
  if (!run.review.citations.length) lines.push('', 'Es wurden keine Zitate angegeben.');
  for (const [index, citation] of run.review.citations.entries()) lines.push('', `### ${index + 1}. ${label(locale, canonical(citation.clause_type))}`, '', `Status: ${locateSource(item.source, citation.quote) !== null ? 'Im Vertrag gefunden' : 'Nicht im Vertrag gefunden'}`, '', ...citation.quote.split('\n').map(line => `> ${line}`));
  lines.push('', '## Herkunft', '', `- Harness-Repository: ${context.repository}`, `- Harness-Quellstand: ${run.provenance.sourceCommit}`, `- Quellvertrag SHA-256: ${run.provenance.hashes.source}`, `- Bewertete v1-Referenzantworten SHA-256: ${run.provenance.hashes.gold}`, `- Ursprüngliche Beispielprüfung SHA-256: ${run.provenance.hashes.review}`, `- Bewertungsverfahren: ${run.provenance.evaluator}`, `- Adapter: ${run.provenance.adapter}`, '', '## Nachweisstand der v2-Kandidaten', '', 'Dieser Nachweisstand betrifft die v2-Kandidaten, nicht die oben bewerteten v1-Referenzantworten.', '', `- v2-Kandidaten SHA-256: ${candidate?.candidateSha256 || 'nicht erfasst'}`, `- Nachweisstand: ${label(locale, evidence.stage)}`, `- Referenzstand zur Freigabe geeignet: ${evidence.finalReleaseEligible ? 'ja' : 'nein'}`, `- Fehlende Nachweise: ${evidence.missing.map(key => label(locale, key)).join(', ') || 'keine'}`, '', 'Hashes belegen die Identität der Originaleingaben. Sie beweisen weder die Unabhängigkeit der Prüfer noch eine Abstimmung oder rechtliche Richtigkeit.');
  return `${lines.join('\n')}\n`;
}
