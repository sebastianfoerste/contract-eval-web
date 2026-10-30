import assert from 'node:assert/strict';
import fs from 'node:fs';
const origin=process.argv[2];
if(!origin)throw new Error('Pass the actual server URL.');
// A stalled server fails the check instead of hanging it, and the error names the request.
const call=async(path,init={})=>{
 try{const res=await fetch(new URL(path,origin),{...init,signal:AbortSignal.timeout(10000)});return {status:res.status,text:await res.text()};}
 catch(error){throw new Error(`${init.method??'GET'} ${path} did not complete: ${error.message}`,{cause:error});}
};
const vectors=JSON.parse(fs.readFileSync(new URL('./python-parity.json',import.meta.url))).filter(v=>v.scenario&&v.aliases==='on');
for(const v of vectors){
 const res=await call('/api/evaluate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({caseId:v.caseId,scenario:v.scenario})});
 assert.equal(res.status,200);
 const result=JSON.parse(res.text);assert.deepEqual(result.scores,v.expected);assert.ok(result.id);assert.ok(result.scoredAt);assert.equal(result.caseId,v.caseId);assert.equal(result.scenario,v.scenario);
}
for(const [body,type,status] of [['{','application/json',400],[JSON.stringify({caseId:'unknown',scenario:'baseline'}),'application/json',400],[JSON.stringify({caseId:'nda',scenario:'baseline',apiKey:'rejected'}),'application/json',400],['x'.repeat(1025),'application/json',413],['hello','text/plain',415]]){
 const res=await call('/api/evaluate',{method:'POST',headers:{'Content-Type':type},body});assert.equal(res.status,status);assert.ok(JSON.parse(res.text).error);
}
for (const [path, expected] of [
 ['/report?case=nda&scenario=no-evidence&lang=de','Keine Zitate angegeben'],
 ['/report?edition='+'0'.repeat(40),'Reference edition changed'],
]) {
 const response=await call(path);
 assert.equal(response.status,200);
 assert.ok(response.text.includes(expected),`Missing report content at ${path}`);
}
console.log('PASS: 12 HTTP scoring comparisons, 5 invalid-request checks and 2 report route checks.');
