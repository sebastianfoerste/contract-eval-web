import assert from 'node:assert/strict';
import fs from 'node:fs';
const origin=process.argv[2];
if(!origin)throw new Error('Pass the actual server URL.');
const vectors=JSON.parse(fs.readFileSync(new URL('./python-parity.json',import.meta.url))).filter(v=>v.scenario&&v.aliases==='on');
for(const v of vectors){
 const res=await fetch(new URL('/api/evaluate',origin),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({caseId:v.caseId,scenario:v.scenario})});
 assert.equal(res.status,200);
 const result=await res.json();assert.deepEqual(result.scores,v.expected);assert.ok(result.id);assert.ok(result.scoredAt);assert.equal(result.caseId,v.caseId);assert.equal(result.scenario,v.scenario);
}
for(const [body,type,status] of [['{','application/json',400],[JSON.stringify({caseId:'unknown',scenario:'baseline'}),'application/json',400],[JSON.stringify({caseId:'nda',scenario:'baseline',apiKey:'rejected'}),'application/json',400],['x'.repeat(1025),'application/json',413],['hello','text/plain',415]]){
 const res=await fetch(new URL('/api/evaluate',origin),{method:'POST',headers:{'Content-Type':type},body});assert.equal(res.status,status);assert.ok((await res.json()).error);
}
console.log('PASS: 12 hosted scoring comparisons and 5 invalid-request checks.');
