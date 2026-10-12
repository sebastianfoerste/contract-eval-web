import assert from 'node:assert/strict';
import fs from 'node:fs';
const origin=process.argv[2];
if(!origin)throw new Error('Pass the actual server URL.');
// A stalled server fails the check instead of hanging it.
const timeout=()=>AbortSignal.timeout(10000);
const vectors=JSON.parse(fs.readFileSync(new URL('./python-parity.json',import.meta.url))).filter(v=>v.scenario&&v.aliases==='on');
for(const v of vectors){
 const res=await fetch(new URL('/api/evaluate',origin),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({caseId:v.caseId,scenario:v.scenario}),signal:timeout()});
 assert.equal(res.status,200);
 const result=await res.json();assert.deepEqual(result.scores,v.expected);assert.ok(result.id);assert.ok(result.scoredAt);assert.equal(result.caseId,v.caseId);assert.equal(result.scenario,v.scenario);
}
for(const [body,type,status] of [['{','application/json',400],[JSON.stringify({caseId:'unknown',scenario:'baseline'}),'application/json',400],[JSON.stringify({caseId:'nda',scenario:'baseline',apiKey:'rejected'}),'application/json',400],['x'.repeat(1025),'application/json',413],['hello','text/plain',415]]){
 const res=await fetch(new URL('/api/evaluate',origin),{method:'POST',headers:{'Content-Type':type},body,signal:timeout()});assert.equal(res.status,status);assert.ok((await res.json()).error);
}
for (const [path, expected] of [
 ['/report?case=nda&scenario=no-evidence&lang=de','Keine Zitate angegeben'],
 ['/report?edition='+'0'.repeat(40),'Reference edition changed'],
 ['/candidates?lang=en','hand-authored REPLAY'],
 ['/candidates?lang=de','Anwendungsvalidierung: abgelehnt'],
 ['/candidates/experiment?id=replay-dry-run&lang=en','No model was called'],
 ['/candidates/experiment?id=replay-dry-run&lang=de','Es wurde kein Modell aufgerufen'],
 ['/candidates/experiment?id=unknown-experiment&lang=en','No bundled experiment at this address'],
]) {
 const response=await fetch(new URL(path,origin),{signal:timeout()});
 assert.equal(response.status,200);
 assert.ok((await response.text()).includes(expected),`Missing report content at ${path}`);
}
console.log('PASS: 12 HTTP scoring comparisons, 5 invalid-request checks and 7 report/replay/experiment route checks.');
