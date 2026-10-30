import { z } from 'zod';
import { evaluate } from '@/lib/evaluation';
import benchmark from '@/lib/benchmark';
const requestSchema = z.object({
  caseId: z.string().refine(value => benchmark.cases.some(c => c.id === value),'Unknown case'),
  scenario: z.enum(['baseline','no-evidence','missed-risks','conflicting-flags']),
}).strict();
// Returns the complete body, or null once it exceeds 1 KiB, which cancels the rest unread.
async function readBody(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) {
    const {done,value} = await reader.read(); if(done) break;
    size += value.byteLength;
    if(size > 1024) { await reader.cancel(); return null; }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for(const chunk of chunks){bytes.set(chunk,offset);offset += chunk.byteLength;}
  return bytes;
}
export async function POST(request: Request) {
  // Read the body before any answer, including the 415. Wrangler's local proxy
  // fails to forward a body the Worker answered without reading; its connection
  // to the Worker then drops and the next GET waits for a reload that never comes.
  const bytes = request.body ? await readBody(request.body) : undefined;
  if (!request.headers.get('content-type')?.startsWith('application/json')) return Response.json({error:'Send a JSON evaluation request.'},{status:415});
  if (bytes === undefined) return Response.json({error:'Missing request body.'},{status:400});
  if (bytes === null) return Response.json({error:'Request too large.'},{status:413});
  let input: unknown;
  try {input = JSON.parse(new TextDecoder().decode(bytes));} catch {return Response.json({error:'Invalid JSON.'},{status:400});}
  const parsed = requestSchema.safeParse(input);
  if(!parsed.success) return Response.json({error:'Choose an available case and evaluation scenario.'},{status:400});
  return Response.json(evaluate(parsed.data.caseId,parsed.data.scenario),{headers:{'Cache-Control':'no-store'}});
}
