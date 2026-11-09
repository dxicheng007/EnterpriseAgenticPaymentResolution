# A0 activation authority contracts implementation

- Branch `codex/activation-authority-contracts`
- Assigned worktree `/Users/devincheng/.codex/worktrees/acquisition-evaluator/EnterpriseAgenticPaymentResolution`
- Exact base `09e89f0215756f150fafd08c0b4d5722b9ff4f7c`
- Exact candidate `437739c96f2e27a417650c188967e26f20fc97cc` with subject `feat: add activation authority contracts`
- Worktree clean after commit.
- Input brief SHA-256 `f3de0b89d92ef4c3f8c545906b75703c3b0822b7381ea84b91862e0a9fff8524`, verified against the dispatched file.

## Changed paths

- `packages/contracts/src/activation-authority.ts`
- `packages/contracts/src/activation-authority-hash.ts`
- `packages/contracts/src/activation-bundle-v2.ts`
- `packages/contracts/src/index.ts`
- `packages/contracts/package.json`
- `packages/contracts/test/activation-authority.test.ts`
- `packages/contracts/test/activation-authority-hash.test.ts`
- `packages/contracts/test/activation-bundle-v2.test.ts`
- `packages/evaluator/src/bootstrap-runner.ts`
- `packages/evaluator/test/bootstrap-build.test.ts`

Root approved the last two paths when the contracts index additions expanded the bootstrap runtime import graph. The shared bootstrap build manifest now includes the three new source modules. A source-byte mutation vector for each module checks both subject and evaluator pins. The bootstrap pins change when these shared bytes change.

## Public exports

The contracts root and the respective explicit package subpaths expose these additions.

- `./activation-authority` exports schemas with corresponding inferred types for `EvidencePinV1`, `CaptureAttestationV1`, `FinancialReservationV1`, `FinancialAttestationV1`, `ActivationTrustPolicyEntryV1`, `ActivationTrustPolicyV1`, `RegisteredScopeIndexEntryV1`, `RegisteredScopeIndexV1`, `ActivationStateV1`, `ScopedReceiptQuery` and `ActivationAuthorityDiagnosticCode`.
- `./activation-authority-hash` exports `hashFinancialReservation`, `hashFinancialAttestation`, `hashActivationTrustPolicy`, `hashRegisteredScopeIndex`, `hashFinancialReport` and `matchesActivationTrustPolicyEntry`.
- `./activation-bundle-v2` exports `ActivationBundleV2Schema`, `ActivationBundleV2` and `hashBundleV2`.

The v2 hash builds its own explicit preimage from parsed members and retains v1 ordering rules for inherited sets. The unchanged v1 compatibility suite passes. The report digest preserves stored array order, while the inherited report sets in the bundle digest are sorted. Public A/B vectors use an independent path-based preimage encoder and fixed SHA-256 goldens. No protected fixtures or runner execution supply those vectors.

## Partial machine evidence

Node `v24.22.2` via `/opt/homebrew/opt/node@24/bin`. Before the production edits, all three new test files failed as expected on missing package subpaths.

| Command | Result |
| --- | --- |
| `npm run typecheck` | Pass |
| `npm run test:unit -- packages/contracts/test` | 11 files and 125 tests passed |
| `npm run test:unit -- packages/evaluator/test/bootstrap-build.test.ts` | 1 file and 3 tests passed |
| `git diff --cached --check` | Pass before commit |

Scope is limited to structure, normalization, digest calculation, complete tuple equality and the bootstrap build manifest dependency update. Runtime use still requires trusted issuance and installed policy checks, readiness, target and source checks, and durable activation consumers. Database, integration, browser, live provider and full slice checks are outside this partial proof. Independent exact-candidate review and joint acceptance are pending.
