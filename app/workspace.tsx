'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, Braces, Check, FlaskConical, ScrollText, TriangleAlert } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Compare, scenarioLabels } from '@/components/lab/compare';
import { Method } from '@/components/lab/method';
import { CopyLink, Segmented, ThemeSwitch, download } from '@/components/lab/primitives';
import { ReviewSheet } from '@/components/lab/review';
import { ScoreBand } from '@/components/lab/scores';
import benchmark from '@/lib/benchmark';
import { findCase, snapshot, type Evaluation } from '@/lib/evaluation';
import { canonicalClause, orderFindings, readout, riskFindings } from '@/lib/inspection';
import { renderReport } from '@/lib/report';
import { locateSource, scenarios, type Scenario } from '@/lib/scoring';
import { viewQuery, type List, type Tab, type View } from '@/lib/view';

type Selection = { caseId: string; scenario: Scenario };

/** The server scored against a different benchmark export than the one this page was built with. */
class StalePageError extends Error {}
const defaults = { caseId: benchmark.cases[0].id, scenario: 'baseline' };

function defaultFinding(run: Evaluation) {
  const item = findCase(run.caseId);
  const rows = orderFindings(riskFindings(item.gold, run.review, run.scores));
  return (rows.find(row => row.status !== 'Match') ?? rows[0])?.key ?? item.gold.clause_types[0];
}

