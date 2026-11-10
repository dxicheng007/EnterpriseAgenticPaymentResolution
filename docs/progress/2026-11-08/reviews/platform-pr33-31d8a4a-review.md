# Independent PR33 review

- Reviewed commit: `31d8a4aed415ca7a083e37e683c7eb51e1d97a00`.
- Base: `9680b052765400ade5032b077893e7d4e472e147`.
- Frozen contract: v1, SHA-256 `863cdbc91c527b5e6d1f08e0ee7dedfd4483a0548249954ea732e196394d077a`.
- Reviewer session: `/root/pr33_review`, independent read-only subagent. Supervising lead: `/root`. Builder identity and model identifier were not independently verified.
- Repository inspected: `/Users/devincheng/.codex/worktrees/platform-activation-integration/EnterpriseAgenticPaymentResolution`.
- Scope: the immutable six-file PR diff only (`package.json`, `scripts/AGENTS.md`, `scripts/live-build.ts`, `scripts/verify-slice-evidence.ts`, `scripts/verify-slice.ts`, `tests/live/v4-build-connectors.test.ts`). Supporting specifications and existing tests were read from that same commit.
- The worktree's V3 parser repair and other WIP are excluded. No source edits, provider/secret calls, database/browser tests, commits, or delegated reviews were performed.

## Verdicts

**Specification: changes requested.** PR33 enables two success paths that contradict the frozen requirement to keep incomplete V4 work partial and to require real provider execution for `test:live`.

**Quality: changes requested.** The evidence plumbing is generally conservative, but success is calculated from prerequisite tests rather than the intended live outcome. The negative configuration test is useful as an offline harness regression; it cannot serve as the live construction case.

**Verification: partial, read-only plus isolated pure probes.** No full slice or live run was performed. **Joint acceptance: pending.**

## Findings

### P1 — Keep the V4 machine gate failed while genuine A/B construction is absent

**Location:** `scripts/verify-slice.ts:695-706` (also 562-575, 601-605, 655); `scripts/verify-slice-evidence.ts:199-203`.

`verifyV4` deletes provider configuration and invokes `test:live -- --evidence`. Its sole registered live assertion checks that missing configuration throws. After four prerequisite commands pass and Chromium is identified, `v4ExitCode` returns zero, the manifest records `slice: V4, result: passed`, and stdout announces `V4 verification passed`. Neither provider call evidence, generated A/B artifacts, independently eligible supported customers, nor holdout results participates in that decision. This occurs even with no provider access at all. The limitation string acknowledging pending live builds does not make the top-level machine status truthful.

This directly contradicts implementation-plan lines 98 and 275: mid-slice work is partial, and T4.1 must not mark full V4 passed. T4.2 lines 286-295 require actual A/B construction, real provider calls, protected verification and holdout evidence in the V4 run. PRD section 19 and contract-freeze foundation sequencing likewise preserve genuine live generation as mandatory; separating joint G4 acceptance does not remove the machine requirements.

**Smallest correction boundary:** retain the offline checks and safe packet, but add an explicit mandatory-live-unavailable diagnostic and nonzero full-V4 result until the real gate exists. If desired, expose the prerequisite suite under a clearly separate partial command/status. Do not redefine V4 or weaken the required A/B assertions. Update the corresponding scripts guide. Full provider implementation is not necessary to repair this false pass.

**Proof:** an isolated Node 24 evaluation of the exact committed `v4ExitCode` returned `0` for four `{result:'passed'}` prerequisite results and a Chromium version, with no live evidence. Static tracing establishes that these are exactly the inputs the new runner can supply. Actual database/browser prerequisite completion was not claimed or executed.

### P1 — Do not let `test:live` succeed on a missing-configuration unit assertion

**Location:** `scripts/live-build.ts:77-89`; `tests/live/v4-build-connectors.test.ts:7-20`; command wiring at `package.json:22`.

The ordinary live runner treats any nonempty `OPENAI_API_KEY` as sufficient, then propagates Vitest's status. The registered test immediately deletes that variable and only asserts the expected missing-configuration error. Consequently, an arbitrary dummy value can produce a successful `test:live` run without any provider invocation, artifact construction, or independent verification. A real but invalid/revoked key is also never tested. Separately, the public first argument `--evidence` bypasses even the presence check and runs the same passing negative test with no key.

The implementation-plan command contract at line 94 explicitly requires real provider calls and says missing access must never become a mock pass. T4.2 lines 286-293 require the build test to prove real A/B generation while separately failing on absent access. Renaming the existing documentation requirement from provider execution to provider configuration does not authorize the weaker behavior.

**Smallest correction boundary:** move the missing-configuration assertion into an offline harness suite and keep the live entry point unavailable/nonzero until genuine live execution is mounted. Alternatively, allow the negative proof to run internally but never let its passing status satisfy the public live command or the V4 live requirement. The `--evidence` bypass must not create an externally successful live result. Add no-provider regression checks for absent configuration, dummy configuration, and any evidence mode.

**Proof:** isolated evaluation of the exact committed configuration functions with a fabricated environment returned `{ok:true,apiKeyPresent:true}` for `offline-dummy-not-a-credential` and returned the intended unavailable error for an empty environment. The sole committed test and runner status propagation were inspected. No real key was read and no test process/provider was invoked; the end-to-end exit-zero conclusion is a static control-flow finding, not an executed live result.

## Parser and evidence assessment

The PR33 parser change admits multiple specs/sibling suites and retains exact required-name/count matching, one test execution per spec, rejection of skipped/flaky/retried/failed executions, and file binding. Removing the hard-coded aggregate `expected === 1` permits genuine multi-case reports. It also stops checking that aggregate expected count agrees with the parsed case count; no separate exploitable false-coverage case was established, because normalized required-case coverage is still checked. No additional parser defect is asserted in this review. The separately assigned V3 parser repair was not inspected or evaluated.

The V4 evidence path captures child stdout/stderr privately, normalizes only allowlisted test names/statuses and generic diagnostics, removes the named OpenAI variables from the V4 child environment, disables authenticated Playwright tracing, deletes temporary raw output, and writes retained JSON with mode 0600. The changed code does not add a worker model SDK/key/mount or expose evaluator truth to product tools. These are static observations, not a comprehensive secret-leak or runtime-isolation certification. The packet's empty screenshots and missing genuine source/artifact/provider/holdout evidence further limit it to prerequisite evidence; fixing the success semantics must precede any full-V4 claim.

## Commands and proof limits

- Used `git diff` / `git show` against the exact base and reviewed SHAs; read repository/scripts/tests guidance, PRD local process boundaries and acceptance, implementation-plan verification conventions/T4, shared file ownership, frozen F6/F8/foundation sequencing, and verification playbook.
- Read committed parser regression tests and registered monitor case titles. Did not consume modified worktree test content.
- An initial offline parser probe could not start because this worktree lacks `node_modules/typescript`; the main workspace also lacks TypeScript/Zod. No dependencies were installed. That failed setup is not evidence about parser correctness.
- A subsequent dependency-free pure probe ran using `/opt/homebrew/opt/node@24/bin/node`, `node:module.stripTypeScriptTypes`, and `node:vm`. It loaded only the exact committed `v4ExitCode` and configuration functions from `git show`, supplied synthetic inputs, and produced the outputs described above. It did not load product composition, perform network access, touch databases, start a browser, or inspect secrets.
- No full tests/typecheck were run, and there is no machine-pass claim for this candidate. Review findings apply only to `31d8a4aed415ca7a083e37e683c7eb51e1d97a00`.
