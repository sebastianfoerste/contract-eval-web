import run from '@/public/candidates/replay-run.json';
import score from '@/public/candidates/replay-score.json';
import provenance from '@/public/candidates/provenance.json';
import { verifyReplay } from '@/lib/candidate-replay';
import { copy, type Locale } from '@/lib/i18n';
import type { SearchParams } from '@/lib/view';
import { PrintControls } from '@/components/lab/print-controls';

export default async function CandidatesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const locale: Locale = params.lang === 'de' ? 'de' : 'en';
  const t = (en: string, de: string) => copy(locale, en, de);
  const rows = await verifyReplay(run, score);
  const state = (value: boolean | null) => value === null ? t('Not applicable', 'Nicht anwendbar') : value ? t('Valid', 'Gültig') : t('Invalid', 'Ungültig');
  return <main className="print-report candidate-report" lang={locale}>
    <PrintControls locale={locale} back={`/?lang=${locale}&guide=0`} />
    <nav className="candidate-language" aria-label={t('Language', 'Sprache')}><a href="?lang=en" aria-current={locale === 'en' ? 'page' : undefined} lang="en">English</a><a href="?lang=de" aria-current={locale === 'de' ? 'page' : undefined} lang="de">Deutsch</a></nav>
    <nav className="candidate-downloads" aria-label={t('Related view', 'Verwandte Ansicht')}><a href={`/candidates/experiment?id=replay-dry-run&lang=${locale}`}>{t('Open the preregistered experiment view: every planned cell with its denominators', 'Zur Ansicht des präregistrierten Experiments: jede geplante Zelle mit ihren Nennern')}</a></nav>
    <article>
      <p className="eyebrow">{t('My Counsel · Synthetic candidate replay', 'My Counsel · Synthetischer Kandidaten-Replay')}</p>
      <h1>{t('A quotation can be correct while its reference fails.', 'Ein korrektes Zitat kann auf eine ungültige Vorgabe verweisen.')}</h1>
      <p>{t('This hand-authored REPLAY demonstrates the native My Counsel candidate format and the separate Python evidence evaluator. It records no live model call and provides no benchmark accuracy result.', 'Dieser manuell erstellte REPLAY zeigt das native Kandidatenformat von My Counsel und die separate Python-Belegprüfung. Er enthält keinen Live-Modellaufruf und kein Genauigkeitsergebnis eines Benchmarks.')}</p>
      <aside className="edition-warning"><strong>{t('Application validation: rejected', 'Anwendungsvalidierung: abgelehnt')}</strong><p>{t('The recorded attempt completed, but the application rejected the output because one playbook reference was unsupported. The Python evaluator retains every finding so the failure remains inspectable.', 'Der aufgezeichnete Versuch wurde abgeschlossen. Die Anwendung hat die Ausgabe wegen eines nicht unterstützten Playbook-Verweises abgelehnt. Die Python-Auswertung erhält alle Feststellungen, damit der Fehler nachvollziehbar bleibt.')}</p><code>{run.validation.errorCode}</code></aside>
      <dl className="candidate-summary">
        <div><dt>{t('Candidates retained', 'Erhaltene Kandidaten')}</dt><dd>{score.findingCount}</dd></div>
        <div><dt>{t('Duplicate candidates', 'Doppelte Kandidaten')}</dt><dd>{score.duplicateCount}</dd></div>
        <div><dt>{t('Exact quotation checks', 'Exakte Zitatprüfungen')}</dt><dd>{score.quotationValid} / {score.quotationDenominator}</dd></div>
        <div><dt>{t('Playbook reference checks', 'Playbook-Verweisprüfungen')}</dt><dd>{score.playbookReferenceValid} / {score.findingCount}</dd></div>
      </dl>
      <p>{t('Duplicates use the playbook reference, anchor and missing-clause flag. A valid quote only establishes that the text occurs in its recorded paragraph. A valid missing-clause shape only checks the anchor structure; it does not establish that a legal clause is missing.', 'Duplikate werden anhand des Playbook-Verweises, des Ankers und der Kennzeichnung einer fehlenden Klausel gezählt. Ein gültiges Zitat belegt nur sein Vorkommen im aufgezeichneten Absatz. Bei fehlenden Klauseln wird nur die Ankerstruktur geprüft; das belegt keinen rechtlichen Regelungsbedarf.')}</p>
      <h2>{t('Inspect each finding', 'Jede Feststellung prüfen')}</h2>
      <p className="source-language">{t('Contract text, explanations, identifiers and playbook instructions below are the unchanged English source.', 'Vertragstext, Erläuterungen, Kennungen und Playbook-Vorgaben bleiben nachfolgend im unveränderten englischen Original.')}</p>
      {rows.map(({finding, score: row, source}, index) => <section className="candidate-finding" key={index} aria-labelledby={`finding-${index + 1}`}>
        <h3 id={`finding-${index + 1}`}>{t('Finding', 'Feststellung')} {index + 1}: <code>{finding.playbookReference}</code></h3>
        <p className={row.evidenceValid ? 'candidate-valid' : 'candidate-invalid'}><strong>{row.evidenceValid ? t('Evidence structure valid', 'Belegstruktur gültig') : t('Evidence structure invalid', 'Belegstruktur ungültig')}</strong></p>
        <dl className="candidate-checks">
          <div><dt>{t('Exact quotation in its anchor', 'Exaktes Zitat im Ankerabsatz')}</dt><dd>{state(row.quotationValid)}</dd></div>
          <div><dt>{t('Missing-clause structure', 'Struktur bei fehlender Klausel')}</dt><dd>{state(row.missingClauseValid)}</dd></div>
          <div><dt>{t('Playbook entry and category', 'Playbook-Eintrag und Kategorie')}</dt><dd>{state(row.playbookReferenceValid)}</dd></div>
        </dl>
        {finding.quote ? <blockquote lang="en">{finding.quote}</blockquote> : <p>{t('No quotation: this candidate proposes adding a clause.', 'Kein Zitat: Dieser Kandidat schlägt eine zusätzliche Klausel vor.')}</p>}
        <p lang="en">{finding.explanation}</p>
        <p><strong>{t('Proposed amendment:', 'Änderungsvorschlag:')}</strong> {finding.proposedAmendment || t('None supplied. Amendment quality has not been evaluated.', 'Nicht vorhanden. Die Qualität von Änderungen wurde nicht bewertet.')}</p>
        {source && <details><summary>{t('Original paragraph', 'Originalabsatz')} {source.paragraph + 1}{finding.missingClause && t(' (insertion anchor)', ' (Einfügeanker)')}</summary><p lang="en">{source.text}</p><code>{source.id}</code></details>}
      </section>)}
      <h2>{t('What is not measured', 'Was nicht gemessen wird')}</h2>
      <p>{t('Issue precision and recall are unavailable: no independently reviewed issue annotation is attached. Native output has no severity field or complete clause inventory, so severity accuracy and whole-document coverage are unavailable. Legal reasoning and amendment quality need separate lawyer review.', 'Präzision und Recall der Feststellungen sind nicht verfügbar: Eine unabhängig geprüfte Annotation ist nicht beigefügt. Der nativen Ausgabe fehlen Schweregrade und ein vollständiges Klauselinventar. Schweregradgenauigkeit und Abdeckung des gesamten Dokuments sind deshalb nicht verfügbar. Juristische Begründung und Änderungsqualität erfordern eine gesonderte anwaltliche Prüfung.')}</p>
      <p>{t('This is the commercial playbook replay. It makes no DORA compliance or financial-regulatory coverage claim. Token usage and cost were not exposed by the application gateway; this replay is not evidence of model performance, latency or price.', 'Dieser Replay verwendet das kommerzielle Playbook. Er trifft keine Aussage zur DORA-Konformität oder zur finanzregulatorischen Abdeckung. Tokenverbrauch und Kosten wurden vom Anwendungsgateway nicht ausgegeben. Dieser Replay belegt weder Modellleistung noch Latenz oder Preis.')}</p>
      <h2>{t('Source and provenance', 'Quelle und Herkunft')}</h2>
      <dl className="candidate-provenance">
        <dt>{t('Mode / fixture', 'Modus / Beispiel')}</dt><dd>{run.run.mode} / {run.run.model}</dd>
        <dt>{t('Recorded outcome', 'Aufgezeichnetes Ergebnis')}</dt><dd>{run.run.outcome}</dd>
        <dt>{t('Recorded at', 'Aufgezeichnet am')}</dt><dd>{run.run.startedAt}</dd>
        <dt>{t('Source file', 'Quelldatei')}</dt><dd>{run.source.filename}</dd>
        <dt>{t('Source SHA-256', 'Quell-SHA-256')}</dt><dd>{run.source.sha256}</dd>
        <dt>Playbook SHA-256</dt><dd>{run.playbook.sha256}</dd>
        <dt>{t('Instructions SHA-256', 'Vorgaben-SHA-256')}</dt><dd>{run.instructionsSha256}</dd>
        <dt>{t('Prompt version', 'Prompt-Version')}</dt><dd>{run.run.promptVersion}</dd>
        <dt>{t('Recorded code revision', 'Aufgezeichneter Codestand')}</dt><dd>{run.run.codeRevision}</dd>
        <dt>{t('Working tree at capture', 'Arbeitsverzeichnis bei Aufzeichnung')}</dt><dd>{run.run.workingTreeDirty ? t('Dirty: uncommitted changes were present. The commit alone cannot reproduce this capture.', 'Geändert: Es lagen nicht eingecheckte Änderungen vor. Der Commit allein reproduziert diese Aufzeichnung nicht.') : t('Clean', 'Unverändert')}</dd>
        <dt>{t('Python scorer SHA-256 at export', 'SHA-256 des Python-Scorers beim Export')}</dt><dd>{provenance.scorerSha256}</dd>
        <dt>{t('Replay file SHA-256', 'Replay-Datei-SHA-256')}</dt><dd>{provenance.runSha256}</dd>
        <dt>{t('Score file SHA-256', 'Ergebnisdatei-SHA-256')}</dt><dd>{provenance.scoreSha256}</dd>
        <dt>{t('Canonical recording SHA-256', 'SHA-256 der kanonischen Aufzeichnung')}</dt><dd>{score.recordingSha256}</dd>
      </dl>
      <details className="candidate-source"><summary>{t('Full recorded source and review instructions', 'Vollständige aufgezeichnete Quelle und Prüfvorgaben')}</summary><h3>{t('Review instructions', 'Prüfvorgaben')}</h3><p lang="en">{run.instructions}</p><h3>{t('Contract paragraphs', 'Vertragsabsätze')}</h3>{run.source.clauses.map(clause=><p key={clause.id} lang="en">{clause.text}</p>)}<h3>Playbook</h3><pre lang="en">{run.playbook.instructions}</pre></details>
      <nav className="candidate-downloads" aria-label={t('Original JSON artifacts', 'Originale JSON-Artefakte')}><a download href="/candidates/replay-run.json">{t('Replay JSON (English)', 'Replay-JSON (Englisch)')}</a><a download href="/candidates/replay-score.json">{t('Python score JSON (English)', 'Python-Ergebnis-JSON (Englisch)')}</a><a download href="/candidates/provenance.json">{t('File provenance JSON', 'Dateiherkunft als JSON')}</a></nav>
    </article>
  </main>;
}
