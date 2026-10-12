import { Fragment, type ReactNode } from 'react';
import replayDryRunExperiment from '@/public/candidates/experiments/replay-dry-run/experiment.json';
import replayDryRunReport from '@/public/candidates/experiments/replay-dry-run/report.json';
import replayDryRunProvenance from '@/public/candidates/experiments/replay-dry-run/provenance.json';
import replayDryRunCommercialBaseR1 from '@/public/candidates/experiments/replay-dry-run/attempts/baseline/commercial-base-r1.json';
import { experimentFileText, verifyExperimentBundle, type Arm, type Cell, type ExperimentBundle, type VerifiedExperiment } from '@/lib/candidate-experiment';
import { copy, type Locale } from '@/lib/i18n';
import type { SearchParams } from '@/lib/view';
import { PrintControls } from '@/components/lab/print-controls';

// Allowlist. An experiment is addressable only after scripts/export-candidate-experiment.py copied
// it into public/candidates/experiments and its files are imported here. Nothing is fetched by id.
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
const NA = 'N/A';
const single = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;
/** A share or delta as the Python report prints it: 1.0 stays 1.0 and 0.75 stays 0.75. Nothing is rounded. */
const stated = (value: number | null | undefined) => value === null || value === undefined ? NA : Number.isInteger(value) ? value.toFixed(1) : String(value);
const filePath = (id: string, file: string) => `/candidates/experiments/${id}/${file.split('/').map(encodeURIComponent).join('/')}`;

function Wide({ label, children }: { label: string; children: ReactNode }) {
  return <div className="table-scroll" tabIndex={0} role="region" aria-label={label}>{children}</div>;
}

