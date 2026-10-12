'use client';
import { Fragment, useEffect, useMemo, useRef, type KeyboardEvent } from 'react';
import { ArrowRight, ChevronDown, ChevronUp, Download, FileText } from 'lucide-react';
import { contractBlocks, sectionBlocks, segmentRange, type Mark } from '@/lib/document';
import type { BenchmarkCase, Evaluation } from '@/lib/evaluation';
import { clauseFindings, findingTier, type RiskFinding } from '@/lib/inspection';
import { locateSource } from '@/lib/scoring';
import { useLocale } from './locale';
import type { List, Panel } from '@/lib/view';
import { FindingTag, LocatedTag, Severity, download } from './primitives';

export type Citation = { clause_type: string; quote: string; sourceSpan: [number, number] | null; index: number };
type Clause = ReturnType<typeof clauseFindings>[number];

/** Mark ids that are not quotations of the current run. */
const EXTERNAL = -1; // a passage opened from the comparison ledger
const ANCHOR = -2; // the reference anchor of the selected clause

const coverageText = (clause: Clause, t: (en: string, de: string) => string) => clause.status === 'Matched' ? t('The review identified this clause.', 'Die Prüfung hat diese Klausel erkannt.')
  : clause.status === 'Matched via alias' ? t(`The review used “${clause.reportedAs.join(', ')}”, a declared reference synonym.`, `Die Prüfung verwendet „${clause.reportedAs.join(', ')}“, ein hinterlegtes Referenzsynonym.`)
  : clause.status === 'Missed' ? t('The review did not identify this clause.', 'Die Prüfung hat diese Klausel übersehen.')
  : t('The review named a clause outside the reference set.', 'Die Prüfung nennt eine Klausel außerhalb der Referenz.');