export default function Workspace({ initialView }: { initialView: View }) {
  // parseView only admits catalog scenarios, and the catalog is built from `scenarios`.
  const [run, setRun] = useState<Evaluation>(() => snapshot(initialView.caseId, initialView.scenario as Scenario));
  const [runs, setRuns] = useState<Evaluation[]>([]);
  const [tab, setTab] = useState<Tab>(initialView.tab);
  const [list, setList] = useState<List>(initialView.list);
  const [chosenFinding, setChosenFinding] = useState<string | null>(initialView.finding);
  const [pending, setPending] = useState<Selection | null>(null);
  const [failed, setFailed] = useState<Selection | null>(null);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [active, setActive] = useState<number | null>(null);
  const [external, setExternal] = useState<[number, number] | null>(null);
  const [target, setTarget] = useState<Scenario>('baseline');
  // Counts deliberate selections, so choosing the current item again still scrolls back to it.
  const [request, setRequest] = useState(0);
  const inFlight = useRef(false);
  const queued = useRef<Selection | null>(null);
  const shownCase = useRef(initialView.caseId);

  const item = findCase(run.caseId);
  const selected = chosenFinding ?? defaultFinding(run);
  const canonical = useCallback((key: string) => canonicalClause(item.gold.clause_aliases, key), [item]);
  const citations = useMemo(() => run.review.citations.map((citation, index) => ({ ...citation, index, sourceSpan: locateSource(item.source, citation.quote) })), [run, item]);
  const rows = useMemo(() => orderFindings(riskFindings(item.gold, run.review, run.scores)), [item, run]);
  const points = useMemo(() => readout(item.gold, run.review, run.scores), [item, run]);
  const matrix = useMemo(() => Object.fromEntries(Object.keys(scenarios).map(key => [key, snapshot(item.id, key as Scenario)])) as Record<Scenario, Evaluation>, [item.id]);
  const flaggedChecks = points.filter(point => point.tone === 'issue').length;
  const openFindings = rows.filter(row => row.status !== 'Match').length;
  const compareWith: Scenario = target !== run.scenario ? target : run.scenario === 'baseline' ? 'no-evidence' : 'baseline';
  const shown: Selection = pending ?? { caseId: run.caseId, scenario: run.scenario };

  const show = useCallback((result: Evaluation) => {
    if (shownCase.current !== result.caseId) setChosenFinding(null);
    shownCase.current = result.caseId;
    setRun(result);
    setActive(null);
    setExternal(null);
  }, []);

  const perform = useCallback(async (caseId: string, scenario: Scenario) => {
    if (inFlight.current) throw new Error('An evaluation is already running.');
    inFlight.current = true;
    setError('');
    setFailed(null);
    let next: Selection | null = { caseId, scenario };
    let result: Evaluation | null = null;
    try {
      // Choices made while a request is in flight replace each other; only the latest runs next.
      while (next) {
        const current: Selection = next;
        queued.current = null;
        setPending(current);
        const response = await fetch('/api/evaluate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(current), signal: AbortSignal.timeout(20000) });
        const data: unknown = await response.json();
        if (!response.ok) throw new Error(data && typeof data === 'object' && 'error' in data ? String(data.error) : 'The server could not score this choice.');
        result = data as Evaluation;
        // The page holds the contract and reference answers; scores from another export must not be shown against them.
        if (result.provenance?.sourceCommit !== benchmark.sourceCommit) throw new StalePageError('This page is older than the server’s benchmark.');
        setRuns(old => [result!, ...old].slice(0, 30));
        next = queued.current;
      }
      show(result!);
      setNotice(`Scored on the server at ${new Date(result!.scoredAt).toLocaleTimeString()}.`);
      return { runId: result!.id, caseId: result!.caseId, scenario: result!.scenario, scores: result!.scores };
    } catch (cause) {
      const timedOut = cause instanceof DOMException && cause.name === 'TimeoutError';
      setError(timedOut ? 'The server did not answer in time.' : cause instanceof TypeError ? 'The server could not be reached. Check your connection.' : cause instanceof Error ? cause.message : 'The server could not score this choice.');
      setStale(cause instanceof StalePageError);
      setFailed(queued.current ?? { caseId, scenario });
      throw cause;
    } finally {
      inFlight.current = false;
      queued.current = null;
      setPending(null);
    }
  }, [show]);

  const choose = (selection: Selection) => {
    if (inFlight.current) {
      queued.current = selection;
      setPending(selection);
      return;
    }
    void perform(selection.caseId, selection.scenario).catch(() => {});
  };

  useEffect(() => {
    type Context = { registerTool: (tool: { name: string; description: string; inputSchema: object; execute: (input: unknown) => Promise<unknown>; annotations: { readOnlyHint: boolean } }, options: { signal: AbortSignal }) => void | Promise<void> };
    const context = (document as Document & { modelContext?: Context }).modelContext;
    if (!context) return;
    const life = new AbortController();
    // Registration runs in a microtask so a failure never sets state synchronously in the effect body.
    const unavailable = () => { if (!life.signal.aborted) setNotice('Browser agent controls are unavailable. Use the controls on the page.'); };
    // A cleanup that already ran (fast unmount, StrictMode remount) must not register a stale tool.
    Promise.resolve().then(() => life.signal.aborted ? undefined : context.registerTool({
      name: 'run_synthetic_contract_evaluation',
      description: 'Run and display a deterministic synthetic contract evaluation. No model call or payment.',
      inputSchema: { type: 'object', properties: { caseId: { type: 'string', enum: benchmark.cases.map(c => c.id) }, scenario: { type: 'string', enum: Object.keys(scenarios) } }, required: ['caseId', 'scenario'], additionalProperties: false },
      annotations: { readOnlyHint: false },
      execute: async (input: unknown) => {
        if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Expected a case and scenario.');
        const args = input as Record<string, unknown>;
        if (Object.keys(args).some(key => key !== 'caseId' && key !== 'scenario') || !benchmark.cases.some(c => c.id === args.caseId) || typeof args.scenario !== 'string' || !Object.hasOwn(scenarios, args.scenario)) throw new Error('Unknown case or scenario.');
        return perform(String(args.caseId), args.scenario as Scenario);
      },
    }, { signal: life.signal })).catch(unavailable);
    return () => life.abort();
  }, [perform]);

  useEffect(() => {
    const query = viewQuery({ caseId: run.caseId, scenario: run.scenario, tab, list, finding: chosenFinding }, defaults);
    const { pathname, search, hash } = window.location;
    if (search !== query) window.history.replaceState(window.history.state, '', `${pathname}${query}${hash}`);
  }, [run.caseId, run.scenario, tab, list, chosenFinding]);

  useEffect(() => {
    // On one-column layouts the notes sit below the list, so bring them to the reader after a choice.
    if (request === 0 || !window.matchMedia('(max-width: 999px)').matches) return;
    document.getElementById('detail')?.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  }, [request]);

  function selectClause(key: string, from?: List) {
    setChosenFinding(canonical(key));
    setActive(null);
    setExternal(null);
    if (from) setList(from);
    setTab('review');
    setRequest(count => count + 1);
  }

  function selectCitation(index: number) {
    setChosenFinding(canonical(citations[index].clause_type));
    setActive(index);
    setExternal(null);
    setTab('review');
    setRequest(count => count + 1);
  }

  function showQuote(quote: string, clause: string) {
    const own = citations.find(citation => citation.quote === quote && citation.sourceSpan);
    if (own) return selectCitation(own.index);
    const span = locateSource(item.source, quote);
    if (!span) return setNotice('This quotation does not appear in the contract.');
    setChosenFinding(canonical(clause));
    setActive(null);
    setExternal(span);
    setTab('review');
    setRequest(count => count + 1);
  }

  function reopen(saved: Evaluation) {
    show(saved);
    setNotice(`Showing the run scored at ${new Date(saved.scoredAt).toLocaleTimeString()}.`);
    setTab('review');
  }

  const context = item.gold.review_context;

  return <div className="lab">
    <a className="skip-link" href="#workspace">Skip to the evaluation</a>
    <header className="topbar">
      <Link className="brand" href="/" aria-label="Contract Review Evidence Lab, home"><span className="brand-mark"><FlaskConical aria-hidden="true" /></span><span className="brand-text"><small>Contract review</small>Evidence Lab</span></Link>
      <div className="topbar-right"><a href={benchmark.repository} target="_blank" rel="noreferrer">Source code<ArrowUpRight aria-hidden="true" /></a><ThemeSwitch /></div>
    </header>

    <main id="workspace" className="lab-main">
      <p className="premise">Each synthetic contract comes with a fixed contract review that contains deliberate errors. This lab scores that review against reference answers and shows, in the contract itself, what it found, what it missed and whether its quotations exist. No live model is called.</p>

      <section className="deck" aria-label="Evaluation controls">
        <Segmented legend="Contract" name="contract" value={run.caseId} pending={pending?.caseId}
          options={benchmark.cases.map(c => ({ value: c.id, label: c.title }))} onChange={caseId => choose({ caseId, scenario: shown.scenario })} />
        <Segmented legend="What to do to the review" name="scenario" value={run.scenario} pending={pending?.scenario}
          options={(Object.keys(scenarios) as Scenario[]).map(key => ({ value: key, label: scenarioLabels[key] }))} onChange={scenario => choose({ caseId: shown.caseId, scenario })}>
          <p className="deck-hint">{scenarios[shown.scenario].description}</p>
        </Segmented>
        <p className={`deck-status ${error ? 'is-error' : ''}`} role="status" aria-live="polite">
          {error || (pending ? 'Scoring on the server…' : notice || 'Reference snapshot computed in your browser. Any choice above is scored again on the server.')}
          {error && (stale ? <button className="link-button" onClick={() => window.location.reload()}>Reload the page</button> : failed && <button className="link-button" onClick={() => choose(failed)}>Try again</button>)}
        </p>
      </section>

      <section className="case" aria-labelledby="case-heading">
        <div className="case-title">
          <h1 id="case-heading">{item.title}</h1>
          <p className="case-scenario">{scenarios[run.scenario].title}</p>
          {context && <dl className="case-context">
            <div><dt>Reviewed for</dt><dd>{context.party}</dd></div>
            <div><dt>Law</dt><dd>{context.governing_law}</dd></div>
            <div><dt>Risk appetite</dt><dd>{context.risk_appetite}</dd></div>
            <div className="wide"><dt>Objective</dt><dd>{context.objective}</dd></div>
          </dl>}
        </div>
        <div className="case-actions">
          <span className={`verdict ${flaggedChecks ? 'is-attention' : 'is-clear'}`}>{flaggedChecks ? <TriangleAlert aria-hidden="true" /> : <Check aria-hidden="true" />}{flaggedChecks ? `Issues in ${flaggedChecks} of ${points.length} checks` : `All ${points.length} checks clear`}</span>
          <div className="button-row">
            <button className="button" onClick={() => { download(`${item.id}-${run.scenario}-report.md`, renderReport(item, run, benchmark), 'text/markdown'); setNotice('Report downloaded.'); }}><ScrollText aria-hidden="true" />Download report</button>
            <button className="button button-quiet" onClick={() => { download(`${item.id}-${run.scenario}-evaluation.json`, JSON.stringify(run, null, 2)); setNotice('JSON downloaded.'); }}><Braces aria-hidden="true" />JSON</button>
            <CopyLink />
          </div>
        </div>
      </section>

      <ScoreBand run={run} base={matrix.baseline} points={points} onSelectClause={key => selectClause(key, 'findings')} />

      <Tabs value={tab} onValueChange={value => setTab(value as Tab)} className="lab-tabs">
        <TabsList variant="line" className="tab-list" aria-label="Views">
          <TabsTrigger value="review">Review<span className="tab-count" aria-label={`${openFindings} findings differ from the reference`}>{openFindings}</span></TabsTrigger>
          <TabsTrigger value="compare">Compare scenarios</TabsTrigger>
          <TabsTrigger value="method">Method</TabsTrigger>
        </TabsList>

        <TabsContent value="review" className="tab-panel">
          <ReviewSheet item={item} run={run} rows={rows} citations={citations} canonical={canonical} selected={selected} active={active} external={external}
            list={list} request={request} onList={setList} onSelectClause={key => selectClause(key)} onSelectCitation={selectCitation} onClearExternal={() => setExternal(null)} />
        </TabsContent>

        <TabsContent value="compare" className="tab-panel">
          <Compare item={item} run={run} matrix={matrix} target={compareWith} onTarget={setTarget} runs={runs} busy={!!pending} onReopen={reopen} onShowQuote={showQuote} />
        </TabsContent>

        <TabsContent value="method" className="tab-panel">
          <Method item={item} run={run} />
        </TabsContent>
      </Tabs>

    </main>
    <footer className="page-footer"><span>Contract Review Evidence Lab</span><span>Synthetic benchmark, v1 reference answers. Results need human review.</span></footer>
  </div>;
}
