'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, Braces, FlaskConical, ScrollText } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Compare } from '@/components/lab/compare';
import { Method } from '@/components/lab/method';
import { CopyLink, Segmented, ThemeSwitch, download } from '@/components/lab/primitives';
import { ReviewSheet } from '@/components/lab/review';
import { ScoreBand } from '@/components/lab/scores';
import { LocaleContext, useLocale } from '@/components/lab/locale';
import type { Locale } from '@/lib/i18n';
import benchmark from '@/lib/benchmark';
import { findCase, snapshot, type Evaluation } from '@/lib/evaluation';
import { canonicalClause, orderFindings, riskFindings } from '@/lib/inspection';
import { localizedReadout } from '@/lib/presentation';
import { renderReport } from '@/lib/report';
import { locateSource, scenarios, type Scenario } from '@/lib/scoring';
import { viewQuery, type List, type Tab, type View, type Panel } from '@/lib/view';

type Selection = { caseId: string; scenario: Scenario };
class StalePageError extends Error {}
const defaults = { caseId: benchmark.cases[0].id, scenario: 'baseline' };
function defaultFinding(run: Evaluation) {
  const item = findCase(run.caseId), rows = orderFindings(riskFindings(item.gold, run.review, run.scores));
  return (rows.find(row => row.status !== 'Match') ?? rows[0])?.key ?? item.gold.clause_types[0];
}
export default function Workspace({ initialView }: { initialView: View }) {
  const [locale, setLocale] = useState<Locale>(initialView.locale);
  return <LocaleContext.Provider value={locale}><WorkspaceContent initialView={initialView} onLocale={setLocale} /></LocaleContext.Provider>;
}
function WorkspaceContent({ initialView, onLocale }: { initialView: View; onLocale: (locale: Locale) => void }) {
  const { t, locale, label, caseTitle, scenarioTitle, scenarioDescription } = useLocale();
  const [run, setRun] = useState<Evaluation>(() => snapshot(initialView.caseId, initialView.scenario as Scenario));
  const [runs, setRuns] = useState<Evaluation[]>([]);
  const [tab, setTab] = useState<Tab>(initialView.tab);
  const [list, setList] = useState<List>(initialView.list);
  const [panel, setPanel] = useState<Panel>(initialView.panel);
  const [guided, setGuided] = useState(initialView.guided);
  const [chosenFinding, setChosenFinding] = useState<string | null>(initialView.finding);
  const [active, setActive] = useState<number | null>(initialView.quote);
  const [comparedQuote, setComparedQuote] = useState<number | null>(initialView.comparedQuote);
  const [target, setTarget] = useState<Scenario>(initialView.compare as Scenario);
  const [pending, setPending] = useState<Selection | null>(null);
  const [failed, setFailed] = useState<Selection | null>(null);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState<'timeout' | 'network' | 'server' | 'stale' | ''>('');
  const [notice, setNotice] = useState<'updated' | 'download' | 'reopened' | 'agent' | ''>('');
  const [request, setRequest] = useState(0);
  const inFlight = useRef(false), queued = useRef<Selection | null>(null), shownCase = useRef(initialView.caseId);
  const item = findCase(run.caseId), selected = chosenFinding ?? defaultFinding(run);
  const canonical = useCallback((key: string) => canonicalClause(item.gold.clause_aliases, key), [item]);
  const citations = useMemo(() => run.review.citations.map((citation, index) => ({...citation, index, sourceSpan: locateSource(item.source, citation.quote)})), [run, item]);
  const rows = useMemo(() => orderFindings(riskFindings(item.gold, run.review, run.scores)), [item, run]);
  const points = useMemo(() => localizedReadout(item.gold, run.review, run.scores, locale), [item, run, locale]);
  const matrix = useMemo(() => Object.fromEntries(Object.keys(scenarios).map(key => [key, snapshot(item.id, key as Scenario)])) as Record<Scenario, Evaluation>, [item.id]);
  const compareWith: Scenario = target !== run.scenario ? target : run.scenario === 'baseline' ? 'no-evidence' : 'baseline';
  const externalCitation = comparedQuote !== null ? matrix[compareWith].review.citations[comparedQuote] : undefined;
  const external = externalCitation ? locateSource(item.source, externalCitation.quote) : null;
  const shown: Selection = pending ?? { caseId: run.caseId, scenario: run.scenario };
  const openFindings = rows.filter(row => row.status !== 'Match').length;
  const context = item.gold.review_context;
  const errorText = error ? {timeout:t('The update timed out. Your previous result is still displayed.', 'Die Aktualisierung hat zu lange gedauert. Das bisherige Ergebnis bleibt sichtbar.'), network:t('The evaluator could not be reached. Your previous result is still displayed.', 'Die Bewertung ist nicht erreichbar. Das bisherige Ergebnis bleibt sichtbar.'), server:t('The update failed. Your previous result is still displayed.', 'Die Aktualisierung ist fehlgeschlagen. Das bisherige Ergebnis bleibt sichtbar.'), stale:t('The reference set changed. Reload before comparing results.', 'Der Referenzstand hat sich geändert. Vor einem Vergleich bitte neu laden.')}[error] : '';
  const noticeText = notice ? {updated:t('Review updated.', 'Prüfung aktualisiert.'),download:t('Download requested. Check your browser downloads.', 'Download angefordert. Bitte die Browser-Downloads prüfen.'),reopened:t('Saved session result displayed.', 'Ergebnis aus dieser Sitzung angezeigt.'),agent:t('Browser agent controls are unavailable; use the visible controls.', 'Browser-Agentensteuerung nicht verfügbar; bitte die sichtbaren Bedienelemente verwenden.')}[notice] : '';

  const show = useCallback((result: Evaluation) => {
    if (shownCase.current !== result.caseId) setChosenFinding(null);
    shownCase.current = result.caseId;
    setRun(result); setActive(null); setComparedQuote(null);
  }, []);
  const perform = useCallback(async (caseId: string, scenario: Scenario) => {
    if (inFlight.current) throw new Error('Evaluation already running');
    inFlight.current = true; setError(''); setFailed(null);
    let next: Selection | null = {caseId, scenario}, result: Evaluation | null = null;
    try {
      while (next) {
        const current: Selection = next; queued.current = null; setPending(current);
        const response = await fetch('/api/evaluate', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(current), signal:AbortSignal.timeout(20000)});
        const data: unknown = await response.json();
        if (!response.ok || !data || typeof data !== 'object' || !('caseId' in data) || data.caseId !== current.caseId || !('scenario' in data) || data.scenario !== current.scenario || !('scores' in data) || !('review' in data)) throw new Error('Invalid evaluation response');
        result = data as Evaluation;
        if (result.provenance?.sourceCommit !== benchmark.sourceCommit) throw new StalePageError();
        setRuns(old => [result!, ...old].slice(0, 30)); next = queued.current;
      }
      show(result!); setNotice('updated');
      return {runId:result!.id, caseId:result!.caseId, scenario:result!.scenario, scores:result!.scores};
    } catch (cause) {
      setError(cause instanceof StalePageError ? 'stale' : cause instanceof DOMException && cause.name === 'TimeoutError' ? 'timeout' : cause instanceof TypeError ? 'network' : 'server');
      setStale(cause instanceof StalePageError); setFailed(queued.current ?? {caseId,scenario}); throw cause;
    } finally { inFlight.current = false; setPending(null); queued.current = null; }
  }, [show]);
  const choose = (selection: Selection) => {
    if (inFlight.current) { queued.current = selection; setPending(selection); return; }
    void perform(selection.caseId, selection.scenario).catch(() => {});
  };
  useEffect(() => {
    type Context = {registerTool: (tool: {name:string;description:string;inputSchema:object;execute:(input:unknown)=>Promise<unknown>;annotations:{readOnlyHint:boolean}}, options:{signal:AbortSignal})=>void|Promise<void>};
    const context = (document as Document & {modelContext?:Context}).modelContext;
    if (!context) return;
    const life = new AbortController();
    Promise.resolve().then(() => life.signal.aborted ? undefined : context.registerTool({name:'run_synthetic_contract_evaluation',description:'Run a bounded synthetic contract evaluation; no model call or payment.',inputSchema:{type:'object',properties:{caseId:{type:'string',enum:benchmark.cases.map(c=>c.id)},scenario:{type:'string',enum:Object.keys(scenarios)}},required:['caseId','scenario'],additionalProperties:false},annotations:{readOnlyHint:false},execute:async(input:unknown)=>{
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Expected a case and scenario');
      const args = input as Record<string,unknown>;
      if (Object.keys(args).some(key=>key!=='caseId'&&key!=='scenario') || !benchmark.cases.some(c=>c.id===args.caseId) || typeof args.scenario!=='string' || !Object.hasOwn(scenarios,args.scenario)) throw new Error('Unknown case or scenario');
      return perform(String(args.caseId),args.scenario as Scenario);
    }},{signal:life.signal})).catch(()=>{if(!life.signal.aborted)setNotice('agent');});
    return ()=>life.abort();
  },[perform]);
  useEffect(() => { document.documentElement.lang = locale; }, [locale]);
  useEffect(() => {
    const query = viewQuery({caseId:run.caseId,scenario:run.scenario,tab,list,finding:chosenFinding,quote:active,comparedQuote,compare:compareWith,locale,panel,guided,edition:benchmark.sourceCommit}, defaults);
    if (window.location.search !== query) window.history.replaceState(window.history.state,'',`${window.location.pathname}${query}${window.location.hash}`);
  },[run.caseId,run.scenario,tab,list,chosenFinding,active,comparedQuote,compareWith,locale,panel,guided]);
  useEffect(() => {
    // Move focus for a user-requested jump, never merely because a shared URL restored.
    if (!request) return;
    const phone = window.matchMedia('(max-width: 999px)').matches;
    const destination = document.getElementById({list:'finding-list',detail:'detail',contract:'contract-panel'}[panel]);
    if (panel === 'contract') {
      const quotation = document.querySelector<HTMLElement>('.contract-body mark.is-external, .contract-body mark.is-active');
      (quotation ?? destination)?.focus({preventScroll:true});
    } else if (phone) destination?.focus({preventScroll:true});
    if (phone) destination?.scrollIntoView({block:'start',behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
  },[request,panel]);
  function openPanel(value:Panel) {setPanel(value);setRequest(count=>count+1);}
  function selectClause(key:string, from?:List) {setChosenFinding(canonical(key));setActive(null);setComparedQuote(null);if(from)setList(from);setTab('review');openPanel('detail');}
  function selectCitation(index:number) {setChosenFinding(canonical(citations[index].clause_type));setActive(index);setComparedQuote(null);setTab('review');openPanel('contract');}
  function showQuote(quote:string, clause:string, comparisonIndex:number|null) {
    setChosenFinding(canonical(clause));setTab('review');
    setComparedQuote(comparisonIndex !== null && comparisonIndex >= 0 ? comparisonIndex : null);
    const own = run.review.citations.findIndex(citation=>citation.quote===quote && canonical(citation.clause_type)===canonical(clause));
    setActive(comparisonIndex === null && own >= 0 ? own : null);openPanel('contract');
  }
  function guidedExample() {
    const example = snapshot('nda'); show(example);setChosenFinding('permitted_disclosure');setActive(example.review.citations.findIndex(citation=>citation.clause_type==='permitted_disclosure'));setGuided(false);setTab('review');setList('findings');openPanel('detail');
  }
  const reportQuery = new URLSearchParams({case:run.caseId,scenario:run.scenario,lang:locale,edition:benchmark.sourceCommit}).toString();
  return <div className="lab" lang={locale}>
    <a className="skip-link" href="#workspace">{t('Skip to the evaluation','Zur Bewertung springen')}</a>
    <header className="topbar"><Link className="brand" href="/" aria-label="Evidence Lab"><span className="brand-mark"><FlaskConical aria-hidden="true" /></span><span className="brand-text"><small>{t('Contract review','Vertragsprüfung')}</small>Evidence Lab</span></Link><div className="topbar-right"><a href={benchmark.repository} target="_blank" rel="noreferrer">{t('Source code','Quellcode')}<ArrowUpRight aria-hidden="true" /></a><div className="language-switch" role="group" aria-label={t('Language','Sprache')}>{(['en','de'] as const).map(value=><button key={value} lang={value} aria-pressed={locale===value} onClick={()=>onLocale(value)}>{value.toUpperCase()}</button>)}</div><ThemeSwitch /></div></header>
    <main id="workspace" className="lab-main">
      {!guided && <h1 className="sr-only">{t('Contract Review Evidence Lab','Evidence Lab für Vertragsprüfungen')}</h1>}
      {initialView.edition && initialView.edition !== benchmark.sourceCommit && <p className="edition-warning" role="alert">{t('This link refers to an older reference edition. The current edition is displayed; historical results are not restored.', 'Dieser Link verweist auf einen älteren Referenzstand. Angezeigt wird der aktuelle Stand; historische Ergebnisse werden nicht wiederhergestellt.')}</p>}
      {guided ? <section className="guided-intro" aria-labelledby="guide-title"><p className="eyebrow">{t('Start with one legal mistake','Ein juristischer Fehler als Einstieg')}</p><h1 id="guide-title">{t('The clause was found. Its risk was understated.','Die Klausel wurde erkannt. Ihr Risiko wurde unterschätzt.')}</h1><p>{t('In this synthetic NDA, disclosure required by law is made conditional on prior consent. The reference rates the risk high; the fixed review rates it medium.', 'Diese synthetische Geheimhaltungsvereinbarung knüpft eine gesetzlich verlangte Offenlegung an eine vorherige Zustimmung. Die Referenz bewertet das Risiko als hoch, die feste Prüfung als mittel.')}</p><blockquote lang="en">“{findCase('nda').review.citations.find(citation=>citation.clause_type==='permitted_disclosure')!.quote}”</blockquote><p className="source-language">{t('Exact English quotation. Inspect the reference judgment and the surrounding clause.', 'Exaktes englisches Zitat. Referenzbeurteilung und Klauselkontext gemeinsam prüfen.')}</p><div className="button-row"><button className="button" disabled={!!pending} onClick={guidedExample}>{t('Inspect this finding','Feststellung prüfen')}</button><button className="button button-quiet" onClick={()=>setGuided(false)}>{t('Explore independently','Direkt erkunden')}</button></div></section> : <div className="intro-line"><p>{t('Trace a review finding back to the contract. Fixed synthetic examples; no live model.','Feststellungen bis zum Vertrag zurückverfolgen. Feste synthetische Beispiele; kein Live-Modell.')}</p><button className="link-button" onClick={()=>setGuided(true)}>{t('Guided example','Geführtes Beispiel')}</button></div>}
      <section className="deck" aria-label={t('Evaluation controls','Bewertungsauswahl')}>
        <Segmented legend={t('Contract','Vertrag')} name="contract" value={run.caseId} pending={pending?.caseId} options={benchmark.cases.map(c=>({value:c.id,label:caseTitle(c.id,c.title)}))} onChange={caseId=>choose({caseId,scenario:shown.scenario})} />
        <Segmented legend={t('Review scenario','Prüfszenario')} name="scenario" value={run.scenario} pending={pending?.scenario} options={(Object.keys(scenarios) as Scenario[]).map(key=>({value:key,label:scenarioTitle(key)}))} onChange={scenario=>choose({caseId:shown.caseId,scenario})}><p className="deck-hint">{scenarioDescription(shown.scenario)}</p></Segmented>
        <p className={`deck-status ${error?'is-error':''}`} role="status" aria-live="polite">{errorText || (pending?t('Updating; the previous result remains visible…','Wird aktualisiert; das bisherige Ergebnis bleibt sichtbar…'):noticeText || t('Reference edition ready. Choose a scenario to explore its effect.','Referenzstand bereit. Ein Szenario zeigt dessen Auswirkungen.'))}{error && (stale?<button className="link-button" onClick={()=>window.location.reload()}>{t('Reload','Neu laden')}</button>:failed&&<button className="link-button" onClick={()=>choose(failed)}>{t('Try again','Erneut versuchen')}</button>)}</p>
      </section>
      <section className="case" aria-labelledby="case-heading"><div className="case-title"><h2 id="case-heading">{caseTitle(item.id,item.title)}</h2><p className="case-scenario">{scenarioTitle(run.scenario)}</p>{context&&<details className="review-context"><summary>{t('Review perspective and original instructions','Prüfperspektive und Originalvorgaben')}</summary><dl className="case-context"><div><dt>{t('Reviewed for','Geprüft für')}</dt><dd lang="en">{context.party}</dd></div><div><dt>{t('Law','Recht')}</dt><dd lang="en">{context.governing_law}</dd></div><div><dt>{t('Risk appetite','Risikoneigung')}</dt><dd lang="en">{context.risk_appetite}</dd></div><div className="wide"><dt>{t('Objective (English source)','Ziel (englisches Original)')}</dt><dd lang="en">{context.objective}</dd></div></dl></details>}</div>
      <div className="case-actions"><div className="button-row"><a className="button" href={`/report?${reportQuery}`} target="_blank" rel="noreferrer">{t('Report / Save PDF','Bericht / PDF speichern')}</a><button className="button button-quiet" onClick={()=>{download(`${item.id}-${run.scenario}-${locale}-report.md`,renderReport(item,run,benchmark,locale),'text/markdown');setNotice('download');}}><ScrollText aria-hidden="true" />Markdown</button><button className="button button-quiet" onClick={()=>{download(`${item.id}-${run.scenario}-evaluation.json`,JSON.stringify(run,null,2));setNotice('download');}}><Braces aria-hidden="true" />JSON</button><CopyLink /></div></div></section>
      <section className="result-summary" aria-label={t('Result summary','Ergebnisübersicht')} aria-busy={!!pending}><div><strong>{openFindings}</strong><span>{t('findings differ from the reference','Feststellungen weichen von der Referenz ab')}</span></div><div><strong>{run.scores.risk_missed.length}</strong><span>{t('reference risks missed','Referenzrisiken übersehen')}</span></div><div><strong>{run.scores.hallucination_count}</strong><span>{t('quotations not in the contract','Zitate nicht im Vertrag')}</span></div><p>{t('These are differences from a bounded reference judgment, not a legal release decision.','Dies sind Abweichungen von einer begrenzten Referenzbeurteilung, keine rechtliche Freigabe.')}</p></section>
      <details className="metrics-disclosure"><summary>{t('Detailed scores and definitions','Kennzahlen und Definitionen')}</summary><ScoreBand run={run} base={matrix.baseline} points={points} onSelectClause={key=>selectClause(key,'findings')} /></details>
      <Tabs value={tab} onValueChange={value=>setTab(value as Tab)} className="lab-tabs"><TabsList variant="line" className="tab-list" aria-label={t('Views','Ansichten')}><TabsTrigger value="review">{t('Review','Prüfung')}<span className="tab-count">{openFindings}</span></TabsTrigger><TabsTrigger value="compare">{t('Compare scenarios','Szenarien vergleichen')}</TabsTrigger><TabsTrigger value="method">{t('Method','Methode')}</TabsTrigger></TabsList>
      <TabsContent value="review" className="tab-panel"><p className="sr-only" role="status">{t('Selected finding','Ausgewählte Feststellung')}: {label(selected)}</p><ReviewSheet item={item} run={run} rows={rows} citations={citations} canonical={canonical} selected={selected} active={active} external={external} list={list} panel={panel} onPanel={openPanel} request={request} onList={setList} onSelectClause={key=>selectClause(key)} onSelectCitation={selectCitation} onClearExternal={()=>setComparedQuote(null)} /></TabsContent>
      <TabsContent value="compare" className="tab-panel"><Compare item={item} run={run} matrix={matrix} target={compareWith} onTarget={value=>{setTarget(value);setComparedQuote(null);}} runs={runs} busy={!!pending} onReopen={saved=>{show(saved);setNotice('reopened');setTab('review');}} onShowQuote={showQuote} /></TabsContent>
      <TabsContent value="method" className="tab-panel"><Method item={item} run={run} /></TabsContent></Tabs>
    </main><footer className="page-footer"><span>Contract Review Evidence Lab</span><span>{t('Synthetic benchmark, v1 reference answers. Human review required.','Synthetischer Benchmark, v1-Referenzantworten. Menschliche Prüfung erforderlich.')}</span></footer>
  </div>;
}
