import benchmark from './benchmark';
import type { Evaluation } from './evaluation';
import { locateSource, scenarios } from './scoring';

type BenchmarkCase = (typeof benchmark.cases)[number];

const title = (key: string) => key.replaceAll('_', ' ').replace(/^./, character => character.toUpperCase());
const percent = (value: number) => `${(value * 100).toFixed(1)}%`;

export function riskFindings(item: BenchmarkCase, run: Evaluation) {
  const expected = item.gold.risk_flags;
  return [...new Set([...Object.keys(expected), ...run.review.risk_flags.map(flag => flag.clause_type)])].map(key => {
    const predicted = run.review.risk_flags.find(flag => flag.clause_type === key)?.severity;
    const status = run.scores.risk_conflicting_flags.includes(key) ? 'Conflict'
      : !expected[key] ? 'Extra flag'
      : !predicted ? 'Missed'
      : predicted !== expected[key] ? 'Severity mismatch'
      : 'Match';
    return { key, expected: expected[key], predicted, status };
  });
}

export function renderReport(item: BenchmarkCase, run: Evaluation): string {
  const scores = run.scores;
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
    '## Scores',
    '',
    `- Clause F1: ${percent(scores.clause_f1)}`,
    `- Risk precision: ${percent(scores.risk_precision)}`,
    `- Risk recall: ${percent(scores.risk_recall)}`,
    `- Severity accuracy: ${percent(scores.risk_severity_accuracy)}`,
    `- Citation grounding: ${percent(scores.citation_grounding)} (${scores.citation_grounded} of ${scores.citation_total})`,
    `- Source span coverage: ${percent(scores.span_coverage)}`,
    `- Ungrounded quotations: ${scores.hallucination_count}`,
    `- Missed reference risks: ${scores.risk_missed.length}`,
    `- Extra risk flags: ${scores.risk_false_positives.length}`,
    `- Contradictory severities: ${scores.risk_conflicting_flags.length}`,
    '',
    '## Findings and evidence',
  ];

  for (const finding of riskFindings(item, run)) {
    lines.push('', `### ${title(finding.key)}`, '',
      `- Finding: ${finding.status}`,
      `- Reference severity: ${finding.expected || 'none'}`,
      `- Review severity: ${finding.predicted || 'none'}`,
      `- Reference rationale: ${item.gold.severity_rationale[finding.key] || 'No reference risk flag for this clause.'}`);
    const flags = run.review.risk_flags.filter(flag => flag.clause_type === finding.key);
    if (flags.length) {
      for (const flag of flags) lines.push(`- Review reasoning (${flag.severity}): ${flag.rationale}`);
    } else {
      lines.push('- Review reasoning: No risk flag supplied.');
    }
    const citationCount = run.review.citations.filter(citation => citation.clause_type === finding.key).length;
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
    `- Harness repository: ${benchmark.repository}`,
    `- Harness source commit: ${run.provenance.sourceCommit}`,
    `- Source contract SHA-256: ${run.provenance.hashes.source}`,
    `- Reference answers SHA-256: ${run.provenance.hashes.gold}`,
    `- Original review fixture SHA-256: ${run.provenance.hashes.review}`,
    `- Evaluator: ${run.provenance.evaluator}`,
    `- Adapter: ${run.provenance.adapter}`,
    '',
    'Hashes identify the original exported inputs. They do not prove reviewer independence, adjudication, or legal accuracy.');
  return `${lines.join('\n')}\n`;
}
