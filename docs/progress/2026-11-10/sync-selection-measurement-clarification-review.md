# Measurement clarification — fresh scoped architecture review

Verdict: **Approved for this documentation scope. The open P2 is addressed; no new fix-induced issues found.** This is neither whole-design reapproval nor fixture/implementation qualification.

Worktree: `/Users/devincheng/.codex/worktrees/platform-activation-integration/EnterpriseAgenticPaymentResolution`.

## Exact candidates and diff verification

The following SHA-256 values were independently verified before inspection and again before writing this report:

| Document | Reviewed current SHA-256 |
| --- | --- |
| `docs/progress/2026-11-10/sync-selection-catalog-fixtures-design.md` | `17ce1b1d1c5d9e0c155a70e3da6a916132f0ac22ecda1a1b8e55f9efeab6e49c` |
| `docs/progress/2026-11-10/sync-selection-variants-design.md` | `11c6193cd23d9f371fe2ad5a689a17abfa0053941809264944fffd313ede6ab3` |
| `docs/superpowers/plans/2026-11-10-sync-selection-variants.md` | `1a429ce30a791ce1bd48f1027e9bb6a3881044b3b6e7dc703e37d0ebdb9546e9` |

Retained original hashes match the supplied baselines: catalog `8e2d60700f4890d49a048def7fcc76f2dac97c59ff881e022e40146e54a300b2`, variants design `b831e29e176aebc6d1c6c548f7ec7f356adbe2fa69d0b86d34a16676781c72ca`, variants plan `b46fa762a78c620af527c6424c8403a2a6309ceedc87e9cb37ce8336f7332546`. Each tracked current document equals its retained amended temporary copy.

Independently generated original-to-current unified diffs equal the supplied diff files byte for byte:

- `/private/tmp/eapr-sync-selection-catalog-fixtures-design-fix1.diff`: `f3b54fc86573cca307281cde638cd9dbb5b907ef7f72fff3be2eb0d4bdae9946`.
- `/private/tmp/eapr-sync-selection-variants-measurement-clarification.diff`: `1fa09e1d56a9593eb842ef0b06962e630bc7ca02a0b281bf3172a943dfa04911`.

## Finding disposition

**P2 — State how nested runner size evidence is obtained, or narrow the measured-size claim: addressed.**

The original finding in `/private/tmp/eapr-sync-selection-catalog-fixtures-design-review.md` and root ruling at `docs/progress/2026-11-10/platform-coordination.md:303` require accessible outer measurements and separate nested-enforcement evidence. Catalog lines 157 and 162 now use that narrower scope. Lines 207–211 define it explicitly: observed outer input/context serialization and framing, returned-response object lengths, accessible pin/sidecar lengths, outer invocation and construction elapsed time; individual nested sizes/timings are unobserved. Raw wire counts are expressly not attributed to parsed-return seams. Complete mandatory reports from the same genuine run plus unchanged enforcement are separate compliance evidence.

The named parent seams support this specification without new instrumentation. `financial-attestation-launcher.ts:43` calls exported `runFinancialEvaluator` with the actual request/context; `financial-attestation-runner.ts:27` frames the context as JSON plus newline. `bootstrap-launcher.ts:50` and `bootstrap-runner.ts:53` provide the corresponding bootstrap boundary. A call-through observer can serialize the actual validated request/context with the documented framing, measure the returned parsed value's serialization, and time the real invocation. `transport.ts:110–120` shows schema validation, JSON/newline request framing and context length enforcement; `transport.ts:129–132` returns parsed output. Its private combined stdout/stderr counter at lines 70–83 is not the returned object's byte length. The amendment correctly preserves that distinction. Pin/sidecar lengths remain ordinary trusted-file inventory observations, with private content excluded from retained evidence.

Nested execution remains in evaluator children (`financial-attestation-evaluator.ts:94`; `bootstrap-evaluator-runner.ts:37`). `transport.ts:33–35` spawns the processes independently; parent spies do not supply nested telemetry. Complete bootstrap coverage requires the real subject executions to succeed (lines 31–58), under the existing fixed wrappers and transport. The amended text correctly asks for evidence of unchanged enforcement and complete reports, not invented per-child measurements.

**Matching accepted variants wording: consistent and addressed.**

Variants design line 73 and plan Task 2 Step 4 at line 111 adopt the same observation/enforcement distinction, prohibit protected telemetry/new hooks/substitute runs and preserve existing limits and exact comparisons. Task 3 Step 4 at line 154 incorporates those rules explicitly. The plan's pinned design hash at line 11 matches the amended design. Prior review records remain historical evidence for their original candidates; this report supplies the narrow amendment review.

## Preservation and new issues

No fix-induced issue was found. Exact diffs change only the catalog's three measurement passages, the corresponding variants design/plan passages, and the plan's design-hash pin. Literal fixture scenarios, APIs, authority boundaries, qualification cases, full financial/bootstrap coverage, inventories and cleanup obligations remain intact. Catalog line 211 retains the registry's strict comparison, corroborated by `financial-attestation-registry.ts:77–79`; no generic inclusive 10MiB assumption is introduced. Catalog line 162 retains the existing 300000 ms suite ceiling and expressly preserves protected subprocess deadlines. Missing or unavailable mandatory coverage still prevents qualification.

## Scope and limits

Read the original finding, both repair reports, the root ruling, exact diffs and affected passages. Outside-document inspection was limited to the concrete observation-feasibility and cap-comparison risks named above. No repository/source/Git mutation, database/service/test execution or subagent dispatch occurred. Only this requested `/private/tmp` report was written; the active source writer was not touched. Tests are unnecessary for this documentation clarification and were not run.

The clarification gate is satisfied for these exact hashes. Actual measured sizes/timings, successful complete proof runs, cleanup evidence, exact implementation review and consumer/slice/joint acceptance remain later gates; none is claimed here.
