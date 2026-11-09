# A0 exact-candidate independent review

- Reviewer: fresh dispatched review agent `/root/astra_activation_authority_contracts_verify`, separate from builder and supervising root.
- Candidate: `437739c96f2e27a417650c188967e26f20fc97cc` (`codex/activation-authority-contracts`).
- Base: `09e89f0215756f150fafd08c0b4d5722b9ff4f7c`.
- Reviewed worktree: `/Users/devincheng/.codex/worktrees/acquisition-evaluator/EnterpriseAgenticPaymentResolution`; HEAD verified and worktree clean.
- Specification verdict: **PASS** for assigned A0 contracts scope, including root's explicit bootstrap manifest/test expansion.
- Code-quality verdict: **PASS**. No actionable findings.
- Joint acceptance: **pending**; not conferred by this review.

## Review coverage

Read the complete 10-file candidate diff, exact A0 brief and implementation report, repository/area guidance, additive activation-authority freeze, and named dependency seams: existing strict/key guards and set schemas, v1 bundle/profile canonicalization, report and bundle schemas, bootstrap pin/result normalization, original v1 compatibility vectors, bootstrap build manifests and recursive import-closure tests.

The schemas preserve the exact required inventory and literals, nested strictness, profile membership/uniqueness rules, capture/report associations, normalized complete policy tuple identity and digest ordering, unique account ordering, and paired activation/receipt identity checks. Distinct snapshot content and object hashes remain independently required. Parsing does not authenticate issuance, install policy, recompute eligibility, or introduce activation consumers.

Own-hash helpers parse and normalize before omitting only the top-level hash. Nested hashes remain in their preimages. The matcher compares complete normalized entries and rejects invalid inputs. Financial report hashing retains parsed report array order, while v2 inherited report sets follow v1 bundle ordering. V2 reproduces the inherited profile, manifest, artifact and report canonicalization, retains profile and nested hashes, and preserves event/operation/lineage order. V1 implementations and golden tests are unchanged. The two public metadata-bearing A/B vectors use fixed goldens and a separate path-based preimage encoder.

The three new index-reachable modules are included in the shared bootstrap source manifest. Each has a byte-mutation vector affecting both build pins, and the existing recursive runtime import-closure invariant remains intact. These two evaluator changes are within the explicitly expanded assignment.

## Verification and limits

Reviewer read-only commands verified exact HEAD, clean status, candidate file scope, and `git diff --check 09e89f0215756f150fafd08c0b4d5722b9ff4f7c..437739c96f2e27a417650c188967e26f20fc97cc` (pass). No source edits, commits, branch changes, database operations, or additional agents were used.

Builder-reported exact-candidate partial machine evidence: Node 24 typecheck pass; contracts unit suite 11 files / 125 tests pass; bootstrap build suite 1 file / 3 tests pass. These suites were not rerun because static review raised no concrete concern requiring repetition, per dispatch. The machine results are attributed to the builder, not independent execution by this reviewer.

This verdict covers representation, normalization, hashing, equality, compatibility, and source-manifest coverage only. It does not establish trusted financial issuance, installed policy provenance, readiness, activation authorization, persisted parent effects, runtime idempotency, live discovery, broader financial correctness, or any V3/full-slice acceptance. Consumers require their own assigned implementation and verification.
