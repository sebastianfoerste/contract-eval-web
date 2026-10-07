import {z} from 'zod';
import raw from './benchmark.json';
const severity=z.enum(['low','medium','high']);
const sha256=z.string().regex(/^[a-f0-9]{64}$/);
// Pinned: lib/scoring.ts ports the v1 scorer, so a v2 export must fail loudly instead of being scored as v1.
const schema=z.object({schema:z.literal('contract-eval.web-benchmark.v2'),scoringEdition:z.literal('v1'),version:z.string(),releaseId:z.string(),repository:z.string().url(),sourceCommit:z.string().regex(/^[a-f0-9]{40}$/),goldStatus:z.string(),integritySha256:sha256,referenceEvidence:z.object({
 stage:z.string(),finalReleaseEligible:z.boolean(),humanReviewRequired:z.boolean(),missing:z.array(z.string()),errors:z.array(z.string()),limitation:z.string(),
 cases:z.array(z.object({case:z.string(),candidateSha256:sha256,sourceSha256:sha256})),
}),cases:z.array(z.object({
 id:z.string(),title:z.string(),source:z.string(),
 hashes:z.object({source:z.string(),gold:z.string(),review:z.string()}),
 gold:z.object({review_context:z.object({party:z.string(),governing_law:z.string(),objective:z.string(),risk_appetite:z.string()}).nullable(),clause_types:z.array(z.string()),risk_flags:z.record(severity),severity_rationale:z.record(z.string()),clause_aliases:z.record(z.string()),clause_anchors:z.record(z.string()),thresholds:z.record(z.number())}),
 review:z.object({clauses:z.array(z.object({clause_type:z.string(),text:z.string()})),risk_flags:z.array(z.object({clause_type:z.string(),severity,rationale:z.string()})),citations:z.array(z.object({clause_type:z.string(),quote:z.string()})),abstentions:z.array(z.object({clause_type:z.string(),reason:z.string()}))}),
}))});
const benchmark=schema.parse(raw);
export default benchmark;
