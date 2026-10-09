import type benchmark from './benchmark';
import type { BenchmarkCase, Evaluation } from './evaluation';
import { locateSource, scenarios } from './scoring.ts';
import { canonicalClause, clauseFindings, clauseLabel as title, displayMetric, readout, riskFindings, type RiskFinding } from './inspection.ts';

/** Export metadata the report needs. Passed in so the report stays loadable by the Node test runner. */
export type ReportContext = Pick<typeof benchmark, 'repository' | 'referenceEvidence'>;

const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
const findingText = (finding: RiskFinding) => finding.gap < 0 ? `${finding.status} (under-rated)` : finding.gap > 0 ? `${finding.status} (over-rated)` : finding.status;

export function renderReport(item: BenchmarkCase, run: Evaluation, context: ReportContext): string {
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
