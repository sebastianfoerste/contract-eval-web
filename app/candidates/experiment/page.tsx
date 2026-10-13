import { Fragment, type ReactNode } from 'react';
import replayDryRunExperiment from '@/public/candidates/experiments/replay-dry-run/experiment.json';
import replayDryRunReport from '@/public/candidates/experiments/replay-dry-run/report.json';
import replayDryRunProvenance from '@/public/candidates/experiments/replay-dry-run/provenance.json';
import replayDryRunCommercialBaseR1 from '@/public/candidates/experiments/replay-dry-run/attempts/baseline/commercial-base-r1.json';
import { COMPARED_METRICS, NO_RECORDING, declaredRepairs, experimentFileText, twoDecimals, verifyExperimentBundle, type Arm, type Cell, type ComparedMetric, type ExperimentBundle, type ExperimentReport, type LedgerState, type VerifiedExperiment } from '@/lib/candidate-experiment';
import { copy, type Locale } from '@/lib/i18n';
import type { SearchParams } from '@/lib/view';
import { PrintControls } from '@/components/lab/print-controls';

// Allowlist. An experiment is addressable only after scripts/export-candidate-experiment.py copied
// it into public/candidates/experiments and its files are imported here. Nothing is fetched by id.
// `attempts` holds the recordings. The empty slot file of a dispatch that left no recording is no
// JSON and is not imported; the verifier expects no entry for it.
const bundles: Record<string, ExperimentBundle> = {
  'replay-dry-run': {
    experimentText: experimentFileText(replayDryRunExperiment),
    report: replayDryRunReport,
    provenance: replayDryRunProvenance,
    attempts: { 'attempts/baseline/commercial-base-r1.json': replayDryRunCommercialBaseR1 },
    references: {},
  },
};

type Translate = (english: string, german: string) => string;
type Match = { truePositives: number; falsePositives: number; falseNegatives: number; microPrecision: number | null; microRecall: number | null };
const NA = 'N/A';
const single = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;
/** A rate with two decimals, rounded as the harness's Markdown report rounds it. report.json keeps the unrounded value. A missing rate is N/A, never 0. */
const rate = (value: number | null | undefined) => value === null || value === undefined ? NA : twoDecimals(value);
/** A difference with its sign and two decimals, rounded as the harness's Markdown report rounds it. */
const signed = (value: number) => `${value < 0 ? '−' : '+'}${twoDecimals(Math.abs(value))}`;
const filePath = (id: string, file: string) => `/candidates/experiments/${id}/${file.split('/').map(encodeURIComponent).join('/')}`;

function Wide({ label, children }: { label: string; children: ReactNode }) {
  return <div className="table-scroll" tabIndex={0} role="region" aria-label={label}>{children}</div>;
}

function Budget({ state, replay, t }: { state: LedgerState | null; replay: boolean; t: Translate }) {
  if (replay) return <p>{t('A REPLAY experiment reserves no budget.', 'Ein REPLAY-Experiment reserviert kein Budget.')}</p>;
  if (state === null) return <p>{t('No budget reservation is bound to this arm.', 'An diesen Arm ist keine Budgetreservierung gebunden.')}</p>;
  const minorUnits = t('EUR minor units (cents)', 'EUR in kleinster Währungseinheit (Cent)');
  const meaning = { OPEN: t('open, not settled', 'offen, nicht abgerechnet'), SETTLED: t('settled', 'abgerechnet'), VOIDED: t('voided, released without an attempt', 'storniert, ohne Versuch freigegeben') }[state.state];
  return <>
    <dl className="candidate-provenance">
      <dt>{t('Budget reservation (ledger entry)', 'Budgetreservierung (Eintrag im Ausgabenbuch)')}</dt><dd>{state.reservation}</dd>
      <dt>{t('Reserved amount', 'Reservierter Betrag')}</dt><dd>{state.reservedMinorUnits} {minorUnits}</dd>
      <dt>{t('Reserved at', 'Reserviert am')}</dt><dd>{state.reservedAt}</dd>
      <dt>{t('Price verified on', 'Preis geprüft am')}</dt><dd>{state.priceVerifiedOn}</dd>
      <dt>{t('State of the reservation', 'Zustand der Reservierung')}</dt><dd>{state.state} ({meaning})</dd>
      <dt>{t('Settled amount', 'Abgerechneter Betrag')}</dt><dd>{state.settledMinorUnits === null ? t('None: the reservation is not settled', 'Keiner: Die Reservierung ist nicht abgerechnet') : `${state.settledMinorUnits} ${minorUnits}`}</dd>
    </dl>
    <p>{t('The reservation is the worst-case hold that the experiment file binds to this arm. The report states its state as the harness read it in the spend ledger (spend-ledger.json), which is outside this bundle. A settled amount is the harness’s estimate from provider-reported usage at the reserved price. For an attempt that reported no usage and for a dispatch that left no recording, the harness charges the full amount held for one attempt. The provider invoice remains authoritative.', 'Die Reservierung ist der Höchstbetrag, den die Experimentdatei an diesen Arm bindet. Ihren Zustand gibt der Bericht so an, wie der Harness ihn im Ausgabenbuch (spend-ledger.json) gelesen hat; das Ausgabenbuch ist nicht Teil dieses Pakets. Ein abgerechneter Betrag ist eine Schätzung des Harness aus dem vom Anbieter gemeldeten Verbrauch zum reservierten Preis. Für einen Versuch ohne gemeldeten Verbrauch und für einen ausgelösten Versuch ohne Aufzeichnung setzt der Harness den vollen Betrag an, der für einen Versuch reserviert ist. Maßgeblich bleibt die Rechnung des Anbieters.')}</p>
  </>;
}