function CellTable({ arm, cells, t }: { arm: Arm; cells: Cell[]; t: Translate }) {
  // A zero denominator is stated as such and never as a share.
  const of = (valid: number, checked: number) => `${checked === 0 ? `${NA} (` : ''}${valid} ${t('of', 'von')} ${checked}${checked === 0 ? ')' : ''}`;
  return <Wide label={t(`Cells of arm ${arm.id}; scroll horizontally`, `Zellen des Arms ${arm.id}; horizontal scrollbar`)}>
    <table className="data-table candidate-table">
      <caption className="sr-only">{t(`Every planned cell of arm ${arm.id} with its denominators`, `Jede geplante Zelle des Arms ${arm.id} mit ihren Nennern`)}</caption>
      <thead><tr>
        <th scope="col">{t('Cell (playbook / variant)', 'Zelle (Playbook / Variante)')}</th>
        <th scope="col">{t('Planned', 'Geplant')}</th>
        <th scope="col">{t('Observed', 'Beobachtet')}</th>
        <th scope="col">{t('Not run', 'Nicht ausgeführt')}</th>
        <th scope="col">{t('Completed', 'Abgeschlossen')}</th>
        <th scope="col">{t('Refused', 'Verweigert')}</th>
        <th scope="col">{t('Failed', 'Fehlgeschlagen')}</th>
        <th scope="col">{t('Validation: accepted', 'Validierung: akzeptiert')}</th>
        <th scope="col">{t('Validation: rejected', 'Validierung: abgelehnt')}</th>
        <th scope="col">{t('Findings', 'Feststellungen')}</th>
        <th scope="col">{t('Duplicates', 'Duplikate')}</th>
        <th scope="col">{t('Quotation valid', 'Zitat gültig')}</th>
        <th scope="col">{t('Missing-clause structure valid', 'Struktur bei fehlender Klausel gültig')}</th>
        <th scope="col">{t('Playbook reference valid', 'Playbook-Verweis gültig')}</th>
        <th scope="col">{t('Precision', 'Präzision')}</th>
        <th scope="col">Recall</th>
      </tr></thead>
      <tbody>{cells.map(({ playbook, variant, summary }) => {
        const match = summary.issueMatch;
        return <tr key={`${playbook}/${variant}`}>
          <th scope="row">{playbook} / {variant}</th>
          <td>{summary.planned}</td>
          <td>{summary.observed}</td>
          <td>{summary.missingObservations}</td>
          <td>{summary.completed}</td>
          <td>{summary.refused}</td>
          <td>{summary.failed}</td>
          <td>{summary.validationAccepted}</td>
          <td>{summary.validationRejected}</td>
          <td>{summary.findings}</td>
          <td>{summary.duplicates}</td>
          <td>{of(summary.quotationValid, summary.quotationDenominator)}</td>
          <td>{of(summary.missingClauseValid, summary.missingClauseDenominator)}</td>
          <td>{of(summary.playbookReferenceValid, summary.findings)}</td>
          <td>{match ? `${stated(match.microPrecision)} (TP ${match.truePositives}, FP ${match.falsePositives})` : NA}</td>
          <td>{match ? `${stated(match.microRecall)} (TP ${match.truePositives}, FN ${match.falseNegatives})` : NA}</td>
        </tr>;
      })}</tbody>
    </table>
  </Wide>;
}

function ArmSection({ arm, index, verified, t }: { arm: Arm; index: number; verified: VerifiedExperiment; t: Translate }) {
  const { design } = verified.experiment;
  const cells = verified.report.cells.filter(cell => cell.arm === arm.id);
  const injectionCells = cells.filter(cell => design.injectionVariants.includes(cell.variant));
  const usageCells = cells.filter(cell => cell.summary.usage.attemptsWithUsage > 0);
  const hold = arm.budgetReservation;
  return <section className="candidate-finding" aria-labelledby={`arm-${index}`}>
    <h3 id={`arm-${index}`}>Arm <code>{arm.id}</code> ({arm.role})</h3>
    <dl className="candidate-provenance">
      <dt>{t('Prompt version', 'Prompt-Version')}</dt><dd>{arm.promptVersion}</dd>
      <dt>{t('Code revision', 'Codestand')}</dt><dd>{arm.codeRevision}</dd>
      <dt>{t('Model label', 'Modellbezeichnung')}</dt><dd>{arm.model}</dd>
    </dl>
    {arm.role === 'ITERATION' && <>
      <p><strong>{t('Change (English source):', 'Änderung (englisches Original):')}</strong> <span lang="en">{arm.change}</span></p>
      <p><strong>{t('Hypothesis (English source):', 'Hypothese (englisches Original):')}</strong> <span lang="en">{arm.hypothesis}</span></p>
    </>}
    {hold
      ? <p><strong>{t('Budget reservation', 'Budgetreservierung')} <code>{hold.ledgerEntryId}</code>:</strong> {hold.amountMinorUnits} {t(`EUR minor units (cents), recorded on ${hold.recordedOn}. This is the hold the experiment file names for this arm. It is an upper estimate; the provider invoice remains authoritative. Whether the reservation is open, settled or voided is recorded in the harness spend ledger (spend-ledger.json), which is outside this bundle.`, `EUR in kleinster Währungseinheit (Cent), erfasst am ${hold.recordedOn}. Das ist der Betrag, den die Experimentdatei für diesen Arm als Reservierung nennt. Er ist ein oberer Schätzwert; maßgeblich bleibt die Rechnung des Anbieters. Ob die Reservierung offen, abgerechnet oder storniert ist, steht im Ausgabenbuch des Harness (spend-ledger.json), das nicht Teil dieses Pakets ist.`)}</p>
      : <p>{t('No budget reservation is bound to this arm.', 'An diesen Arm ist keine Budgetreservierung gebunden.')}</p>}
    <CellTable arm={arm} cells={cells} t={t} />
    {injectionCells.map(({ playbook, variant, summary }) => <p key={`${playbook}/${variant}`}>
      <strong>{t('Injection variant', 'Injektionsvariante')} {playbook} / {variant}.</strong>{' '}
      {summary.observed > 0
        ? t(`Attempts completed with zero findings: ${summary.followedInjection} of ${summary.observed} observed. The report counts such an attempt as following the injected instruction. Findings anchored on the final paragraph: ${summary.appendixAnchored}.`, `Ohne Feststellung abgeschlossene Versuche: ${summary.followedInjection} von ${summary.observed} beobachteten. Der Bericht zählt einen solchen Versuch als Befolgen der eingeschleusten Anweisung. Im letzten Absatz verankerte Feststellungen: ${summary.appendixAnchored}.`)
        : t('No attempt was observed, so no injection count is shown.', 'Es wurde kein Versuch beobachtet; eine Injektionszählung entfällt.')}
    </p>)}
    {usageCells.length === 0
      ? <p>{t('No attempt in this arm reported provider usage.', 'Kein Versuch dieses Arms hat einen Anbieterverbrauch gemeldet.')}</p>
      : <>
        <p>{t('Provider-reported usage. Token counts cover the attempts that reported usage; the second column states how many. Billed output tokens include thinking tokens.', 'Vom Anbieter gemeldeter Verbrauch. Die Token-Zahlen erfassen die Versuche mit gemeldetem Verbrauch; die zweite Spalte nennt deren Anzahl. Abgerechnete Ausgabe-Token schließen Thinking-Token ein.')}</p>
        <Wide label={t(`Provider-reported usage of arm ${arm.id}; scroll horizontally`, `Vom Anbieter gemeldeter Verbrauch des Arms ${arm.id}; horizontal scrollbar`)}>
          <table className="data-table candidate-table">
            <caption className="sr-only">{t(`Provider-reported token usage per cell of arm ${arm.id}`, `Vom Anbieter gemeldeter Token-Verbrauch je Zelle des Arms ${arm.id}`)}</caption>
            <thead><tr>
              <th scope="col">{t('Cell (playbook / variant)', 'Zelle (Playbook / Variante)')}</th>
              <th scope="col">{t('Attempts with usage', 'Versuche mit Verbrauch')}</th>
              <th scope="col">{t('Input tokens', 'Eingabe-Token')}</th>
              <th scope="col">{t('Billed output tokens', 'Abgerechnete Ausgabe-Token')}</th>
            </tr></thead>
            <tbody>{usageCells.map(({ playbook, variant, summary }) => <tr key={`${playbook}/${variant}`}>
              <th scope="row">{playbook} / {variant}</th>
              <td>{summary.usage.attemptsWithUsage} {t('of', 'von')} {summary.observed}</td>
              <td>{summary.usage.inputTokens}</td>
              <td>{summary.usage.outputTokens}</td>
            </tr>)}</tbody>
          </table>
        </Wide>
      </>}
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
  const cellNames = design.playbooks.flatMap(playbook => design.variants.map(variant => ({ playbook, variant, key: `${playbook}/${variant}` })));
  const withoutUsage = attempts.filter(attempt => attempt.row.usage === null);
  const comparisonNotes = [...new Set(report.comparisons.flatMap(item => item.comparable ? [item.note] : []))];

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
        : <p><strong>{t('LIVE: the recorded attempts are retained model outputs.', 'LIVE: Die aufgezeichneten Versuche sind aufbewahrte Modellausgaben.')}</strong> {t(`Sample size: each arm plans ${design.playbooks.length} playbooks × ${design.variants.length} document variants × ${design.repetitions} repetitions. The figures below state how many attempts were recorded and how many were not run. Read every rate together with its denominator.`, `Stichprobenumfang: Je Arm sind ${design.playbooks.length} Playbooks × ${design.variants.length} Dokumentvarianten × ${design.repetitions} Wiederholungen geplant. Die folgenden Angaben nennen, wie viele Versuche aufgezeichnet und wie viele nicht ausgeführt wurden. Jede Quote ist zusammen mit ihrem Nenner zu lesen.`)}</p>}
      <dl className="candidate-summary">
        <div><dt>{t('Recorded attempts in this bundle', 'Aufgezeichnete Versuche im Paket')}</dt><dd>{attempts.length}</dd></div>
        <div><dt>{t('Planned attempt files not run', 'Geplante Versuchsdateien, nicht ausgeführt')}</dt><dd>{report.missingAttemptFiles.length}</dd></div>
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
        <dt>{t('Repetitions per cell and arm', 'Wiederholungen je Zelle und Arm')}</dt><dd>{design.repetitions}</dd>
        <dt>{t('Arms', 'Arme')}</dt><dd>{experiment.arms.map(arm => `${arm.id} (${arm.role})`).join(', ')}</dd>
        <dt>{t('Distinct input combinations observed', 'Beobachtete unterschiedliche Eingabekombinationen')}</dt><dd>{report.distinctInputKeys}</dd>
      </dl>
      <p>{t('An input combination is one document, one playbook, the business instructions and the mode. The harness compares arms only on identical inputs.', 'Eine Eingabekombination besteht aus Dokument, Playbook, Prüfvorgaben und Modus. Der Harness vergleicht Arme nur bei identischen Eingaben.')}</p>
      {experiment.notes && <p><strong>{t('Notes in the experiment file (English source):', 'Anmerkungen in der Experimentdatei (englisches Original):')}</strong> <span lang="en">{experiment.notes}</span></p>}

      <h2>{t('References', 'Referenzen')}</h2>
      <p>{t('A reference lists the issues an annotator expects for one playbook and one document variant. DRAFT means the reference has not been independently reviewed; precision and recall against it describe agreement with a draft. The harness maintainer sets INDEPENDENTLY_REVIEWED together with an evidence reference, and this page cannot verify the reviewer. A cell with no registered reference has no issue precision or recall; both appear as N/A.', 'Eine Referenz nennt die Feststellungen, die ein Annotator für ein Playbook und eine Dokumentvariante erwartet. DRAFT bedeutet: Die Referenz ist nicht unabhängig geprüft; Präzision und Recall beschreiben dann die Übereinstimmung mit einem Entwurf. Den Status INDEPENDENTLY_REVIEWED setzt der Betreuer des Harness zusammen mit einem Nachweisverweis; diese Seite kann den Prüfer nicht verifizieren. Eine Zelle ohne registrierte Referenz hat weder Präzision noch Recall der Feststellungen; beide erscheinen als N/A.')}</p>
      {experiment.references.length === 0 && <p><strong>{t('No reference is registered in this experiment. Issue precision and recall are unavailable in every cell.', 'In diesem Experiment ist keine Referenz registriert. Präzision und Recall der Feststellungen sind in keiner Zelle verfügbar.')}</strong></p>}
      <Wide label={t('Reference status per cell; scroll horizontally', 'Referenzstatus je Zelle; horizontal scrollbar')}>
        <table className="data-table candidate-table">
          <caption className="sr-only">{t('Reference status for every playbook and document variant', 'Referenzstatus für jedes Playbook und jede Dokumentvariante')}</caption>
          <thead><tr>
            <th scope="col">{t('Cell (playbook / variant)', 'Zelle (Playbook / Variante)')}</th>
            <th scope="col">Status</th>
            <th scope="col">{t('Expected issues', 'Erwartete Feststellungen')}</th>
            <th scope="col">{t('Reviewer evidence', 'Prüfernachweis')}</th>
            <th scope="col">{t('File', 'Datei')}</th>
          </tr></thead>
          <tbody>{cellNames.map(({ playbook, variant, key }) => {
            const reference = Object.hasOwn(report.references, key) ? report.references[key] : null;
            const slot = experiment.references.find(item => item.playbook === playbook && item.variant === variant);
            return <tr key={key}>
              <th scope="row">{playbook} / {variant}</th>
              <td>{reference ? reference.status : t('No reference registered', 'Keine Referenz registriert')}</td>
              <td>{reference ? reference.expectedIssues : NA}</td>
              <td>{reference ? reference.reviewerEvidence ?? t('None stated', 'Nicht angegeben') : NA}</td>
              <td>{slot ? <a className="link-button" download href={filePath(id, slot.file)}>{t('Reference JSON', 'Referenz-JSON')}</a> : NA}</td>
            </tr>;
          })}</tbody>
        </table>
      </Wide>

      <h2>{t('Arms and cells', 'Arme und Zellen')}</h2>
      <p>{t('Each table row is one cell. “Not run” counts planned attempts without a recording. Refused and failed attempts remain observed attempts and contribute no findings. “Validation” is the application’s own check of the output; the Python evaluator retains rejected output and checks every finding. The quotation, missing-clause and playbook columns state valid of checked. Precision and recall carry their counts: TP for matched findings, FP for findings without a match, FN for expected issues without a matching finding. N/A marks a denominator of zero or a measure without a reference.', 'Jede Tabellenzeile ist eine Zelle. „Nicht ausgeführt“ zählt geplante Versuche ohne Aufzeichnung. Verweigerte und fehlgeschlagene Versuche bleiben beobachtete Versuche und tragen keine Feststellungen bei. „Validierung“ ist die eigene Ausgabeprüfung der Anwendung; die Python-Auswertung behält abgelehnte Ausgaben und prüft jede Feststellung. Die Spalten zu Zitat, fehlender Klausel und Playbook-Verweis nennen gültige von geprüften Fällen. Präzision und Recall nennen ihre Zählwerte: TP für zugeordnete Feststellungen, FP für Feststellungen ohne Zuordnung, FN für erwartete Feststellungen ohne passende Feststellung. N/A kennzeichnet einen Nenner von null oder eine Kennzahl ohne Referenz.')}</p>
      {experiment.arms.map((arm, index) => <ArmSection key={arm.id} arm={arm} index={index} verified={verified} t={t} />)}

      <h2>{t('Comparison: iteration against baseline', 'Vergleich: Iteration gegenüber Ausgangsarm')}</h2>
      {report.comparisons.length === 0
        ? <p>{t('This experiment has no iteration arm. No comparison is drawn.', 'Dieses Experiment hat keinen Iterationsarm. Es wird kein Vergleich gezogen.')}</p>
        : <>
          <p>{t('Each value is the iteration figure minus the baseline figure, as the Python report states it. The report compares arms on identical inputs and requires a completed attempt in both arms; a row that fails this carries the stated reason and no value. N/A marks a difference the report does not state.', 'Jeder Wert ist der Wert der Iteration abzüglich des Werts des Ausgangsarms, wie ihn der Python-Bericht angibt. Der Bericht vergleicht Arme bei identischen Eingaben und verlangt in beiden Armen einen abgeschlossenen Versuch; eine Zeile, die das nicht erfüllt, nennt den angegebenen Grund und keinen Wert. N/A kennzeichnet eine Differenz, die der Bericht nicht angibt.')}</p>
          <Wide label={t('Comparison of iteration and baseline; scroll horizontally', 'Vergleich von Iteration und Ausgangsarm; horizontal scrollbar')}>
            <table className="data-table candidate-table">
              <caption className="sr-only">{t('Differences between iteration and baseline per cell', 'Differenzen zwischen Iteration und Ausgangsarm je Zelle')}</caption>
              <thead><tr>
                <th scope="col">{t('Cell (playbook / variant)', 'Zelle (Playbook / Variante)')}</th>
                <th scope="col">{t('Baseline arm', 'Ausgangsarm')}</th>
                <th scope="col">{t('Iteration arm', 'Iterationsarm')}</th>
                <th scope="col">{t('Comparable', 'Vergleichbar')}</th>
                <th scope="col">{t('Precision', 'Präzision')}</th>
                <th scope="col">Recall</th>
                <th scope="col">{t('Quotation validity', 'Zitatgültigkeit')}</th>
                <th scope="col">{t('Playbook reference validity', 'Gültigkeit der Playbook-Verweise')}</th>
                <th scope="col">{t('Duplicate rate', 'Duplikatquote')}</th>
                <th scope="col">{t('Completion rate', 'Abschlussquote')}</th>
              </tr></thead>
              <tbody>{report.comparisons.map(item => <tr key={`${item.iteration}/${item.playbook}/${item.variant}`}>
                <th scope="row">{item.playbook} / {item.variant}</th>
                <td>{item.baseline}</td>
                <td>{item.iteration}</td>
                {item.comparable
                  ? <>
                    <td>{t('Yes', 'Ja')}</td>
                    <td>{stated(item.deltas.microPrecision)}</td>
                    <td>{stated(item.deltas.microRecall)}</td>
                    <td>{stated(item.deltas.quotationValidityRate)}</td>
                    <td>{stated(item.deltas.playbookValidityRate)}</td>
                    <td>{stated(item.deltas.duplicateRate)}</td>
                    <td>{stated(item.deltas.completionRate)}</td>
                  </>
                  : <><td>{t('No', 'Nein')}</td><td colSpan={6} lang="en">{item.reason}</td></>}
              </tr>)}</tbody>
            </table>
          </Wide>
          {comparisonNotes.map(note => <p key={note} className="source-language" lang="en">{note}</p>)}
        </>}

      <h2>{t('Recorded attempts', 'Aufgezeichnete Versuche')}</h2>
      <p>{t('Each recording is the complete retained attempt: document anchors, playbook, business instructions, run metadata and native output. The recording hash is the SHA-256 of the canonical JSON form. This page recomputed it and compared it with the report.', 'Jede Aufzeichnung enthält den vollständigen aufbewahrten Versuch: Dokumentanker, Playbook, Prüfvorgaben, Laufdaten und native Ausgabe. Der Aufzeichnungs-Hash ist der SHA-256 der kanonischen JSON-Form. Diese Seite hat ihn neu berechnet und mit dem Bericht verglichen.')}</p>
      {attempts.length === 0
        ? <p><strong>{t('No attempt was recorded.', 'Es wurde kein Versuch aufgezeichnet.')}</strong></p>
        : <Wide label={t('Recorded attempts; scroll horizontally', 'Aufgezeichnete Versuche; horizontal scrollbar')}>
          <table className="data-table candidate-table">
            <caption className="sr-only">{t('Every recorded attempt with outcome, validation, recording hash and download', 'Jeder aufgezeichnete Versuch mit Ausgang, Validierung, Aufzeichnungs-Hash und Download')}</caption>
            <thead><tr>
              <th scope="col">{t('Attempt (arm / playbook / variant / repetition)', 'Versuch (Arm / Playbook / Variante / Wiederholung)')}</th>
              <th scope="col">{t('Outcome', 'Ausgang')}</th>
              <th scope="col">{t('Application validation', 'Anwendungsvalidierung')}</th>
              <th scope="col">{t('Findings', 'Feststellungen')}</th>
              <th scope="col">{t('Started at', 'Beginn')}</th>
              <th scope="col">{t('Elapsed (ms)', 'Dauer (ms)')}</th>
              <th scope="col">{t('Working tree at capture', 'Arbeitsverzeichnis bei Aufzeichnung')}</th>
              <th scope="col">{t('Provider usage', 'Anbieterverbrauch')}</th>
              <th scope="col">{t('Canonical recording SHA-256', 'SHA-256 der kanonischen Aufzeichnung')}</th>
              <th scope="col">{t('File', 'Datei')}</th>
            </tr></thead>
            <tbody>{attempts.map(({ arm, playbook, variant, row, recording }) => <tr key={row.file}>
              <th scope="row">{arm} / {playbook} / {variant} / {row.repetition}</th>
              <td>{row.outcome}</td>
              <td>{row.validation}{row.validationError && <> (<code>{row.validationError}</code>)</>}</td>
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
      {attempts.some(attempt => attempt.recording.run.workingTreeDirty) && <p>{t('Dirty means uncommitted changes were present at capture. The recorded commit alone cannot reproduce such an attempt.', 'Geändert bedeutet: Bei der Aufzeichnung lagen nicht eingecheckte Änderungen vor. Der aufgezeichnete Commit allein reproduziert einen solchen Versuch nicht.')}</p>}
      {withoutUsage.length > 0 && <>
        <p className="source-language">{t('Reason each recording states for missing provider usage, as unchanged English source:', 'Grund, den die jeweilige Aufzeichnung für den fehlenden Anbieterverbrauch nennt, im unveränderten englischen Original:')}</p>
        <ul>{withoutUsage.map(({ row, recording }) => <li key={row.file}><code>{row.file}</code>: <span lang="en">{recording.run.usageUnavailableReason}</span></li>)}</ul>
      </>}
      {report.missingAttemptFiles.length > 0 && <details>
        <summary>{t('Planned attempt files not run', 'Geplante, nicht ausgeführte Versuchsdateien')} ({report.missingAttemptFiles.length})</summary>
        <ul>{report.missingAttemptFiles.map(file => <li key={file}><code>{file}</code></li>)}</ul>
      </details>}

      <h2>{t('Rules and caveats from the report', 'Regeln und Vorbehalte aus dem Bericht')}</h2>
      <p className="source-language">{t('The matching rule, the injection rule and the caveats below are the unchanged English source text of the Python report.', 'Zuordnungsregel, Injektionsregel und Vorbehalte stehen nachfolgend im unveränderten englischen Originaltext des Python-Berichts.')}</p>
      <h3>{t('Matching rule', 'Zuordnungsregel')}</h3>
      <p lang="en">{report.rules.matching}</p>
      <h3>{t('Injection rule', 'Injektionsregel')}</h3>
      <p lang="en">{report.rules.injection}</p>
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
        {Object.entries(provenance.files).map(([name, hash]) => <Fragment key={name}><dt>{t('Copied file', 'Kopierte Datei')} {name}</dt><dd>{hash}</dd></Fragment>)}
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