/** Scroll only the given pane, so the page itself stays where the reader left it. */
function reveal(pane: HTMLElement, target: HTMLElement | null, offset: number) {
  if (!target) return;
  const top = target.getBoundingClientRect().top - pane.getBoundingClientRect().top + pane.scrollTop - offset;
  pane.scrollTo({ top: Math.max(0, top), behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
}

type Props = {
  item: BenchmarkCase; run: Evaluation; rows: RiskFinding[]; citations: Citation[]; canonical: (key: string) => string;
  selected: string; active: number | null; external: [number, number] | null; list: List; request: number;
  panel: Panel; onPanel: (panel: Panel) => void;
  onList: (list: List) => void; onSelectClause: (key: string) => void; onSelectCitation: (index: number) => void; onClearExternal: () => void;
};

export function ReviewSheet(props: Props) {
  const { t, label, statusText } = useLocale();
  const { item, run, rows, citations, canonical, selected, active, list, onList, onSelectClause, onSelectCitation } = props;
  const clauses = useMemo(() => {
    const rank = (status: string) => ['Missed', 'Extra', 'Matched via alias', 'Matched'].indexOf(status);
    return [...clauseFindings(item.gold, run.review)].sort((a, b) => rank(a.status) - rank(b.status));
  }, [item, run]);

  // One navigable sequence per list, shared by the arrow keys and the previous/next buttons.
  const entries = list === 'findings' ? rows.map(row => ({ id: row.key, current: row.key === selected, select: () => onSelectClause(row.key) }))
    : list === 'quotations' ? citations.map(citation => ({ id: `q${citation.index}`, current: citation.index === active, select: () => onSelectCitation(citation.index) }))
    : clauses.map(clause => ({ id: clause.key, current: clause.key === selected, select: () => onSelectClause(clause.key) }));
  const position = entries.findIndex(entry => entry.current);
  const step = (offset: number) => entries[position + offset]?.select();

  // Keep the current entry visible when the selection came from elsewhere: the contract, the notes or the stepper.
  const listRef = useRef<HTMLElement>(null);
  const currentId = entries[position]?.id;
  useEffect(() => {
    const pane = listRef.current;
    const current = pane?.querySelector<HTMLElement>('[aria-current="true"]');
    if (!pane || !current || pane.scrollHeight <= pane.clientHeight) return;
    const top = current.getBoundingClientRect().top - pane.getBoundingClientRect().top;
    const header = pane.querySelector<HTMLElement>('.list-switch')?.offsetHeight ?? 0;
    if (top < header || top + current.offsetHeight > pane.clientHeight) reveal(pane, current, header + 8);
  }, [currentId, list]);

  function move(event: KeyboardEvent<HTMLOListElement>) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button.entry')];
    const next = buttons[buttons.findIndex(button => button === document.activeElement) + (event.key === 'ArrowDown' ? 1 : -1)];
    if (!next) return;
    event.preventDefault();
    next.focus();
    next.click();
  }

  const located = citations.filter(citation => citation.sourceSpan).length;
  const counts: Record<List, string> = { findings: String(rows.length), quotations: `${located}/${citations.length}`, clauses: String(clauses.length) };
  const titles: Record<List, string> = { findings: t('Findings', 'Feststellungen'), quotations: t('Quotations', 'Zitate'), clauses: t('Clauses', 'Klauseln') };
  const tierTitles = { exposure: t('Hidden exposure', 'Verdeckte Risiken'), alarm: t('False alarms', 'Fehlalarme'), match: t('Matches the reference', 'Entspricht der Referenz') };

  return <><nav className="mobile-steps" aria-label={t('Review steps', 'Prüfschritte')}>
      {(['list', 'detail', 'contract'] as const).map((panel, index) => <button key={panel} aria-current={props.panel === panel ? 'step' : undefined} onClick={() => props.onPanel(panel)}>{index + 1}. {{list:t('Findings','Feststellungen'),detail:t('Explanation','Erläuterung'),contract:t('Contract','Vertrag')}[panel]}</button>)}
    </nav><div className="sheet" data-panel={props.panel}>
    <section className="sheet-list" id="finding-list" tabIndex={-1} aria-labelledby="list-heading" ref={listRef}>
      <h2 id="list-heading" className="sr-only">{t('What to inspect', 'Prüfgegenstand')}</h2>
      <div className="list-switch" role="group" aria-label={t("List", "Liste")}>
        {(Object.keys(titles) as List[]).map(key => <button key={key} aria-pressed={list === key} onClick={() => onList(key)}>{titles[key]}<span>{counts[key]}</span></button>)}
      </div>
      <p className="list-hint">{list === 'findings' ? t('Each risk the reference or the review raised, most serious first.', 'Risiken aus Referenz und Prüfung, nach Relevanz geordnet.')
        : list === 'quotations' ? t('Every passage the review quoted as evidence, checked against the contract text.', 'Alle Belegzitate der Prüfung, mit dem Vertragstext abgeglichen.')
        : t('Clauses the reference expects, against the clauses the review named.', 'Erwartete Referenzklauseln im Vergleich zu den erkannten Klauseln.')}</p>
      <ol className="entries" onKeyDown={move}>
        {list === 'findings' && rows.map((row, index) => {
          const tier = findingTier(row);
          return <Fragment key={row.key}>
            {(index === 0 || findingTier(rows[index - 1]) !== tier) && <li className={`entry-group tier-${tier}`}>{tierTitles[tier]}</li>}
            <li><button className={`entry tier-${tier}`} aria-current={row.key === selected ? 'true' : undefined} onClick={() => onSelectClause(row.key)}>
              <span className="entry-head"><span className="entry-title">{label(row.key)}</span><FindingTag finding={row} /></span>
              <span className="entry-sub"><span>{t("Reference", "Referenz")} <Severity value={row.expected} /></span><span>{t("Review", "Prüfung")} {row.severities.length > 1 ? [...new Set(row.severities)].map(value => <Severity key={value} value={value} />) : <Severity value={row.predicted} />}</span></span>
            </button></li>
          </Fragment>;
        })}
        {list === 'quotations' && citations.map(citation => <li key={citation.index}>
          <button className={`entry ${citation.sourceSpan ? '' : 'tier-alarm'}`} aria-current={citation.index === active ? 'true' : undefined} onClick={() => onSelectCitation(citation.index)}>
            <span className="entry-head"><span className="entry-title"><span className="quote-number">{citation.index + 1}</span>{label(canonical(citation.clause_type))}</span><LocatedTag located={!!citation.sourceSpan} /></span>
            <span className="entry-quote">“{citation.quote}”</span>
          </button>
        </li>)}
        {list === 'clauses' && clauses.map(clause => <li key={clause.key}>
          <button className={`entry ${clause.status === 'Missed' ? 'tier-exposure' : clause.status === 'Extra' ? 'tier-alarm' : ''}`} aria-current={clause.key === selected ? 'true' : undefined} onClick={() => onSelectClause(clause.key)}>
            <span className="entry-head"><span className="entry-title">{label(clause.key)}</span><span className={`tag ${clause.status === 'Missed' ? 'tag-exposure' : clause.status === 'Extra' ? 'tag-alarm' : 'tag-match'}`}>{clause.status === 'Extra' ? t('Not in reference', 'Nicht in Referenz') : statusText(clause.status)}</span></span>
          </button>
        </li>)}
      </ol>
      {list === 'quotations' && !citations.length && <div className="empty-state"><FileText aria-hidden="true" /><p className="empty-title">{t('No quotations to check', 'Keine Zitate zu prüfen')}</p><p>{t('This scenario removes every quotation, so no finding can be traced to the contract.', 'Dieses Szenario entfernt alle Zitate. Die Feststellungen lassen sich damit nicht zum Vertrag zurückverfolgen.')}</p></div>}
      {list === 'quotations' && run.scores.span_uncovered_clauses.length > 0 && <div className="uncovered">
        <h3>{t('Reference clauses no quotation reaches', 'Referenzklauseln ohne Zitatbeleg')}</h3>
        <ul>{run.scores.span_uncovered_clauses.map(key => <li key={key}><button className="chip" onClick={() => onSelectClause(key)}>{label(key)}</button></li>)}</ul>
      </div>}
    </section>

    <Detail item={item} run={run} selected={selected} row={rows.find(row => row.key === selected)} clause={clauses.find(clause => clause.key === selected)}
      quotes={citations.filter(citation => canonical(citation.clause_type) === selected)} canonical={canonical} active={active}
      onSelectCitation={onSelectCitation} onPrevious={position > 0 ? () => step(-1) : undefined} onNext={position >= 0 && position < entries.length - 1 ? () => step(1) : undefined} />

    <Contract {...props} />
  </div></>;
}

function Contract({ item, citations, canonical, selected, active, external, request, onSelectCitation, onClearExternal }: Props) {
  const { t, label } = useLocale();
  const blocks = useMemo(() => contractBlocks(item.source), [item.source]);
  const anchor = Object.hasOwn(item.gold.clause_anchors, selected) ? locateSource(item.source, item.gold.clause_anchors[selected]) : null;
  const section = anchor ? sectionBlocks(blocks, anchor[0]) : null;
  const spans = new Map<number, [number, number]>(citations.filter(citation => citation.sourceSpan).map(citation => [citation.index, citation.sourceSpan!]));
  if (anchor) spans.set(ANCHOR, anchor);
  if (external) spans.set(EXTERNAL, external);
  const marks: Mark[] = [...spans].map(([id, span]) => ({ id, span }));
  const ownQuotes = new Set(citations.filter(citation => citation.sourceSpan && canonical(citation.clause_type) === selected).map(citation => citation.index));
  const bodyRef = useRef<HTMLDivElement>(null);

  // What the pane should bring into view: an opened passage, the chosen quotation, the clause's first quotation, or its reference anchor.
  const target = external ? EXTERNAL : active !== null && spans.has(active) ? active : ownQuotes.size ? Math.min(...ownQuotes) : anchor ? ANCHOR : null;
  useEffect(() => {
    const pane = bodyRef.current;
    if (!pane || target === null) return;
    reveal(pane, pane.querySelector<HTMLElement>(`[data-start="${target}"]`), pane.clientHeight / 3);
  }, [target, request, item.id]);

  const renderRange = (start: number, end: number) => segmentRange(start, end, marks).map(segment => {
    const text = item.source.slice(segment.start, segment.end);
    const quoteIds = segment.ids.filter(id => id >= 0);
    const starts = segment.ids.filter(id => spans.get(id)![0] === segment.start).map(id => <span key={id} data-start={id} className="scroll-anchor">
      {id >= 0 && <button className="mark-tag" aria-label={`${t("Quotation", "Zitat")} ${id + 1}, ${label(canonical(citations[id].clause_type))}`} onClick={event => { event.stopPropagation(); onSelectCitation(id); }}>{id + 1}</button>}
    </span>);
    const isAnchor = segment.ids.includes(ANCHOR), isExternal = segment.ids.includes(EXTERNAL);
    if (!quoteIds.length && !isExternal) return isAnchor ? <span key={segment.start} className="ref-anchor">{starts}{text}</span> : <Fragment key={segment.start}>{text}</Fragment>;
    const className = [quoteIds.some(id => ownQuotes.has(id)) && 'is-own', active !== null && quoteIds.includes(active) && 'is-active', isExternal && 'is-external', isAnchor && 'ref-anchor', quoteIds.length > 1 && 'is-overlap'].filter(Boolean).join(' ');
    return <mark key={segment.start} className={className} tabIndex={-1} onClick={quoteIds.length ? () => onSelectCitation(quoteIds[0]) : undefined}>{starts}{text}</mark>;
  });

  return <section className="sheet-contract" id="contract-panel" tabIndex={-1} aria-labelledby="contract-heading">
    <header className="contract-bar">
      <div>
        <h2 id="contract-heading">{t("Synthetic source contract", "Synthetischer Quellvertrag")} <small>{t("English source", "Englisches Original")}</small></h2>
        <p className="legend"><span><i className="swatch swatch-quote" aria-hidden="true" />{t("Quoted by the review", "Zitat der Prüfung")}</span><span><i className="swatch swatch-anchor" aria-hidden="true" />{t("Reference anchor", "Referenzanker")}</span><span><i className="swatch swatch-section" aria-hidden="true" />{t("Selected clause", "Ausgewählte Klausel")}</span></p>
      </div>
      <button className="button button-quiet" onClick={() => download(`${item.id}-synthetic-contract.md`, item.source, 'text/markdown')}><Download aria-hidden="true" />{t("Contract (.md)", "Vertrag (.md)")}</button>
    </header>
    {external && <p className="external-note" role="status"><i className="swatch swatch-external" aria-hidden="true" />{t("The blue passage belongs to the comparison review.", "Die blaue Passage stammt aus der Vergleichsprüfung.")}<button className="link-button" onClick={onClearExternal}>{t("Clear", "Ausblenden")}</button></p>}
    <div className="contract-body" ref={bodyRef} tabIndex={0} role="region" aria-label={t("Contract text", "Vertragstext")} lang="en">
      {blocks.map((block, index) => {
        const className = section && index >= section[0] && index < section[1] ? 'in-section' : undefined;
        return block.kind === 'title' ? <h3 className="doc-title" key={block.start}>{renderRange(block.start, block.end)}</h3>
          : block.kind === 'heading' ? <h4 className={`doc-heading ${className ?? ''}`} key={block.start}>{renderRange(block.start, block.end)}</h4>
          : <p className={className} key={block.start}>{renderRange(block.start, block.end)}</p>;
      })}
    </div>
  </section>;
}

function Detail({ item, run, selected, row, clause, quotes, canonical, active, onSelectCitation, onPrevious, onNext }: {
  item: BenchmarkCase; run: Evaluation; selected: string; row?: RiskFinding; clause?: Clause; quotes: Citation[]; canonical: (key: string) => string;
  active: number | null; onSelectCitation: (index: number) => void; onPrevious?: () => void; onNext?: () => void;
}) {
  const { t, label, severityText } = useLocale();
  const rationale = item.gold.severity_rationale[selected];
  const flags = run.review.risk_flags.filter(flag => canonical(flag.clause_type) === selected);
  return <aside className="sheet-detail" id="detail" tabIndex={-1} aria-labelledby="detail-heading">
    <header className="detail-head">
      <h2 id="detail-heading">{label(selected)}</h2>
      <div className="stepper">
        <button className="icon-button" onClick={onPrevious} disabled={!onPrevious} aria-label={t("Previous in list", "Vorheriger Eintrag")}><ChevronUp aria-hidden="true" /></button>
        <button className="icon-button" onClick={onNext} disabled={!onNext} aria-label={t("Next in list", "Nächster Eintrag")}><ChevronDown aria-hidden="true" /></button>
      </div>
    </header>
    {row ? <FindingTag finding={row} /> : <span className="tag tag-match">{t("No risk raised by either side", "Keine Seite nennt ein Risiko")}</span>}
    <div className="severity-compare">
      <div><span>{t("Reference", "Referenz")}</span><Severity value={item.gold.risk_flags[selected]} /></div>
      <ArrowRight aria-hidden="true" />
      <div><span>{t("Review", "Prüfung")}</span>{flags.length ? <span className="severity-stack">{flags.map((flag, index) => <Severity key={index} value={flag.severity} />)}</span> : <Severity />}</div>
    </div>

    <h3>{t("Why the reference rates it this way", "Begründung der Referenz")}</h3><p className="source-language">{t("Original reference judgment in English.", "Unveränderte Referenzbeurteilung auf Englisch.")}</p>
    <p className="prose" lang={rationale ? "en" : undefined}>{rationale || t('The reference answers do not treat this clause as a risk.', 'Die Referenz behandelt diese Klausel nicht als Risiko.')}</p>

    <h3>{t("What the review said", "Aussage der Prüfung")}</h3><p className="source-language">{t("Original review output in English.", "Unveränderte Ausgabe der Prüfung auf Englisch.")}</p>
    {flags.length ? flags.map((flag, index) => <p className="prose" key={index} lang="en">{flags.length > 1 && <strong>{severityText(flag.severity)}: </strong>}{flag.rationale}</p>) : <p className="prose muted">{t("The review raised no risk for this clause.", "Die Prüfung nennt für diese Klausel kein Risiko.")}</p>}

    <h3>{t("Quotations the review cited", "Zitate der Prüfung")} <span className="count">{quotes.length}</span></h3>
    {quotes.length ? quotes.map(citation => <figure className={`quote ${citation.sourceSpan ? '' : 'is-missing'} ${active === citation.index ? 'is-active' : ''}`} key={citation.index}>
      <blockquote lang="en">“{citation.quote}”</blockquote>
      <figcaption><span className="quote-number">{citation.index + 1}</span><LocatedTag located={!!citation.sourceSpan} />{citation.sourceSpan && <button className="link-button" onClick={() => onSelectCitation(citation.index)}>{t("Show in contract", "Im Vertrag anzeigen")}</button>}</figcaption>
    </figure>) : <p className="prose muted">{t("The review cited no passage for this clause.", "Die Prüfung zitiert für diese Klausel keine Passage.")}</p>}

    {clause && <>
      <h3>{t("Clause identification", "Klauselerkennung")}</h3>
      <p className="prose">{coverageText(clause, t)}</p>
      {clause.abstentions.map((abstention, index) => <p className="prose muted" key={index}>{t("Abstained (original wording)", "Enthaltung (Originalwortlaut)")}: <span lang="en">{abstention.reason}</span></p>)}
    </>}
  </aside>;
}
