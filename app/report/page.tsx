import { catalog, findCase, snapshot } from '@/lib/evaluation';
import { parseView, viewQuery, type SearchParams } from '@/lib/view';
import { renderReport } from '@/lib/report';
import { copy } from '@/lib/i18n';
import type { Scenario } from '@/lib/scoring';
import benchmark from '@/lib/benchmark';
import { PrintControls } from '@/components/lab/print-controls';
export default async function ReportPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const view = parseView(await searchParams, catalog);
  const back = `/${viewQuery({...view, guided:false}, {caseId:catalog.cases[0].id, scenario:'baseline'})}`;
  if (view.edition && view.edition !== benchmark.sourceCommit) return <main className="print-report" lang={view.locale}><h1>{copy(view.locale,'Reference edition changed','Referenzstand geändert')}</h1><p>{copy(view.locale,'This historical report cannot be reproduced from the current edition. Return to the lab to inspect the current result.','Dieser historische Bericht lässt sich aus dem aktuellen Referenzstand nicht reproduzieren. Im Lab kann das aktuelle Ergebnis geprüft werden.')}</p><a href={back}>{copy(view.locale,'Open the lab','Lab öffnen')}</a></main>;
  const run = snapshot(view.caseId, view.scenario as Scenario);
  const report = renderReport(findCase(view.caseId), run, benchmark, view.locale);
  // Each report section remains one reading unit when printed. A section
  // longer than a complete page can still flow across the page boundary.
  const groups: { finding: boolean; lines: string[] }[] = [];
  for (const line of report.split('\n')) {
    if (!groups.length || /^#{1,3} /.test(line)) groups.push({ finding: line.startsWith('### '), lines: [] });
    groups.at(-1)!.lines.push(line);
  }
  return <main className="print-report" lang={view.locale}><PrintControls locale={view.locale} back={back} /><article>{groups.map((group, groupIndex) => <section key={groupIndex} className={group.finding ? 'report-finding' : undefined}>{group.lines.map((line, index) => {
    if (!line) return null;
    if (line.startsWith('### ')) return <h3 key={index}>{line.slice(4)}</h3>;
    if (line.startsWith('## ')) return <h2 key={index}>{line.slice(3)}</h2>;
    if (line.startsWith('# ')) return <h1 key={index}>{line.slice(2)}</h1>;
    if (line.startsWith('> ')) return <blockquote key={index} lang="en">{line.slice(2)}</blockquote>;
    return <p key={index} className={line.startsWith('- ') ? 'report-line' : undefined}>{line.startsWith('- ') ? line.slice(2) : line}</p>;
  })}</section>)}</article></main>;
}
