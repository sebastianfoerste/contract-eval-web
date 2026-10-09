'use client';
import { Fragment, useEffect, useMemo, useRef, type KeyboardEvent } from 'react';
import { ArrowRight, ChevronDown, ChevronUp, Download, FileText } from 'lucide-react';
import { contractBlocks, sectionBlocks, segmentRange, type Mark } from '@/lib/document';
import type { BenchmarkCase, Evaluation } from '@/lib/evaluation';
import { clauseFindings, clauseLabel, findingTier, type FindingTier, type RiskFinding } from '@/lib/inspection';
import { locateSource } from '@/lib/scoring';
import type { List } from '@/lib/view';
import { FindingTag, LocatedTag, Severity, download } from './primitives';

export type Citation = { clause_type: string; quote: string; sourceSpan: [number, number] | null; index: number };
type Clause = ReturnType<typeof clauseFindings>[number];

/** Mark ids that are not quotations of the current run. */
const EXTERNAL = -1; // a passage opened from the comparison ledger
const ANCHOR = -2; // the reference anchor of the selected clause

const tierTitles: Record<FindingTier, string> = {
  exposure: 'Hidden exposure',
  alarm: 'False alarms',
  match: 'Matches the reference',
};

const coverageText = (clause: Clause) => clause.status === 'Matched' ? 'The review identified this clause.'
  : clause.status === 'Matched via alias' ? `The review named it “${clause.reportedAs.filter(name => name !== clause.key).map(clauseLabel).join(', ')}”, which the reference treats as the same clause.`
  : clause.status === 'Missed' ? 'The review did not identify this clause.'
  : 'The review named this clause. The reference set does not contain it.';

