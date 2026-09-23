# Independent challenge-set protocol

The public NDA, SaaS and DPA fixtures are inspectable demonstration cases. They are not a blinded holdout, and scores on them cannot establish performance on unseen contracts.

## Entry conditions

1. Complete the Python harness's independent v2 returns, written adjudication and verified freeze. Keep the current release gate closed until its evidence report says `frozen` and `finalReleaseEligible` with no missing items or errors.
2. Author additional **synthetic** contracts covering materially different clause patterns, drafting styles and failure modes. Do not use client documents or copy confidential terms. Keep the challenge inputs and expected answers outside the public web bundle until scoring is complete.
3. Record the task perspective, clause taxonomy, expected findings, severities, quotation anchors and explicit abstention criteria before exposing the cases to the system under test. Separate the people preparing reference answers from the people tuning the tested review where practicable, and record any overlap.
4. Obtain independent annotations, resolve disagreements in writing, verify source offsets and hashes, and freeze the reference set in the Python harness. Do not fill missing returns with generated answers.

## Evaluation and release

- Preserve each tested model or fixture version, prompt, adapter settings, source hash and output. Score the frozen output without post-hoc edits.
- Report per-case findings and denominators alongside aggregate metrics. Explain missing observations as N/A in presentation while retaining the scorer's raw numeric output for parity.
- Test clause identification, risk flags and severities, quotation grounding, abstentions and contradictory output. Report uncertainty and known exclusions. Do not equate a located quotation with legal correctness.
- Keep the challenge set out of the public app until the evaluation is complete. If cases are later published for inspection, retire them as a blind holdout and create a new unseen set for future claims.
- Add the new cases to the web export only after the Python harness accepts their evidence and scoring parity vectors. Run `make web-check` in the harness and `npm run check` in this app before any release claim.

No v2, model-ranking or legal-reliability claim follows from this protocol alone. It is a preparation and acceptance checklist, not completed reviewer evidence. The [NIST AI RMF Measure playbook](https://airc.nist.gov/airmf-resources/playbook/measure/) is a useful external reference for fit-for-purpose tests, metric selection, representativeness and documented limitations.
