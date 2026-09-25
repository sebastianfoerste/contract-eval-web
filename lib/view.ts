export const tabs = ['findings', 'evidence', 'compare', 'method'] as const;
export type Tab = (typeof tabs)[number];

export type View = { caseId: string; scenario: string; tab: Tab; finding: string | null };
export type Catalog = { cases: { id: string; keys: string[] }[]; scenarios: string[] };
export type SearchParams = Record<string, string | string[] | undefined>;

const single = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;

/** Read a shareable view from the query string. Anything outside the catalog falls back to the default. */
export function parseView(params: SearchParams, catalog: Catalog): View {
  const requestedCase = single(params.case);
  const item = catalog.cases.find(value => value.id === requestedCase) ?? catalog.cases[0];
  const requestedScenario = single(params.scenario);
  const requestedTab = single(params.tab);
  const requestedFinding = single(params.finding);
  return {
    caseId: item.id,
    scenario: requestedScenario && catalog.scenarios.includes(requestedScenario) ? requestedScenario : catalog.scenarios[0],
    tab: tabs.find(tab => tab === requestedTab) ?? tabs[0],
    finding: requestedFinding && item.keys.includes(requestedFinding) ? requestedFinding : null,
  };
}

/** Serialise a view, omitting values that equal the defaults so the plain URL stays clean. */
export function viewQuery(view: View, defaults: Pick<View, 'caseId' | 'scenario'>) {
  const params = new URLSearchParams();
  if (view.caseId !== defaults.caseId) params.set('case', view.caseId);
  if (view.scenario !== defaults.scenario) params.set('scenario', view.scenario);
  if (view.tab !== tabs[0]) params.set('tab', view.tab);
  if (view.finding) params.set('finding', view.finding);
  const query = params.toString();
  return query ? `?${query}` : '';
}
