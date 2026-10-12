import type { Locale } from './i18n.ts';
export const tabs = ['review', 'compare', 'method'] as const;
export type Tab = (typeof tabs)[number];
export const lists = ['findings', 'quotations', 'clauses'] as const;
export type List = (typeof lists)[number];
export const panels = ['list', 'detail', 'contract'] as const;
export type Panel = (typeof panels)[number];
export type View = { caseId: string; scenario: string; tab: Tab; list: List; finding: string | null; quote: number | null; comparedQuote: number | null; compare: string; locale: Locale; panel: Panel; guided: boolean; edition: string | null };
export type Catalog = { cases: { id: string; keys: string[]; quotations?: Record<string, string[]> }[]; scenarios: string[] };
export type SearchParams = Record<string, string | string[] | undefined>;
const single = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;
const legacyTabs: Record<string, { tab: Tab; list: List }> = { findings: { tab: 'review', list: 'findings' }, evidence: { tab: 'review', list: 'quotations' } };
const index = (value: string | undefined, keys: string[] | undefined) => value && /^\d+$/.test(value) && keys && Number(value) > 0 && Number(value) <= keys.length ? Number(value) - 1 : null;
export function parseView(params: SearchParams, catalog: Catalog): View {
  const item = catalog.cases.find(value => value.id === single(params.case)) ?? catalog.cases[0];
  const scenario = catalog.scenarios.find(value => value === single(params.scenario)) ?? catalog.scenarios[0];
  const compare = catalog.scenarios.find(value => value === single(params.compare) && value !== scenario) ?? catalog.scenarios.find(value => value !== scenario)!;
  const tab = single(params.tab), legacy = tab && Object.hasOwn(legacyTabs, tab) ? legacyTabs[tab] : null;
  const quote = index(single(params.quote), item.quotations?.[scenario]);
  const comparedQuote = quote === null ? index(single(params.cquote), item.quotations?.[compare]) : null;
  const finding = single(params.finding);
  return { caseId: item.id, scenario, compare, tab: legacy?.tab ?? tabs.find(value => value === tab) ?? 'review', list: lists.find(value => value === single(params.list)) ?? legacy?.list ?? 'findings', finding: quote !== null ? item.quotations![scenario][quote] : comparedQuote !== null ? item.quotations![compare][comparedQuote] : finding && item.keys.includes(finding) ? finding : null, quote, comparedQuote, locale: single(params.lang) === 'de' ? 'de' : 'en', panel: panels.find(value => value === single(params.panel)) ?? (quote !== null || comparedQuote !== null ? 'contract' : 'list'), guided: single(params.guide) === '1' || (!Object.keys(params).some(key => key !== 'lang') && single(params.guide) !== '0'), edition: /^[a-f0-9]{40}$/.test(single(params.edition) ?? '') ? single(params.edition)! : null };
}
export function viewQuery(view: View, defaults: Pick<View, 'caseId' | 'scenario'>) {
  const params = new URLSearchParams();
  if (view.caseId !== defaults.caseId) params.set('case', view.caseId);
  if (view.scenario !== defaults.scenario) params.set('scenario', view.scenario);
  if (view.tab !== 'review') params.set('tab', view.tab);
  if (view.list !== 'findings') params.set('list', view.list);
  if (view.finding) params.set('finding', view.finding);
  if (view.quote !== null) params.set('quote', String(view.quote + 1));
  if (view.comparedQuote !== null) params.set('cquote', String(view.comparedQuote + 1));
  if (view.compare) params.set('compare', view.compare);
  if (view.locale !== 'en') params.set('lang', view.locale);
  if (view.panel !== 'list') params.set('panel', view.panel);
  params.set('guide', view.guided ? '1' : '0');
  if (view.edition) params.set('edition', view.edition);
  return `?${params.toString()}`;
}
