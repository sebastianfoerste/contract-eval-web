'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, Braces, Check, FileText, FlaskConical, GitCompareArrows, ListChecks, ScrollText, ShieldCheck, TriangleAlert } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Compare, scenarioLabels } from '@/components/lab/compare';
import { Evidence } from '@/components/lab/evidence';
import { Coverage, FindingsTable, Inspector, ScoreCards } from '@/components/lab/findings';
import { Method } from '@/components/lab/method';
import { Segmented, download } from '@/components/lab/primitives';
import benchmark from '@/lib/benchmark';
import { findCase, snapshot, type Evaluation } from '@/lib/evaluation';
import { orderFindings, readout, riskFindings } from '@/lib/inspection';
import { renderReport } from '@/lib/report';
import { locateSource, scenarios, type Scenario } from '@/lib/scoring';
import { viewQuery, type Tab, type View } from '@/lib/view';

type Selection = { caseId: string; scenario: Scenario };
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
  const [chosenFinding, setChosenFinding] = useState<string | null>(initialView.finding);
  const [pending, setPending] = useState<Selection | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [active, setActive] = useState<number | null>(null);
  const [external, setExternal] = useState<[number, number] | null>(null);
  const [target, setTarget] = useState<Scenario>('baseline');
  const inFlight = useRef(false);
  const queued = useRef<Selection | null>(null);
  const shownCase = useRef(initialView.caseId);
  const revealInspector = useRef(false);

  const item = findCase(run.caseId);
  const finding = chosenFinding ?? defaultFinding(run);
  const canonical = useCallback((key: string) => item.gold.clause_aliases[key] || key, [item]);
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
        if (!response.ok) throw new Error(data && typeof data === 'object' && 'error' in data ? String(data.error) : 'Evaluation failed. Please try again.');
        result = data as Evaluation;
        setRuns(old => [result!, ...old].slice(0, 30));
        next = queued.current;
      }
      show(result!);
      setNotice(`Scored on the server at ${new Date(result!.scoredAt).toLocaleTimeString()}.`);
      return { runId: result!.id, caseId: result!.caseId, scenario: result!.scenario, scores: result!.scores };
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Evaluation failed.');
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
    Promise.resolve().then(() => context.registerTool({
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
    const query = viewQuery({ caseId: run.caseId, scenario: run.scenario, tab, finding: chosenFinding }, defaults);
    const { pathname, search, hash } = window.location;
    if (search !== query) window.history.replaceState(window.history.state, '', `${pathname}${query}${hash}`);
  }, [run.caseId, run.scenario, tab, chosenFinding]);

  useEffect(() => {
    if (tab !== 'findings' || !revealInspector.current) return;
    revealInspector.current = false;
    document.getElementById('inspector-heading')?.scrollIntoView({ block: 'nearest', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  }, [tab, finding]);

  function inspect(key: string, reveal = false) {
    revealInspector.current = reveal;
    setChosenFinding(canonical(key));
    setTab('findings');
  }

  function showCitation(index: number) {
    setActive(index);
    setExternal(null);
    setTab('evidence');
  }

  function showQuote(quote: string) {
    const own = citations.find(citation => citation.quote === quote && citation.sourceSpan);
    if (own) return showCitation(own.index);
    const span = locateSource(item.source, quote);
    if (!span) return setNotice('This quotation is not located in the source contract.');
    setActive(null);
    setExternal(span);
    setTab('evidence');
  }

  function reopen(saved: Evaluation) {
    show(saved);
    setTab('findings');
  }

  const grounded = citations.filter(citation => citation.sourceSpan).length;
  const context = item.gold.review_context;

  return <div className="lab">
    <a className="skip-link" href="#workspace">Skip to the evaluation</a>
    <header className="topbar">
      <Link className="brand" href="/" aria-label="Contract Review Evidence Lab, home"><span className="brand-mark"><FlaskConical aria-hidden="true" /></span><span className="brand-text"><small>Contract review</small>Evidence Lab</span></Link>
      <div className="topbar-right"><span className="pill">Public research demo · synthetic data</span><a href={benchmark.repository} target="_blank" rel="noreferrer">Source code<ArrowUpRight aria-hidden="true" /></a></div>
    </header>

    <main id="workspace" className="lab-main">
      <section className="intro">
        <div>
          <p className="eyebrow">Evaluate · inspect · compare</p>
          <h1>Put the review to the test.</h1>
          <p className="lede">Pick a synthetic contract, stress the AI review with a failure scenario, and trace every score back to the words of the contract.</p>
        </div>
        <dl className="edition">
          <div><dt>Contracts</dt><dd>{benchmark.cases.length} synthetic</dd></div>
          <div><dt>Reference</dt><dd>v1 answers</dd></div>
          <div><dt>Models called</dt><dd>None</dd></div>
        </dl>
      </section>

      <section className="deck" aria-label="Evaluation controls">
        <Segmented legend={<><span className="step">1</span>Contract</>} name="contract" value={run.caseId} pending={pending?.caseId}
          options={benchmark.cases.map(c => ({ value: c.id, label: c.title }))} onChange={caseId => choose({ caseId, scenario: shown.scenario })} />
        <Segmented legend={<><span className="step">2</span>Failure scenario</>} name="scenario" value={run.scenario} pending={pending?.scenario}
          options={(Object.keys(scenarios) as Scenario[]).map(key => ({ value: key, label: scenarioLabels[key] }))} onChange={scenario => choose({ caseId: shown.caseId, scenario })}>
          <p className="deck-hint">{scenarios[shown.scenario].description}</p>
        </Segmented>
        <p className={`deck-status ${error ? 'is-error' : ''}`} role="status" aria-live="polite">{error || (pending ? 'Scoring on the server…' : notice || 'Reference snapshot computed in your browser. Any choice above is re-scored on the server.')}</p>
      </section>

      <section className="case-header" aria-labelledby="case-heading">
        <div className="case-title">
          <p className="eyebrow">{scenarios[run.scenario].title}</p>
          <h2 id="case-heading">{item.title}</h2>
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
            <button className="button" onClick={() => { download(`${item.id}-${run.scenario}-report.md`, renderReport(item, run), 'text/markdown'); setNotice('Evidence report downloaded.'); }}><ScrollText aria-hidden="true" />Report</button>
            <button className="button button-quiet" onClick={() => download(`${item.id}-${run.scenario}-evaluation.json`, JSON.stringify(run, null, 2))}><Braces aria-hidden="true" />JSON</button>
          </div>
        </div>
      </section>

      <Tabs value={tab} onValueChange={value => setTab(value as Tab)} className="lab-tabs">
        <TabsList variant="line" className="tab-list" aria-label="Views">
          <TabsTrigger value="findings"><ListChecks />Findings<span className="tab-count" aria-label={`${openFindings} open`}>{openFindings}</span></TabsTrigger>
          <TabsTrigger value="evidence"><FileText />Evidence<span className="tab-count">{grounded}/{citations.length}</span></TabsTrigger>
          <TabsTrigger value="compare"><GitCompareArrows />Compare</TabsTrigger>
          <TabsTrigger value="method"><ShieldCheck />Method</TabsTrigger>
        </TabsList>

        <TabsContent value="findings" className="tab-panel">
          <ScoreCards run={run} base={matrix.baseline} points={points} onSelectFinding={key => inspect(key, true)} />
          <div className="findings-layout">
            <FindingsTable rows={rows} selected={finding} onSelect={key => setChosenFinding(key)} />
            <Inspector item={item} run={run} finding={finding} row={rows.find(row => row.key === finding)} citations={citations} canonical={canonical} onShowCitation={showCitation} />
          </div>
          <Coverage item={item} run={run} />
        </TabsContent>

        <TabsContent value="evidence" className="tab-panel">
          <Evidence item={item} run={run} citations={citations} active={active} external={external}
            onActivate={index => { setExternal(null); setActive(index); }} onInspect={key => inspect(key, true)} />
          {external && <p className="external-note" role="status"><span className="legend-swatch is-external" />Highlighted passage comes from the compared run, not from this review. <button className="link-button" onClick={() => setExternal(null)}>Clear</button></p>}
        </TabsContent>

        <TabsContent value="compare" className="tab-panel">
          <Compare item={item} run={run} matrix={matrix} target={compareWith} onTarget={setTarget} runs={runs} busy={!!pending} onReopen={reopen} onShowQuote={showQuote} />
        </TabsContent>

        <TabsContent value="method" className="tab-panel">
          <Method item={item} run={run} />
        </TabsContent>
      </Tabs>

      <footer className="page-footer"><span><FlaskConical aria-hidden="true" />Contract Review Evidence Lab</span><span>Synthetic benchmark · Human review required · v1 reference edition</span></footer>
    </main>
  </div>;
}

