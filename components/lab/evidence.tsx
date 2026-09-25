'use client';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Download, FileText } from 'lucide-react';
import type { BenchmarkCase, Evaluation } from '@/lib/evaluation';
import { contractBlocks, segmentRange, type Mark } from '@/lib/document';
import { clauseLabel } from '@/lib/inspection';
import { GroundedTag, download } from './primitives';

type Citation = { clause_type: string; quote: string; sourceSpan: [number, number] | null; index: number };

/** Mark id for a passage opened from the comparison ledger that is not a quotation of the current run. */
export const EXTERNAL = -1;

/** Scroll only the given pane, so the page itself stays where the reader left it. */
function reveal(pane: HTMLElement | null, target: HTMLElement | null | undefined, offset: number) {
  if (!pane || !target) return;
  const top = target.getBoundingClientRect().top - pane.getBoundingClientRect().top + pane.scrollTop - offset;
  pane.scrollTo({ top: Math.max(0, top), behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
}

export function Evidence({ item, run, citations, active, external, onActivate, onInspect }: {
  item: BenchmarkCase; run: Evaluation; citations: Citation[]; active: number | null; external: [number, number] | null;
  onActivate: (index: number) => void; onInspect: (clause: string) => void;
}) {
  const blocks = useMemo(() => contractBlocks(item.source), [item.source]);
  const marks: Mark[] = useMemo(() => [
    ...citations.filter(citation => citation.sourceSpan).map(citation => ({ id: citation.index, span: citation.sourceSpan! })),
    ...(external ? [{ id: EXTERNAL, span: external }] : []),
  ], [citations, external]);
  const layoutRef = useRef<HTMLDivElement>(null);
  const documentRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLElement>(null);
  // Bumped on every activation so choosing the already-selected quotation still scrolls back to it.
  const [request, setRequest] = useState(0);
  const focusId = external ? EXTERNAL : active;

  useEffect(() => {
    if (focusId === null) return;
    const layout = layoutRef.current?.getBoundingClientRect();
    if (layout && (layout.top < 0 || layout.top > window.innerHeight * 0.6)) layoutRef.current?.scrollIntoView({ block: 'start' });
    const pane = documentRef.current;
    reveal(pane, pane?.querySelector<HTMLElement>(`[data-start="${focusId}"]`), pane ? pane.clientHeight / 3 : 0);
    const list = listRef.current;
    if (list && list.scrollHeight > list.clientHeight) reveal(list, list.querySelector<HTMLElement>(`[data-citation="${focusId}"]`), (list.querySelector<HTMLElement>('.quote-list-head')?.offsetHeight ?? 0) + 8);
  }, [focusId, external, request]);

  const activate = (index: number) => {
    onActivate(index);
    setRequest(value => value + 1);
  };

  const renderRange = (start: number, end: number) => segmentRange(start, end, marks).map(segment => {
    const text = item.source.slice(segment.start, segment.end);
    if (!segment.ids.length) return <Fragment key={segment.start}>{text}</Fragment>;
    const starts = segment.ids.filter(id => marks.find(mark => mark.id === id)!.span[0] === segment.start);
    const isActive = segment.ids.includes(focusId ?? Number.NaN);
    const clickable = segment.ids.find(id => id !== EXTERNAL);
    return <mark key={segment.start} className={`${isActive ? 'is-active' : ''} ${segment.ids.includes(EXTERNAL) ? 'is-external' : ''} ${segment.ids.length > 1 ? 'is-overlap' : ''}`}
      onClick={clickable === undefined ? undefined : () => activate(clickable)}>
      {starts.map(id => <span key={id} data-start={id} className="mark-anchor">{id !== EXTERNAL && <button className="mark-tag" aria-label={`Quotation ${id + 1}, ${clauseLabel(citations[id].clause_type)}`} onClick={event => { event.stopPropagation(); activate(id); }}>{id + 1}</button>}</span>)}
      {text}
    </mark>;
  });

  const grounded = citations.filter(citation => citation.sourceSpan).length;
  return <div className="evidence-layout" ref={layoutRef}>
    <section className="panel document" aria-labelledby="document-heading">
      <div className="document-bar">
        <div><span className="eyebrow" id="document-heading">Synthetic source contract</span><p className="legend"><span className="legend-swatch" />Located quotation<span className="legend-swatch is-active" />Selected</p></div>
        <button className="button button-quiet" onClick={() => download(`${item.id}-synthetic-contract.md`, item.source, 'text/markdown')}><Download />Contract</button>
      </div>
      <div className="document-body" ref={documentRef} tabIndex={0} aria-label="Contract text">
        {blocks.map(block => block.kind === 'title' ? <h3 className="doc-title" key={block.start}>{renderRange(block.start, block.end)}</h3>
          : block.kind === 'heading' ? <h4 className="doc-heading" key={block.start}>{renderRange(block.start, block.end)}</h4>
          : <p key={block.start}>{renderRange(block.start, block.end)}</p>)}
      </div>
    </section>
    <section className="quote-list" aria-labelledby="quotes-heading" ref={listRef}>
      <div className="quote-list-head">
        <h3 id="quotes-heading">Review quotations</h3>
        <p className="muted">{grounded} of {citations.length} located. Matching ignores case, punctuation and whitespace; it shows the words exist, not that the reasoning is right.</p>
      </div>
      {citations.map(citation => <article key={citation.index} data-citation={citation.index} className={`panel quote-card ${citation.sourceSpan ? '' : 'is-ungrounded'} ${active === citation.index && !external ? 'is-active' : ''}`}>
        <header><span className="quote-number">{citation.index + 1}</span><button className="link-button quote-clause" onClick={() => onInspect(citation.clause_type)}>{clauseLabel(citation.clause_type)}</button><GroundedTag grounded={!!citation.sourceSpan} /></header>
        <blockquote>“{citation.quote}”</blockquote>
        {citation.sourceSpan ? <button className="link-button" onClick={() => activate(citation.index)}>Show in contract<ArrowRight /></button>
          : <p className="quote-warning">These words do not appear in the contract. Treat the finding it supports as unsupported.</p>}
      </article>)}
      {!citations.length && <div className="panel empty-state"><FileText aria-hidden="true" /><h3>No evidence supplied</h3><p>This scenario removes every quotation, so no finding can be traced to the contract.</p></div>}
      {run.scores.span_uncovered_clauses.length > 0 && <div className="uncovered">
        <h4>Reference clauses without a located quotation</h4>
        <ul>{run.scores.span_uncovered_clauses.map(key => <li key={key}><button className="chip" onClick={() => onInspect(key)}>{clauseLabel(key)}</button></li>)}</ul>
      </div>}
    </section>
  </div>;
}