/** Scroll only the given pane, so the page itself stays where the reader left it. */
function reveal(pane: HTMLElement, target: HTMLElement | null, offset: number) {
  if (!target) return;
  const top = target.getBoundingClientRect().top - pane.getBoundingClientRect().top + pane.scrollTop - offset;
  pane.scrollTo({ top: Math.max(0, top), behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
}

type Props = {
  item: BenchmarkCase; run: Evaluation; rows: RiskFinding[]; citations: Citation[]; canonical: (key: string) => string;
  selected: string; active: number | null; external: [number, number] | null; list: List; request: number;
  onList: (list: List) => void; onSelectClause: (key: string) => void; onSelectCitation: (index: number) => void; onClearExternal: () => void;
};

export function ReviewSheet(props: Props) {
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
  const titles: Record<List, string> = { findings: 'Findings', quotations: 'Quotations', clauses: 'Clauses' };

  return <div className="sheet">
    <section className="sheet-list" aria-labelledby="list-heading" ref={listRef}>
      <h2 id="list-heading" className="sr-only">What to inspect</h2>
      <div className="list-switch" role="group" aria-label="List">
        {(Object.keys(titles) as List[]).map(key => <button key={key} aria-pressed={list === key} onClick={() => onList(key)}>{titles[key]}<span>{counts[key]}</span></button>)}
      </div>
      <p className="list-hint">{list === 'findings' ? 'Each risk the reference or the review raised, most serious first.'
        : list === 'quotations' ? 'Every passage the review quoted as evidence, checked against the contract text.'
        : 'Clauses the reference expects, against the clauses the review named.'}</p>
      <ol className="entries" onKeyDown={move}>
        {list === 'findings' && rows.map((row, index) => {
          const tier = findingTier(row);
          return <Fragment key={row.key}>
            {(index === 0 || findingTier(rows[index - 1]) !== tier) && <li className={`entry-group tier-${tier}`}>{tierTitles[tier]}</li>}
            <li><button className={`entry tier-${tier}`} aria-current={row.key === selected ? 'true' : undefined} onClick={() => onSelectClause(row.key)}>
              <span className="entry-head"><span className="entry-title">{clauseLabel(row.key)}</span><FindingTag finding={row} /></span>
              <span className="entry-sub"><span>Reference <Severity value={row.expected} /></span><span>Review {row.severities.length > 1 ? [...new Set(row.severities)].map(value => <Severity key={value} value={value} />) : <Severity value={row.predicted} />}</span></span>
            </button></li>
          </Fragment>;
        })}
        {list === 'quotations' && citations.map(citation => <li key={citation.index}>
          <button className={`entry ${citation.sourceSpan ? '' : 'tier-alarm'}`} aria-current={citation.index === active ? 'true' : undefined} onClick={() => onSelectCitation(citation.index)}>
            <span className="entry-head"><span className="entry-title"><span className="quote-number">{citation.index + 1}</span>{clauseLabel(canonical(citation.clause_type))}</span><LocatedTag located={!!citation.sourceSpan} /></span>
            <span className="entry-quote">“{citation.quote}”</span>
          </button>
        </li>)}
        {list === 'clauses' && clauses.map(clause => <li key={clause.key}>
          <button className={`entry ${clause.status === 'Missed' ? 'tier-exposure' : clause.status === 'Extra' ? 'tier-alarm' : ''}`} aria-current={clause.key === selected ? 'true' : undefined} onClick={() => onSelectClause(clause.key)}>
            <span className="entry-head"><span className="entry-title">{clauseLabel(clause.key)}</span><span className={`tag ${clause.status === 'Missed' ? 'tag-exposure' : clause.status === 'Extra' ? 'tag-alarm' : 'tag-match'}`}>{clause.status === 'Extra' ? 'Not in reference' : clause.status}</span></span>
          </button>
        </li>)}
      </ol>
      {list === 'quotations' && !citations.length && <div className="empty-state"><FileText aria-hidden="true" /><p className="empty-title">No quotations to check</p><p>This scenario removes every quotation, so no finding can be traced to the contract.</p></div>}
      {list === 'quotations' && run.scores.span_uncovered_clauses.length > 0 && <div className="uncovered">
        <h3>Reference clauses no quotation reaches</h3>
        <ul>{run.scores.span_uncovered_clauses.map(key => <li key={key}><button className="chip" onClick={() => onSelectClause(key)}>{clauseLabel(key)}</button></li>)}</ul>
      </div>}
    </section>

    <Detail item={item} run={run} selected={selected} row={rows.find(row => row.key === selected)} clause={clauses.find(clause => clause.key === selected)}
      quotes={citations.filter(citation => canonical(citation.clause_type) === selected)} canonical={canonical} active={active}
      onSelectCitation={onSelectCitation} onPrevious={position > 0 ? () => step(-1) : undefined} onNext={position >= 0 && position < entries.length - 1 ? () => step(1) : undefined} />

    <Contract {...props} />
  </div>;
}

function Contract({ item, citations, canonical, selected, active, external, request, onSelectCitation, onClearExternal }: Props) {
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
      {id >= 0 && <button className="mark-tag" aria-label={`Quotation ${id + 1}, ${clauseLabel(canonical(citations[id].clause_type))}`} onClick={event => { event.stopPropagation(); onSelectCitation(id); }}>{id + 1}</button>}
    </span>);
    const isAnchor = segment.ids.includes(ANCHOR), isExternal = segment.ids.includes(EXTERNAL);
    if (!quoteIds.length && !isExternal) return isAnchor ? <span key={segment.start} className="ref-anchor">{starts}{text}</span> : <Fragment key={segment.start}>{text}</Fragment>;
    const className = [quoteIds.some(id => ownQuotes.has(id)) && 'is-own', active !== null && quoteIds.includes(active) && 'is-active', isExternal && 'is-external', isAnchor && 'ref-anchor', quoteIds.length > 1 && 'is-overlap'].filter(Boolean).join(' ');
    return <mark key={segment.start} className={className} onClick={quoteIds.length ? () => onSelectCitation(quoteIds[0]) : undefined}>{starts}{text}</mark>;
  });

  return <section className="sheet-contract" aria-labelledby="contract-heading">
    <header className="contract-bar">
      <div>
        <h2 id="contract-heading">Synthetic source contract</h2>
        <p className="legend"><span><i className="swatch swatch-quote" aria-hidden="true" />Quoted by the review</span><span><i className="swatch swatch-anchor" aria-hidden="true" />Reference anchor</span><span><i className="swatch swatch-section" aria-hidden="true" />Selected clause</span></p>
      </div>
      <button className="button button-quiet" onClick={() => download(`${item.id}-synthetic-contract.md`, item.source, 'text/markdown')}><Download aria-hidden="true" />Contract</button>
    </header>
    {external && <p className="external-note" role="status"><i className="swatch swatch-external" aria-hidden="true" />The blue passage comes from the compared run, not from this review.<button className="link-button" onClick={onClearExternal}>Clear</button></p>}
    <div className="contract-body" ref={bodyRef} tabIndex={0} role="region" aria-label="Contract text">
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
  const rationale = item.gold.severity_rationale[selected];
  const flags = run.review.risk_flags.filter(flag => canonical(flag.clause_type) === selected);
  return <aside className="sheet-detail" id="detail" aria-labelledby="detail-heading">
    <header className="detail-head">
      <h2 id="detail-heading">{clauseLabel(selected)}</h2>
      <div className="stepper">
        <button className="icon-button" onClick={onPrevious} disabled={!onPrevious} aria-label="Previous in list"><ChevronUp aria-hidden="true" /></button>
        <button className="icon-button" onClick={onNext} disabled={!onNext} aria-label="Next in list"><ChevronDown aria-hidden="true" /></button>
      </div>
    </header>
    {row ? <FindingTag finding={row} /> : <span className="tag tag-match">No risk raised by either side</span>}
    <div className="severity-compare">
      <div><span>Reference</span><Severity value={item.gold.risk_flags[selected]} /></div>
      <ArrowRight aria-hidden="true" />
      <div><span>Review</span>{flags.length ? <span className="severity-stack">{flags.map((flag, index) => <Severity key={index} value={flag.severity} />)}</span> : <Severity />}</div>
    </div>

    <h3>Why the reference rates it this way</h3>
    <p className="prose">{rationale || 'The reference answers do not treat this clause as a risk.'}</p>

    <h3>What the review said</h3>
    {flags.length ? flags.map((flag, index) => <p className="prose" key={index}>{flags.length > 1 && <strong>{flag.severity.charAt(0).toUpperCase() + flag.severity.slice(1)}: </strong>}{flag.rationale}</p>) : <p className="prose muted">The review raised no risk for this clause.</p>}

    <h3>Quotations the review cited <span className="count">{quotes.length}</span></h3>
    {quotes.length ? quotes.map(citation => <figure className={`quote ${citation.sourceSpan ? '' : 'is-missing'} ${active === citation.index ? 'is-active' : ''}`} key={citation.index}>
      <blockquote>“{citation.quote}”</blockquote>
      <figcaption><span className="quote-number">{citation.index + 1}</span><LocatedTag located={!!citation.sourceSpan} />{citation.sourceSpan && <button className="link-button" onClick={() => onSelectCitation(citation.index)}>Show in contract</button>}</figcaption>
    </figure>) : <p className="prose muted">The review cited no passage for this clause.</p>}

    {clause && <>
      <h3>Clause identification</h3>
      <p className="prose">{coverageText(clause)}</p>
      {clause.abstentions.map((abstention, index) => <p className="prose muted" key={index}>Abstained: {abstention.reason}</p>)}
    </>}
  </aside>;
}
