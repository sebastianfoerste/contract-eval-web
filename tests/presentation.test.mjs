import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {localizedReadout} from '../lib/presentation.ts';
import {applyScenario,scenarios,scoreReview} from '../lib/scoring.ts';
import {label,metricTitle,scenarioTitle} from '../lib/i18n.ts';
const benchmark=JSON.parse(fs.readFileSync(new URL('../lib/benchmark.json',import.meta.url)));
test('locale changes presentation without changing finding identity, priority or metric meaning',()=>{
  for(const item of benchmark.cases) for(const scenario of Object.keys(scenarios)){
    const review=applyScenario(item.review,scenario),scores=scoreReview(item.source,item.gold,review);
    const before=JSON.stringify({review,scores});
    const english=localizedReadout(item.gold,review,scores,'en'),german=localizedReadout(item.gold,review,scores,'de');
    assert.deepEqual(german.map(({metric,tone,findings})=>({metric,tone,findings})),english.map(({metric,tone,findings})=>({metric,tone,findings})));
    assert.equal(JSON.stringify({review,scores}),before);
    for(const point of german) assert.ok(metricTitle('de',point.metric)!==point.metric);
    for(const key of item.gold.clause_types) assert.ok(label('de',key)!==key);
    assert.ok(scenarioTitle('de',scenario)!==scenario);
  }
});
