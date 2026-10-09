export const tabs = ['review', 'compare', 'method'] as const;
export type Tab = (typeof tabs)[number];

/** What the review sheet lists beside the contract. */
export const lists = ['findings', 'quotations', 'clauses'] as const;
export type List = (typeof lists)[number];

export type View = { caseId: string; scenario: string; tab: Tab; list: List; finding: string | null };
export type Catalog = { cases: { id: string; keys: string[] }[]; scenarios: string[] };
export type SearchParams = Record<string, string | string[] | undefined>;

const single = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;

// Links shared before the findings and evidence tabs were merged into the review sheet.
const legacyTabs: Record<string, { tab: Tab; list: List }> = {
  findings: { tab: 'review', list: 'findings' },
  evidence: { tab: 'review', list: 'quotations' },
};

/** Read a shareable view from the query string. Anything outside the catalog falls back to the default. */
export function parseView(params: SearchParams, catalog: Catalog): View {
  const requestedCase = single(params.case);
  const item = catalog.cases.find(value => value.id === requestedCase) ?? catalog.cases[0];
  const requestedScenario = single(params.scenario);
  const requestedTab = single(params.tab);
  const requestedList = single(params.list);
  const requestedFinding = single(params.finding);
  const legacy = requestedTab && Object.hasOwn(legacyTabs, requestedTab) ? legacyTabs[requestedTab] : null;
  return {
    caseId: item.id,
    scenario: requestedScenario && catalog.scenarios.includes(requestedScenario) ? requestedScenario : catalog.scenarios[0],
    tab: legacy?.tab ?? tabs.find(tab => tab === requestedTab) ?? tabs[0],
    list: lists.find(list => list === requestedList) ?? legacy?.list ?? lists[0],
    finding: requestedFinding && item.keys.includes(requestedFinding) ? requestedFinding : null,
  };
}

/** Serialise a view, omitting values that equal the defaults so the plain URL stays clean. */
export function viewQuery(view: View, defaults: Pick<View, 'caseId' | 'scenario'>) {
  const params = new URLSearchParams();
  if (view.caseId !== defaults.caseId) params.set('case', view.caseId);
  if (view.scenario !== defaults.scenario) params.set('scenario', view.scenario);
  if (view.tab !== tabs[0]) params.set('tab', view.tab);
  if (view.list !== lists[0]) params.set('list', view.list);
  if (view.finding) params.set('finding', view.finding);
  const query = params.toString();
  return query ? `?${query}` : '';
}