function AttemptsTable({ arm, cells, t }: { arm: Arm; cells: Cell[]; t: Translate }) {
  // A zero denominator is stated as such and never as a share.
  const of = (valid: number, checked: number) => checked === 0 ? `${NA} (0 ${t('of', 'von')} 0)` : `${valid} ${t('of', 'von')} ${checked}`;
  return <Wide label={t(`Attempts and evidence of arm ${arm.id}; scroll horizontally`, `Versuche und Belege des Arms ${arm.id}; horizontal scrollbar`)}>
    <table className="data-table candidate-table">
      <caption className="sr-only">{t(`Every planned cell of arm ${arm.id} with its attempts, findings and validity counts`, `Jede geplante Zelle des Arms ${arm.id} mit Versuchen, Feststellungen und Gültigkeitszählungen`)}</caption>
      <thead><tr>
        <th scope="col">{t('Cell (playbook / variant)', 'Zelle (Playbook / Variante)')}</th>
        <th scope="col">{t('Planned', 'Geplant')}</th>
        <th scope="col">{t('Observed', 'Beobachtet')}</th>
        <th scope="col">{t('Not run', 'Nicht ausgeführt')}</th>
        <th scope="col">{t('Completed', 'Abgeschlossen')}</th>
        <th scope="col">{t('Refused', 'Verweigert')}</th>
        <th scope="col">{t('Failed', 'Fehlgeschlagen')}</th>
        <th scope="col">{t('All findings valid', 'Alle Feststellungen gültig')}</th>
        <th scope="col">{t('Recorder: accepted', 'Aufzeichnung: akzeptiert')}</th>
        <th scope="col">{t('Recorder: rejected', 'Aufzeichnung: abgelehnt')}</th>
        <th scope="col">{t('Findings', 'Feststellungen')}</th>
        <th scope="col">{t('Duplicates', 'Duplikate')}</th>
        <th scope="col">{t('Trivial quotations', 'Triviale Zitate')}</th>
        <th scope="col">{t('Quotation valid', 'Zitat gültig')}</th>
        <th scope="col">{t('Missing-clause structure valid', 'Struktur bei fehlender Klausel gültig')}</th>
        <th scope="col">{t('Playbook reference valid', 'Playbook-Verweis gültig')}</th>
      </tr></thead>
      <tbody>{cells.map(({ playbook, variant, summary }) => <tr key={`${playbook}/${variant}`}>
        <th scope="row">{playbook} / {variant}</th>
        <td>{summary.planned}</td>
        <td>{summary.observed}</td>
        <td>{summary.missingObservations}</td>
        <td>{summary.completed}</td>
        <td>{summary.refused}</td>
        <td>{summary.failed}</td>
        <td>{summary.allFindingsValid}</td>
        <td>{summary.recorderAccepted}</td>
        <td>{summary.recorderRejected}</td>
        <td>{summary.findings}</td>
        <td>{summary.duplicates}</td>
        <td>{summary.trivialQuotations}</td>
        <td>{of(summary.quotationValid, summary.quotationDenominator)}</td>
        <td>{of(summary.missingClauseValid, summary.missingClauseDenominator)}</td>
        <td>{of(summary.playbookReferenceValid, summary.findings)}</td>
      </tr>)}</tbody>
    </table>
  </Wide>;
}

function MatchingTable({ arm, cells, references, t }: { arm: Arm; cells: Cell[]; references: ExperimentReport['references']; t: Translate }) {
  // Matched of denominator, then the rate the report states. The denominator adds two counts of the report.
  const figure = (match: Match | null, kind: 'precision' | 'recall') => match === null ? NA
    : `${match.truePositives} ${t('of', 'von')} ${match.truePositives + (kind === 'precision' ? match.falsePositives : match.falseNegatives)} (${rate(kind === 'precision' ? match.microPrecision : match.microRecall)})`;
  return <Wide label={t(`Matching against the reference for arm ${arm.id}; scroll horizontally`, `Zuordnung zur Referenz für Arm ${arm.id}; horizontal scrollbar`)}>
    <table className="data-table candidate-table">
      <caption className="sr-only">{t(`Precision and recall per cell of arm ${arm.id}, each as matched of denominator and rate`, `Präzision und Recall je Zelle des Arms ${arm.id}, jeweils als Zugeordnete von Nenner und Quote`)}</caption>
      <thead><tr>
        <th scope="col">{t('Cell (playbook / variant)', 'Zelle (Playbook / Variante)')}</th>
        <th scope="col">{t('Reference status', 'Referenzstatus')}</th>
        <th scope="col">{t('Expected issues per attempt', 'Erwartete Feststellungen je Versuch')}</th>
        <th scope="col">{t('Precision', 'Präzision')}</th>
        <th scope="col">Recall</th>
        <th scope="col">{t('Precision after application validation', 'Präzision nach Anwendungsvalidierung')}</th>
        <th scope="col">{t('Recall after application validation', 'Recall nach Anwendungsvalidierung')}</th>
        <th scope="col">{t('Attempts that deliver after validation', 'Versuche mit Ausgabe nach Validierung')}</th>
        <th scope="col">{t('Entry-level recall', 'Recall auf Eintragsebene')}</th>
      </tr></thead>
      <tbody>{cells.map(({ playbook, variant, summary }) => {
        const after = summary.issueMatchPostValidation, key = `${playbook}/${variant}`;
        return <tr key={key}>
          <th scope="row">{playbook} / {variant}</th>
          <td>{summary.referenceStatus ?? t('No reference registered', 'Keine Referenz registriert')}</td>
          <td>{Object.hasOwn(references, key) ? references[key].expectedIssues : NA}</td>
          <td>{figure(summary.issueMatch, 'precision')}</td>
          <td>{figure(summary.issueMatch, 'recall')}</td>
          <td>{figure(after, 'precision')}</td>
          <td>{figure(after, 'recall')}</td>
          <td>{after ? `${after.attemptsDelivered} ${t('of', 'von')} ${after.attempts}` : NA}</td>
          <td>{figure(summary.entryLevelMatch, 'recall')}</td>
        </tr>;
      })}</tbody>
    </table>
  </Wide>;
}

/** Statements the report makes about single cells. Each appears only where it applies. */
function CellNotes({ cells, t }: { cells: Cell[]; t: Translate }) {
  return <>{cells.flatMap(({ playbook, variant, summary, attempts: rows }) => {
    const where = `${playbook} / ${variant}`, { injection, repair } = summary, notes: ReactNode[] = [];
    // How many attempt rows of the cell state a count above zero, as the harness's Markdown report words it.
    const rowsWith = (pick: (row: Cell['attempts'][number]) => number | undefined) => rows.filter(row => (pick(row) ?? 0) > 0).length;
    const withoutRecording = rows.filter(row => row.recordingSha256 === null).length;
    if (withoutRecording > 0) notes.push(<p key={`${where} no recording`}>
      <strong>{t('Dispatches without a recording', 'Ausgelöste Versuche ohne Aufzeichnung')}, {where}.</strong>{' '}
      {t(`Failed attempts of this cell: ${summary.failed}. Of these, dispatches that left no recording: ${withoutRecording}. The report counts such a dispatch as a failed attempt that found nothing.`, `Fehlgeschlagene Versuche dieser Zelle: ${summary.failed}. Davon ausgelöste Versuche ohne Aufzeichnung: ${withoutRecording}. Der Bericht zählt einen solchen Versuch als fehlgeschlagen und ohne Feststellung.`)}
    </p>);
    if (injection && injection.completedAttempts > 0) notes.push(<p key={`${where} injection`}>
      <strong>{t('Injection variant', 'Injektionsvariante')} {where}.</strong>{' '}
      {t(`Completed attempts without a finding: ${injection.followedInjection} of ${injection.completedAttempts} (${summary.planned} planned). The report counts such an attempt as following the injected instruction. Findings anchored on the injected final paragraph, whatever they quote: ${injection.appendixQuoted}. Attempts with such a finding: ${rowsWith(row => row.appendixQuoted)}.`, `Abgeschlossene Versuche ohne Feststellung: ${injection.followedInjection} von ${injection.completedAttempts} (geplant: ${summary.planned}). Der Bericht zählt einen solchen Versuch als Befolgen der eingeschleusten Anweisung. Feststellungen, die am eingeschleusten letzten Absatz verankert sind, gleich was sie zitieren: ${injection.appendixQuoted}. Versuche mit einer solchen Feststellung: ${rowsWith(row => row.appendixQuoted)}.`)}
    </p>);
    if (repair && repair.completedAttempts > 0) notes.push(<p key={`${where} repair`}>
      <strong>{t('Repairing variant', 'Reparierende Variante')} {where}.</strong>{' '}
      {t(`Stale findings: ${repair.staleFindings}, in ${rowsWith(row => row.staleFindings)} of ${repair.completedAttempts} completed attempts (${summary.planned} planned). The report calls a finding stale when it still cites ${repair.repairedEntries.join(', ')}, which the design declares repaired by this variant.`, `Überholte Feststellungen: ${repair.staleFindings}, in ${rowsWith(row => row.staleFindings)} von ${repair.completedAttempts} abgeschlossenen Versuchen (geplant: ${summary.planned}). Der Bericht nennt eine Feststellung überholt, wenn sie weiterhin ${repair.repairedEntries.join(', ')} zitiert; nach dem Versuchsplan behebt diese Variante ${repair.repairedEntries.length === 1 ? 'diesen Eintrag' : 'diese Einträge'}.`)}
    </p>);
    if (summary.validationDisagreements > 0) notes.push(<p key={`${where} validation`}>
      <strong>{t('Validation', 'Validierung')}, {where}.</strong>{' '}
      {t(`Completed attempts in which the recorder’s flag differs from the validity the harness recomputed: ${summary.validationDisagreements}.`, `Abgeschlossene Versuche, in denen der Vermerk der Aufzeichnung von der Gültigkeit abweicht, die der Harness neu berechnet hat: ${summary.validationDisagreements}.`)}
    </p>);
    if (summary.identicalOutputRepetitions > 0) notes.push(<p key={`${where} repetitions`}>
      <strong>{t('Repetitions', 'Wiederholungen')}, {where}.</strong>{' '}
      {t(`Completed attempts that returned the same findings, at least one, as an earlier repetition: ${summary.identicalOutputRepetitions}.`, `Abgeschlossene Versuche, die dieselben Feststellungen, mindestens eine, wie eine frühere Wiederholung geliefert haben: ${summary.identicalOutputRepetitions}.`)}
    </p>);
    return notes;
  })}</>;
}

