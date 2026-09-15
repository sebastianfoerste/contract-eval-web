import { z } from 'zod';
import { evaluate } from '@/lib/evaluation';
import benchmark from '@/lib/benchmark';
const requestSchema = z.object({
  caseId: z.string().refine(value => benchmark.cases.some(c => c.id === value),'Unknown case'),
  scenario: z.enum(['baseline','no-evidence','missed-risks','conflicting-flags']),
}).strict();
export async function POST(request: Request) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) return Response.json({error:'Send a JSON evaluation request.'},{status:415});
  const reader = request.body?.getReader();
  if (!reader) return Response.json({error:'Missing request body.'},{status:400});
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) {
    const {done,value} = await reader.read(); if(done) break;
    size += value.byteLength;
    if(size > 1024) { await reader.cancel(); return Response.json({error:'Request too large.'},{status:413}); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for(const chunk of chunks){bytes.set(chunk,offset);offset += chunk.byteLength;}
  let input: unknown;
  try {input = JSON.parse(new TextDecoder().decode(bytes));} catch {return Response.json({error:'Invalid JSON.'},{status:400});}
  const parsed = requestSchema.safeParse(input);
  if(!parsed.success) return Response.json({error:'Choose an available case and evaluation scenario.'},{status:400});
  return Response.json(evaluate(parsed.data.caseId,parsed.data.scenario),{headers:{'Cache-Control':'no-store'}});
}