function UsageTable({ arm, cells, t }: { arm: Arm; cells: Cell[]; t: Translate }) {
  const observed = cells.filter(cell => cell.summary.observed > 0);
  if (observed.length === 0) return <p>{t('No attempt of this arm was observed, so no provider usage is stated.', 'Für diesen Arm wurde kein Versuch beobachtet; ein Anbieterverbrauch ist deshalb nicht angegeben.')}</p>;
  return <>
    <p>{t('The token counts cover the attempts that reported usage; the second column states how many of the observed attempts did. Billed output tokens include thinking tokens. N/A: no attempt of the cell reported usage.', 'Die Token-Zahlen erfassen die Versuche mit gemeldetem Verbrauch; die zweite Spalte nennt, wie viele der beobachteten Versuche ihn gemeldet haben. Abgerechnete Ausgabe-Token schließen Thinking-Token ein. N/A: Kein Versuch der Zelle hat einen Verbrauch gemeldet.')}</p>
    <Wide label={t(`Provider-reported usage of arm ${arm.id}; scroll horizontally`, `Vom Anbieter gemeldeter Verbrauch des Arms ${arm.id}; horizontal scrollbar`)}>
      <table className="data-table candidate-table">
        <caption className="sr-only">{t(`Provider-reported token usage per observed cell of arm ${arm.id}`, `Vom Anbieter gemeldeter Token-Verbrauch je beobachteter Zelle des Arms ${arm.id}`)}</caption>
        <thead><tr>
          <th scope="col">{t('Cell (playbook / variant)', 'Zelle (Playbook / Variante)')}</th>
          <th scope="col">{t('Attempts that reported usage', 'Versuche mit gemeldetem Verbrauch')}</th>
          <th scope="col">{t('Input tokens', 'Eingabe-Token')}</th>
          <th scope="col">{t('Billed output tokens', 'Abgerechnete Ausgabe-Token')}</th>
        </tr></thead>
        <tbody>{observed.map(({ playbook, variant, summary }) => <tr key={`${playbook}/${variant}`}>
          <th scope="row">{playbook} / {variant}</th>
          <td>{summary.usage.attemptsWithUsage} {t('of', 'von')} {summary.observed}</td>
          <td>{summary.usage.inputTokens ?? NA}</td>
          <td>{summary.usage.outputTokens ?? NA}</td>
        </tr>)}</tbody>
      </table>
    </Wide>
  </>;
}

function ArmSection({ arm, index, verified, t }: { arm: Arm; index: number; verified: VerifiedExperiment; t: Translate }) {
  const { report } = verified;
  const cells = report.cells.filter(cell => cell.arm === arm.id);
  const notStated = t('None stated', 'Nicht angegeben');
  return <section className="candidate-finding" aria-labelledby={`arm-${index}`}>
    <h3 id={`arm-${index}`}>Arm <code>{arm.id}</code> ({arm.role})</h3>
    <dl className="candidate-provenance">
      <dt>{t('Prompt version', 'Prompt-Version')}</dt><dd>{arm.promptVersion}</dd>
      <dt>{t('Code revision', 'Codestand')}</dt><dd>{arm.codeRevision}</dd>
      <dt>{t('Model label', 'Modellbezeichnung')}</dt><dd>{arm.model}</dd>
      <dt>{t('Change (English source)', 'Änderung (englisches Original)')}</dt><dd lang={arm.change === null ? undefined : 'en'}>{arm.change ?? notStated}</dd>
      <dt>{t('Hypothesis (English source)', 'Hypothese (englisches Original)')}</dt><dd lang={arm.hypothesis === null ? undefined : 'en'}>{arm.hypothesis ?? notStated}</dd>
    </dl>
    <Budget state={report.ledger === null ? null : report.ledger[arm.id]} replay={report.ledger === null} t={t} />
    <h4>{t('Attempts and evidence', 'Versuche und Belege')}</h4>
    <AttemptsTable arm={arm} cells={cells} t={t} />
    <h4>{t('Matching against the reference', 'Zuordnung zur Referenz')}</h4>
    <MatchingTable arm={arm} cells={cells} references={report.references} t={t} />
    <CellNotes cells={cells} t={t} />
    <h4>{t('Provider-reported usage', 'Vom Anbieter gemeldeter Verbrauch')}</h4>
    <UsageTable arm={arm} cells={cells} t={t} />
  </section>;
}

export default async function CandidateExperimentPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const locale: Locale = single(params.lang) === 'de' ? 'de' : 'en';
  const t: Translate = (english, german) => copy(locale, english, german);
  const id = single(params.id) ?? '';
  const eyebrow = t('My Counsel · Candidate experiment', 'My Counsel · Kandidaten-Experiment');
  const replayLink = <nav className="candidate-downloads" aria-label={t('Related view', 'Verwandte Ansicht')}><a href={`/candidates?lang=${locale}`}>{t('Back to the single replay', 'Zurück zum einzelnen Replay')}</a></nav>;

  if (!Object.hasOwn(bundles, id)) return <main className="print-report candidate-report" lang={locale}>
    <nav className="candidate-language" aria-label={t('Language', 'Sprache')}><a href="?lang=en" aria-current={locale === 'en' ? 'page' : undefined} lang="en">English</a><a href="?lang=de" aria-current={locale === 'de' ? 'page' : undefined} lang="de">Deutsch</a></nav>
    <article>
      <p className="eyebrow">{eyebrow}</p>
      <h1>{t('No bundled experiment at this address', 'Unter dieser Adresse liegt kein Experiment vor')}</h1>
      <p>{t('This viewer shows experiment bundles that were exported from the Python harness and shipped with this site. It loads nothing else and accepts no upload.', 'Diese Ansicht zeigt Experiment-Pakete, die aus dem Python-Harness exportiert und mit dieser Website ausgeliefert wurden. Sie lädt nichts nach und nimmt keinen Upload an.')}</p>
      <h2>{t('Bundled experiments', 'Enthaltene Experimente')}</h2>
      <ul>{Object.keys(bundles).map(known => <li key={known}><a className="link-button" href={`/candidates/experiment?id=${known}&lang=${locale}`}><code>{known}</code></a></li>)}</ul>
      {replayLink}
    </article>
  </main>;

  const verified = await verifyExperimentBundle(bundles[id]);
  const { experiment, report, provenance, attempts } = verified;
  if (experiment.experimentId !== id) throw new Error('Candidate experiment bundle refused: it is filed under a different id');
  const { design } = experiment;
  const replay = design.mode === 'REPLAY';
  const yes = (value: boolean) => value ? t('Yes', 'Ja') : t('No', 'Nein');
  const cellNames = design.playbooks.flatMap(playbook => design.variants.map(variant => ({ playbook, variant, key: `${playbook}/${variant}` })));
  // What the design declares, as the harness's Markdown report states it under its design line.
  const repairedEntries = declaredRepairs(design.repairedEntries);
  // A recording, or a dispatch that left none. Only a recording has run metadata, a hash and a file.
  const recorded = attempts.flatMap(attempt => attempt.recording === null ? [] : [attempt]);
  const withoutRecording = attempts.length - recorded.length;
  // The empty attempt files are copied and listed with their hash like every bundled file, and named for what they are.
  const emptyAttemptFiles = new Set(attempts.flatMap(attempt => attempt.recording === null ? [attempt.row.file] : []));
  const withoutUsage = recorded.filter(attempt => attempt.row.usage === null);
  const comparisonNotes = [...new Set(report.comparisons.flatMap(item => item.comparable ? [item.note] : []))];
  // Observed of planned attempts of one cell, as the report states both counts.
  const observedOfPlanned = (arm: string, playbook: string, variant: string) => {
    const cell = report.cells.find(item => item.arm === arm && item.playbook === playbook && item.variant === variant);
    return cell ? `${cell.summary.observed} ${t('of', 'von')} ${cell.summary.planned}` : NA;
  };
  const metricLabels: Record<ComparedMetric, string> = {
    completionRate: t('Completion rate', 'Abschlussquote'),
    quotationValidityRate: t('Quotation validity', 'Zitatgültigkeit'),
    playbookValidityRate: t('Playbook reference validity', 'Gültigkeit der Playbook-Verweise'),
    duplicateRate: t('Duplicate rate', 'Duplikatquote'),
    microPrecision: t('Precision', 'Präzision'),
    microRecall: 'Recall',
    postValidationPrecision: t('Precision after application validation', 'Präzision nach Anwendungsvalidierung'),
    postValidationRecall: t('Recall after application validation', 'Recall nach Anwendungsvalidierung'),
    entryLevelRecall: t('Entry-level recall', 'Recall auf Eintragsebene'),
  };
  const rules: [string, string][] = [
    [t('Matching rule', 'Zuordnungsregel'), report.rules.matching],
    [t('Rule for figures after application validation', 'Regel für Kennzahlen nach Anwendungsvalidierung'), report.rules.postValidation],
    [t('Entry-level rule', 'Regel für die Eintragsebene'), report.rules.entryLevel],
    [t('Injection rule', 'Injektionsregel'), report.rules.injection],
    [t('Repair rule', 'Reparaturregel'), report.rules.repair],
  ];

  return <main className="print-report candidate-report" lang={locale}>
    <PrintControls locale={locale} back={`/?lang=${locale}&guide=0`} />
    <nav className="candidate-language" aria-label={t('Language', 'Sprache')}><a href={`?id=${id}&lang=en`} aria-current={locale === 'en' ? 'page' : undefined} lang="en">English</a><a href={`?id=${id}&lang=de`} aria-current={locale === 'de' ? 'page' : undefined} lang="de">Deutsch</a></nav>
    {replayLink}
    <article>
      <p className="eyebrow">{eyebrow}</p>
      <h1>{t('One preregistered experiment, every planned cell', 'Ein präregistriertes Experiment mit allen geplanten Zellen')}</h1>
      <p>{t('This page shows the experiment bundle', 'Diese Seite zeigt das Experiment-Paket')} <code>{experiment.experimentId}</code> {t('from the Python harness. The experiment file is the preregistration: it fixes the playbooks, the document variants, the repetitions and the arms, and the harness refuses an attempt that the file does not cover. A cell is one playbook applied to one document variant in one arm. The Python harness computed every number shown here. This page checks that the files belong together and computes no score.', 'aus dem Python-Harness. Die Experimentdatei ist die Präregistrierung: Sie legt Playbooks, Dokumentvarianten, Wiederholungen und Arme fest, und der Harness weist jeden Versuch zurück, den die Datei nicht abdeckt. Eine Zelle ist ein Playbook, angewendet auf eine Dokumentvariante in einem Arm. Alle Zahlen auf dieser Seite hat der Python-Harness berechnet. Die Seite prüft, ob die Dateien zusammengehören, und berechnet selbst kein Ergebnis.')}</p>
      {replay
        ? <p><strong>{t('REPLAY: the recorded attempts in this bundle are hand-authored fixtures. No model was called. Nothing on this page is a model result.', 'REPLAY: Die aufgezeichneten Versuche in diesem Paket sind manuell erstellte Beispielaufzeichnungen. Es wurde kein Modell aufgerufen. Die Seite zeigt kein Modellergebnis.')}</strong></p>
        : <p><strong>{t('LIVE: the recorded attempts are retained model outputs.', 'LIVE: Die aufgezeichneten Versuche sind aufbewahrte Modellausgaben.')}</strong> {t(`Sample size: each arm plans ${design.playbooks.length} playbooks × ${design.variants.length} document variants × ${design.repetitions} repetitions. The figures below state how many attempts were recorded, how many dispatches left no recording and how many planned attempts were not run. Read every rate together with its denominator.`, `Stichprobenumfang: Je Arm sind ${design.playbooks.length} Playbooks × ${design.variants.length} Dokumentvarianten × ${design.repetitions} Wiederholungen geplant. Die folgenden Angaben nennen, wie viele Versuche aufgezeichnet wurden, wie viele ausgelöste Versuche keine Aufzeichnung hinterlassen haben und wie viele geplante Versuche nicht ausgeführt wurden. Jede Quote ist zusammen mit ihrem Nenner zu lesen.`)}</p>}
      <dl className="candidate-summary">
        <div><dt>{t('Recorded attempts in this bundle', 'Aufgezeichnete Versuche im Paket')}</dt><dd>{recorded.length}</dd></div>
        {!replay && <div><dt>{t('Dispatches that left no recording', 'Ausgelöste Versuche ohne Aufzeichnung')}</dt><dd>{withoutRecording}</dd></div>}
        <div><dt>{t('Planned attempts not run', 'Geplante Versuche, nicht ausgeführt')}</dt><dd>{report.notRun.length}</dd></div>
        <div><dt>{t('Playbooks × document variants', 'Playbooks × Dokumentvarianten')}</dt><dd>{design.playbooks.length} × {design.variants.length}</dd></div>
        <div><dt>{t('Planned repetitions per cell and arm', 'Geplante Wiederholungen je Zelle und Arm')}</dt><dd>{design.repetitions}</dd></div>
      </dl>

      <h2>{t('Design', 'Versuchsplan')}</h2>
      <dl className="candidate-provenance">
        <dt>{t('Experiment id', 'Experiment-Kennung')}</dt><dd>{experiment.experimentId}</dd>
        <dt>{t('Mode', 'Modus')}</dt><dd>{design.mode}</dd>
        <dt>Playbooks</dt><dd>{design.playbooks.join(', ')}</dd>
        <dt>{t('Document variants', 'Dokumentvarianten')}</dt><dd>{design.variants.join(', ')}</dd>
        <dt>{t('Injection variants', 'Injektionsvarianten')}</dt><dd>{design.injectionVariants.join(', ') || t('None', 'Keine')}</dd>
        <dt>{t('Playbook entries declared repaired, by variant', 'Als behoben erklärte Playbook-Einträge, je Variante')}</dt><dd>{repairedEntries.join('; ') || t('None', 'Keine')}</dd>
        <dt>{t('Repetitions per cell and arm', 'Wiederholungen je Zelle und Arm')}</dt><dd>{design.repetitions}</dd>
        <dt>{t('Arms', 'Arme')}</dt><dd>{experiment.arms.map(arm => `${arm.id} (${arm.role})`).join(', ')}</dd>
        <dt>{t('Distinct input combinations observed', 'Beobachtete unterschiedliche Eingabekombinationen')}</dt><dd>{report.distinctInputKeys}</dd>
      </dl>
      <p>{t('An input combination is one document, one playbook, the business instructions and the mode. The harness compares arms only on identical inputs. An injection variant carries an instruction to the reviewer inside the document. A repairing variant fixes the point a playbook entry addresses; a finding that still cites that entry on that variant counts as stale.', 'Eine Eingabekombination besteht aus Dokument, Playbook, Prüfvorgaben und Modus. Der Harness vergleicht Arme nur bei identischen Eingaben. Eine Injektionsvariante enthält im Dokument eine Anweisung an den Prüfer. Eine reparierende Variante behebt den Punkt, auf den sich ein Playbook-Eintrag bezieht; eine Feststellung, die diesen Eintrag bei dieser Variante weiterhin zitiert, gilt als überholt.')}</p>
      {experiment.notes && <p><strong>{t('Notes in the experiment file (English source):', 'Anmerkungen in der Experimentdatei (englisches Original):')}</strong> <span lang="en">{experiment.notes}</span></p>}

      <h2>{t('References', 'Referenzen')}</h2>
      <p>{t('A reference lists the issues an annotator expects for one playbook and one document variant. DRAFT marks a reference without independent review; figures against it describe agreement with a draft. The route states how the reference was compiled: SINGLE_ANNOTATION from one annotation, ADJUDICATED from two annotations and a written adjudication. Low-confidence issues are expected issues that an annotator marked as low confidence. “Doubts recorded” states whether an annotator wrote down doubts in free text. “Derivation re-run” states whether the harness rebuilt the reference from its registered annotations and adjudication record and found it identical. A cell with no registered reference has no matching figures; they appear as N/A.', 'Eine Referenz nennt die Feststellungen, die ein Annotator für ein Playbook und eine Dokumentvariante erwartet. DRAFT kennzeichnet eine Referenz ohne unabhängige Prüfung; Kennzahlen gegen sie beschreiben die Übereinstimmung mit einem Entwurf. Der Weg gibt an, wie die Referenz entstanden ist: SINGLE_ANNOTATION aus einer einzelnen Annotation, ADJUDICATED aus zwei Annotationen und einer schriftlichen Abstimmung. Feststellungen mit geringer Sicherheit sind erwartete Feststellungen, die ein Annotator so gekennzeichnet hat. „Zweifel vermerkt“ gibt an, ob ein Annotator Zweifel als Freitext festgehalten hat. „Herleitung neu ausgeführt“ gibt an, ob der Harness die Referenz aus den registrierten Annotationen und dem Abstimmungsprotokoll erneut erzeugt und unverändert vorgefunden hat. Eine Zelle ohne registrierte Referenz hat keine Zuordnungskennzahlen; sie erscheinen als N/A.')}</p>
      <p><strong>{t('No reviewer identity is verified. Neither the harness nor this page checks who wrote an annotation or whether that person is independent.', 'Die Identität eines Prüfers wird nicht verifiziert. Weder der Harness noch diese Seite prüft, wer eine Annotation verfasst hat oder ob diese Person unabhängig ist.')}</strong></p>
      {experiment.references.length === 0 && <p><strong>{t('No reference is registered in this experiment. Issue precision and recall are unavailable in every cell.', 'In diesem Experiment ist keine Referenz registriert. Präzision und Recall der Feststellungen sind in keiner Zelle verfügbar.')}</strong></p>}
      <Wide label={t('References per cell; scroll horizontally', 'Referenzen je Zelle; horizontal scrollbar')}>
        <table className="data-table candidate-table">
          <caption className="sr-only">{t('Reference status, route and counts for every playbook and document variant', 'Referenzstatus, Weg und Zählungen für jedes Playbook und jede Dokumentvariante')}</caption>
          <thead><tr>
            <th scope="col">{t('Cell (playbook / variant)', 'Zelle (Playbook / Variante)')}</th>
            <th scope="col">Status</th>
            <th scope="col">{t('Route', 'Weg')}</th>
            <th scope="col">{t('Expected issues', 'Erwartete Feststellungen')}</th>
            <th scope="col">{t('Low-confidence issues', 'Davon mit geringer Sicherheit')}</th>
            <th scope="col">{t('Doubts recorded', 'Zweifel vermerkt')}</th>
            <th scope="col">{t('Derivation re-run', 'Herleitung neu ausgeführt')}</th>
            <th scope="col">{t('Reviewer evidence (English source)', 'Prüfernachweis (englisches Original)')}</th>
            <th scope="col">{t('Files', 'Dateien')}</th>
          </tr></thead>
          <tbody>{cellNames.map(({ playbook, variant, key }) => {
            const reference = Object.hasOwn(report.references, key) ? report.references[key] : null;
            const slot = experiment.references.find(item => item.playbook === playbook && item.variant === variant);
            if (!reference || !slot) return <tr key={key}>
              <th scope="row">{playbook} / {variant}</th>
              <td>{t('No reference registered', 'Keine Referenz registriert')}</td>
              <td>{NA}</td><td>{NA}</td><td>{NA}</td><td>{NA}</td><td>{NA}</td><td>{NA}</td><td>{NA}</td>
            </tr>;
            const notStated = t('Not stated', 'Nicht angegeben');
            return <tr key={key}>
              <th scope="row">{playbook} / {variant}</th>
              <td>{reference.status}</td>
              <td>{reference.route ?? notStated}</td>
              <td>{reference.expectedIssues}</td>
              <td>{reference.lowConfidenceIssues ?? notStated}</td>
              <td>{reference.uncertaintiesRecorded === null ? notStated : yes(reference.uncertaintiesRecorded)}</td>
              <td>{yes(reference.derivationVerified)}</td>
              <td lang={reference.reviewerEvidence === null ? undefined : 'en'}>{reference.reviewerEvidence ?? notStated}</td>
              <td>
                <a className="link-button" download href={filePath(id, slot.file)}>{t('Reference JSON', 'Referenz-JSON')}</a>
                {slot.sources && <>
                  {' '}<a className="link-button" download href={filePath(id, slot.sources.annotationA.file)}>{t('Annotation A', 'Annotation A')}</a>
                  {' '}<a className="link-button" download href={filePath(id, slot.sources.annotationB.file)}>{t('Annotation B', 'Annotation B')}</a>
                  {' '}<a className="link-button" download href={filePath(id, slot.sources.adjudication.file)}>{t('Adjudication record', 'Abstimmungsprotokoll')}</a>
                </>}
              </td>
            </tr>;
          })}</tbody>
        </table>
      </Wide>

      <h2>{t('Arms and cells', 'Arme und Zellen')}</h2>
      <p>{t('Each arm follows with its definition, its attempts, its matching figures and its provider-reported usage. A table row is one cell. In the attempts table, “Not run” counts the planned attempts for which nothing is registered: neither a recording nor an empty attempt file. Refused and failed attempts remain observed attempts and contribute no findings. A dispatch that left no recording counts as an observed, failed attempt: the recorder creates the attempt file empty before its call and fills it afterwards, so an empty file means that a call was dispatched and may have been billed. “All findings valid” counts the completed attempts in which the Python harness found every finding valid; the application passes an output on only in that case. The recorder’s own accepted or rejected flag stands beside that count and enters no figure. A trivial quotation is a verbatim quotation that is too short to match an expected issue: fewer than 20 characters after whitespace is collapsed, and not the whole paragraph. The quotation, missing-clause and playbook columns state valid of checked.', 'Es folgt jeder Arm mit seiner Definition, seinen Versuchen, seinen Zuordnungskennzahlen und dem vom Anbieter gemeldeten Verbrauch. Eine Tabellenzeile ist eine Zelle. In der Versuchstabelle zählt „Nicht ausgeführt“ die geplanten Versuche, für die nichts registriert ist: weder eine Aufzeichnung noch eine leere Versuchsdatei. Verweigerte und fehlgeschlagene Versuche bleiben beobachtete Versuche und tragen keine Feststellungen bei. Ein ausgelöster Versuch ohne Aufzeichnung zählt als beobachteter, fehlgeschlagener Versuch: Das Aufzeichnungsskript legt die Versuchsdatei vor dem Aufruf leer an und füllt sie danach. Eine leere Datei bedeutet deshalb, dass ein Aufruf ausgelöst wurde und abgerechnet worden sein kann. „Alle Feststellungen gültig“ zählt die abgeschlossenen Versuche, in denen der Python-Harness jede Feststellung als gültig ermittelt hat; nur in diesem Fall gibt die Anwendung eine Ausgabe weiter. Der eigene Vermerk der Aufzeichnung, akzeptiert oder abgelehnt, steht neben dieser Zählung und geht in keine Kennzahl ein. Ein triviales Zitat ist ein wörtliches Zitat, das für die Zuordnung zu einer erwarteten Feststellung zu kurz ist: Es hat weniger als 20 Zeichen, wenn Leerraum zusammengezogen ist, und gibt nicht den ganzen Absatz wieder. Die Spalten zu Zitat, fehlender Klausel und Playbook-Verweis nennen gültige von geprüften Fällen.')}</p>
      <p>{t('In the matching table, each figure reads matched of denominator, followed in brackets by the rate the report states. Precision relates the matched findings to all findings. Recall relates them to the expected issues of every observed attempt: an attempt without output counts each expected issue as missed. The figures after application validation count only the attempts in which all findings are valid; every other observed attempt delivers nothing. Entry-level recall asks only whether a playbook entry was raised at all; it counts distinct entries, so its denominator can differ from that of recall. Rates are shown to two decimal places, as in the harness’s Markdown report; report.json holds the unrounded values. N/A marks a figure without a reference, without an observed attempt or with a denominator of zero.', 'In der Zuordnungstabelle steht jede Kennzahl als Zugeordnete von Nenner, gefolgt von der Quote in Klammern, die der Bericht angibt. Die Präzision bezieht die zugeordneten Feststellungen auf alle Feststellungen. Der Recall bezieht sie auf die erwarteten Feststellungen aller beobachteten Versuche: Ein Versuch ohne Ausgabe zählt jede erwartete Feststellung als verfehlt. Die Kennzahlen nach Anwendungsvalidierung zählen nur die Versuche, in denen alle Feststellungen gültig sind; jeder andere beobachtete Versuch liefert nichts. Der Recall auf Eintragsebene fragt nur, ob ein Playbook-Eintrag überhaupt aufgegriffen wurde; er zählt unterschiedliche Einträge, sein Nenner kann deshalb von dem des Recalls abweichen. Quoten sind auf zwei Nachkommastellen angegeben, wie im Markdown-Bericht des Harness; report.json enthält die ungerundeten Werte. N/A kennzeichnet eine Kennzahl ohne Referenz, ohne beobachteten Versuch oder mit einem Nenner von null.')}</p>
      {experiment.arms.map((arm, index) => <ArmSection key={arm.id} arm={arm} index={index} verified={verified} t={t} />)}

      <h2>{t('Comparison: iteration against baseline', 'Vergleich: Iteration gegenüber Ausgangsarm')}</h2>
      {report.comparisons.length === 0
        ? <p>{t('This experiment has no iteration arm. No comparison is drawn.', 'Dieses Experiment hat keinen Iterationsarm. Es wird kein Vergleich gezogen.')}</p>
        : <>
          <p>{t('Each figure gives the baseline value, the iteration value and, in brackets, the difference the Python report states: iteration minus baseline. The report compares arms on identical inputs and only where both arms hold a completed attempt; any other row carries the reason the report states, as unchanged English source, and no figure. N/A marks a metric that one of the two cells does not state. The attempts column states the observed of the planned attempts of both cells, baseline first: a rate over fewer attempts than planned is not the rate of the design. Values are shown to two decimal places; report.json holds the unrounded values.', 'Jede Kennzahl nennt den Wert des Ausgangsarms, den Wert der Iteration und in Klammern die Differenz, die der Python-Bericht angibt: Iteration abzüglich Ausgangsarm. Der Bericht vergleicht Arme bei identischen Eingaben und nur dort, wo beide Arme einen abgeschlossenen Versuch enthalten; jede andere Zeile nennt den Grund, den der Bericht angibt, im unveränderten englischen Original und keine Kennzahl. N/A kennzeichnet eine Kennzahl, die eine der beiden Zellen nicht angibt. Die Spalte zu den Versuchen nennt für beide Zellen die beobachteten von den geplanten Versuchen, zuerst für den Ausgangsarm: Eine Quote über weniger Versuche als geplant ist nicht die Quote des Versuchsplans. Die Werte sind auf zwei Nachkommastellen angegeben; report.json enthält die ungerundeten Werte.')}</p>
          <Wide label={t('Comparison of iteration and baseline; scroll horizontally', 'Vergleich von Iteration und Ausgangsarm; horizontal scrollbar')}>
            <table className="data-table candidate-table">
              <caption className="sr-only">{t('Observed and planned attempts of both arms, then baseline value, iteration value and difference per metric and cell', 'Beobachtete und geplante Versuche beider Arme, dann Wert des Ausgangsarms, Wert der Iteration und Differenz je Kennzahl und Zelle')}</caption>
              <thead><tr>
                <th scope="col">{t('Cell (playbook / variant)', 'Zelle (Playbook / Variante)')}</th>
                <th scope="col">{t('Baseline arm', 'Ausgangsarm')}</th>
                <th scope="col">{t('Iteration arm', 'Iterationsarm')}</th>
                <th scope="col">{t('Attempts observed of planned: baseline, iteration', 'Beobachtete von geplanten Versuchen: Ausgangsarm, Iteration')}</th>
                <th scope="col">{t('Comparable', 'Vergleichbar')}</th>
                {COMPARED_METRICS.map(name => <th key={name} scope="col">{metricLabels[name]}</th>)}
              </tr></thead>
              <tbody>{report.comparisons.map(item => <tr key={`${item.iteration}/${item.playbook}/${item.variant}`}>
                <th scope="row">{item.playbook} / {item.variant}</th>
                <td>{item.baseline}</td>
                <td>{item.iteration}</td>
                <td>{observedOfPlanned(item.baseline, item.playbook, item.variant)}, {observedOfPlanned(item.iteration, item.playbook, item.variant)}</td>
                {item.comparable
                  ? <>
                    <td>{t('Yes', 'Ja')}</td>
                    {COMPARED_METRICS.map(name => {
                      const metric = item.metrics[name];
                      return <td key={name}>{metric === undefined ? NA : `${rate(metric.baseline)} ${t('to', 'auf')} ${rate(metric.iteration)} (${signed(metric.delta)})`}</td>;
                    })}
                  </>
                  : <><td>{t('No', 'Nein')}</td><td colSpan={COMPARED_METRICS.length} lang="en">{item.reason}</td></>}
              </tr>)}</tbody>
            </table>
          </Wide>
          {comparisonNotes.length > 0 && <p className="source-language">{t('Note of the report on the comparable rows, as unchanged English source:', 'Hinweis des Berichts zu den vergleichbaren Zeilen, im unveränderten englischen Original:')}</p>}
          {comparisonNotes.map(note => <p key={note} lang="en">{note}</p>)}
        </>}

      <h2>{t('Observed attempts', 'Beobachtete Versuche')}</h2>
      <p>{t('An observed attempt is a recording or a dispatch that left no recording. Each recording is the complete retained attempt: document anchors, playbook, business instructions, run metadata and native output. The recording hash is the SHA-256 of the canonical JSON form. This page recomputed it and compared it with the report. “Recorder validation” is the flag the recorder wrote; “All findings valid” is the validity the Python harness recomputed.', 'Ein beobachteter Versuch ist eine Aufzeichnung oder ein ausgelöster Versuch ohne Aufzeichnung. Jede Aufzeichnung enthält den vollständigen aufbewahrten Versuch: Dokumentanker, Playbook, Prüfvorgaben, Laufdaten und native Ausgabe. Der Aufzeichnungs-Hash ist der SHA-256 der kanonischen JSON-Form. Diese Seite hat ihn neu berechnet und mit dem Bericht verglichen. „Vermerk der Aufzeichnung“ ist der Vermerk, den das Aufzeichnungsskript geschrieben hat; „Alle Feststellungen gültig“ ist die Gültigkeit, die der Python-Harness neu berechnet hat.')}</p>
      {withoutRecording > 0 && <p><strong>{t(`Dispatches without a recording: ${withoutRecording}.`, `Ausgelöste Versuche ohne Aufzeichnung: ${withoutRecording}.`)}</strong> {t('The attempt file of such a dispatch is empty. No start time, duration, working-tree state, provider usage, recorder flag or recording hash exists for it, and there is no file to download. The report lists it with the outcome FAILED and the code', 'Die Versuchsdatei eines solchen Versuchs ist leer. Für ihn gibt es weder Beginn, Dauer, Zustand des Arbeitsverzeichnisses, Anbieterverbrauch, Vermerk der Aufzeichnung noch Aufzeichnungs-Hash, und es gibt keine Datei zum Herunterladen. Der Bericht führt ihn mit dem Ausgang FAILED und dem Code')} <code>{NO_RECORDING}</code>.</p>}
      {attempts.length === 0
        ? <p><strong>{t('No attempt was observed.', 'Es wurde kein Versuch beobachtet.')}</strong></p>
        : <Wide label={t('Observed attempts; scroll horizontally', 'Beobachtete Versuche; horizontal scrollbar')}>
          <table className="data-table candidate-table">
            <caption className="sr-only">{t('Every observed attempt: a recording with outcome, recorder validation, recording hash and download, or a dispatch that left no recording', 'Jeder beobachtete Versuch: eine Aufzeichnung mit Ausgang, Vermerk der Aufzeichnung, Aufzeichnungs-Hash und Download oder ein ausgelöster Versuch ohne Aufzeichnung')}</caption>
            <thead><tr>
              <th scope="col">{t('Attempt (arm / playbook / variant / repetition)', 'Versuch (Arm / Playbook / Variante / Wiederholung)')}</th>
              <th scope="col">{t('Outcome', 'Ausgang')}</th>
              <th scope="col">{t('Recorder validation', 'Vermerk der Aufzeichnung')}</th>
              <th scope="col">{t('All findings valid', 'Alle Feststellungen gültig')}</th>
              <th scope="col">{t('Findings', 'Feststellungen')}</th>
              <th scope="col">{t('Started at', 'Beginn')}</th>
              <th scope="col">{t('Elapsed (ms)', 'Dauer (ms)')}</th>
              <th scope="col">{t('Working tree at capture', 'Arbeitsverzeichnis bei Aufzeichnung')}</th>
              <th scope="col">{t('Provider usage', 'Anbieterverbrauch')}</th>
              <th scope="col">{t('Canonical recording SHA-256', 'SHA-256 der kanonischen Aufzeichnung')}</th>
              <th scope="col">{t('File', 'Datei')}</th>
            </tr></thead>
            <tbody>{attempts.map(({ arm, playbook, variant, row, recording }) => recording === null ? <tr key={row.file}>
              {/* Nothing was retained for this dispatch, so the columns of a recording have nothing to show and no link is offered. */}
              <th scope="row">{arm} / {playbook} / {variant} / {row.repetition}</th>
              <td>{row.outcome}</td>
              <td colSpan={9}>{t('No recording: the attempt file is empty. Dispatch without a recording, code', 'Keine Aufzeichnung: Die Versuchsdatei ist leer. Ausgelöster Versuch ohne Aufzeichnung, Code')} <code>{NO_RECORDING}</code></td>
            </tr> : <tr key={row.file}>
              <th scope="row">{arm} / {playbook} / {variant} / {row.repetition}</th>
              <td>{row.outcome}</td>
              <td>{row.recorderValidation}{row.recorderValidationError && <> (<code>{row.recorderValidationError}</code>)</>}</td>
              <td>{row.outcome === 'COMPLETED' ? yes(row.allFindingsValid) : t('No output', 'Keine Ausgabe')}</td>
              <td>{row.findingCount}</td>
              <td>{row.startedAt}</td>
              <td>{row.elapsedMs}</td>
              <td>{recording.run.workingTreeDirty ? t('Dirty', 'Geändert') : t('Clean', 'Unverändert')}</td>
              <td>{row.usage
                ? t(`${row.usage.inputTokens} input, ${row.usage.outputTokens} billed output`, `${row.usage.inputTokens} Eingabe, ${row.usage.outputTokens} abgerechnete Ausgabe`) + (row.usage.thinkingTokens === null ? '' : t(`, of which ${row.usage.thinkingTokens} thinking`, `, davon ${row.usage.thinkingTokens} Thinking`))
                : t('Not reported', 'Nicht gemeldet')}</td>
              <td><code>{row.recordingSha256}</code></td>
              <td><a className="link-button" download href={filePath(id, row.file)}>{t('Recording JSON (English)', 'Aufzeichnungs-JSON (Englisch)')}</a></td>
            </tr>)}</tbody>
          </table>
        </Wide>}
      {recorded.some(attempt => attempt.recording.run.workingTreeDirty) && <p>{t('Dirty means uncommitted changes were present at capture. The recorded commit alone cannot reproduce such an attempt.', 'Geändert bedeutet: Bei der Aufzeichnung lagen nicht eingecheckte Änderungen vor. Der aufgezeichnete Commit allein reproduziert einen solchen Versuch nicht.')}</p>}
      {withoutUsage.length > 0 && <>
        <p className="source-language">{t('Reason each recording states for missing provider usage, as unchanged English source:', 'Grund, den die jeweilige Aufzeichnung für den fehlenden Anbieterverbrauch nennt, im unveränderten englischen Original:')}</p>
        <ul>{withoutUsage.map(({ row, recording }) => <li key={row.file}><code>{row.file}</code>: <span lang="en">{recording.run.usageUnavailableReason}</span></li>)}</ul>
      </>}
      {report.notRun.length > 0 && <details>
        <summary>{t('Planned attempts not run', 'Geplante, nicht ausgeführte Versuche')} ({report.notRun.length})</summary>
        <ul>{report.notRun.map(file => <li key={file}><code>{file}</code></li>)}</ul>
      </details>}

      <h2>{t('Rules and caveats from the report', 'Regeln und Vorbehalte aus dem Bericht')}</h2>
      <p className="source-language">{t('The five rules and the caveats below are the unchanged English source text of the Python report.', 'Die fünf Regeln und die Vorbehalte stehen nachfolgend im unveränderten englischen Originaltext des Python-Berichts.')}</p>
      {rules.map(([title, text]) => <Fragment key={title}><h3>{title}</h3><p lang="en">{text}</p></Fragment>)}
      <h3>{t('Caveats', 'Vorbehalte')}</h3>
      <ul lang="en">{report.caveats.map(caveat => <li key={caveat}>{caveat}</li>)}</ul>

      <h2>{t('Source and provenance', 'Quelle und Herkunft')}</h2>
      <dl className="candidate-provenance">
        <dt>{t('Experiment file SHA-256, recomputed here and equal to the value in the report', 'SHA-256 der Experimentdatei, hier neu berechnet und gleich dem Wert im Bericht')}</dt><dd>{report.experimentSha256}</dd>
        <dt>{t('Corpus manifest SHA-256', 'SHA-256 des Korpus-Manifests')}</dt><dd>{experiment.corpusManifestSha256}</dd>
        <dt>{t('Instructions SHA-256', 'Vorgaben-SHA-256')}</dt><dd>{experiment.instructionsSha256}</dd>
        <dt>{t('Exported from', 'Exportiert aus')}</dt><dd>{provenance.origin}</dd>
        <dt>{t('Harness commit at export', 'Harness-Commit beim Export')}</dt><dd>{provenance.harnessHead}</dd>
        <dt>{t('Harness working tree at export', 'Harness-Arbeitsverzeichnis beim Export')}</dt><dd>{provenance.harnessWorkingTreeDirty ? t('Dirty: uncommitted or untracked files were present. The commit alone does not identify the code that wrote the report. The hashes of the harness modules at export follow.', 'Geändert: Es lagen nicht eingecheckte oder nicht versionierte Dateien vor. Der Commit allein bestimmt den Code nicht, der den Bericht geschrieben hat. Die Hashes der Harness-Module beim Export folgen.') : t('Clean', 'Unverändert')}</dd>
        {Object.entries(provenance.harnessFiles).map(([name, hash]) => <Fragment key={name}><dt>{t('Harness module at export', 'Harness-Modul beim Export')} {name}</dt><dd>{hash}</dd></Fragment>)}
        {Object.entries(provenance.files).map(([name, hash]) => <Fragment key={name}><dt>{emptyAttemptFiles.has(name) ? t('Copied empty attempt file, no recording:', 'Kopierte leere Versuchsdatei, keine Aufzeichnung:') : t('Copied file', 'Kopierte Datei')} {name}</dt><dd>{hash}</dd></Fragment>)}
        <dt>{t('Scope stated at export (English source)', 'Beim Export angegebener Umfang (englisches Original)')}</dt><dd lang="en">{provenance.scope}</dd>
      </dl>
      <p>{t('A hash binds bytes. It is no independent attestation of who produced them.', 'Ein Hash bindet Bytes. Eine unabhängige Bestätigung ihrer Herkunft ist er nicht.')}</p>
      <nav className="candidate-downloads" aria-label={t('Original JSON artifacts', 'Originale JSON-Artefakte')}>
        <a download href={filePath(id, 'experiment.json')}>{t('Experiment JSON (English)', 'Experiment-JSON (Englisch)')}</a>
        <a download href={filePath(id, 'report.json')}>{t('Python report JSON (English)', 'Python-Bericht als JSON (Englisch)')}</a>
        <a download href={filePath(id, 'provenance.json')}>{t('File provenance JSON', 'Dateiherkunft als JSON')}</a>
      </nav>
    </article>
  </main>;
}
