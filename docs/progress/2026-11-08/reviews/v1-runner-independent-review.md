# Independent V1 runner review

Candidate: `41dea39293dd7e2468c4072d0091709f3315f684`; base: `f22a70fe8a56e72a29afb7793e1b42e1a746b9e0`.
Checkout: `/Users/devincheng/.codex/worktrees/acquisition-review/EnterpriseAgenticPaymentResolution`.

Verdict: PASS for the bounded V1 runner task. No actionable correctness, specification, privacy, or documentation findings. This is independent review, not joint G1 acceptance or full V2 completion.

## Scope and implementation review

Read root/scripts/tests AGENTS, exact implementation brief, producer report, seven-file diff, helper implementation, orchestration and tests, native database lease validation, and browser fixture/harness. Only the seven owned files changed. The exact five-file/13-name registry matches the brief: seven locator cases, two change-feed cases, two evidence cases, one manifests case, one browser case. Six commands run sequentially with unique reports, bounded capture and timeout, followed by a separately launched actual Chromium version probe. All mandatory reports, assertion coverage, process outcomes and screenshots feed the fail-closed decision.

Vitest normalization rejects wrong files, absent/extra/duplicate names, malformed records, non-passing statuses and unsuccessful/error summaries. Playwright normalization rejects wrong/duplicate files or cases, extra projects/results, retry/flaky/skipped/unexpected outcomes, errors and failed summary counts. The same normalization and aggregate helpers are used by orchestration and tests. No raw errors, stdout/stderr, attachments or reports are serialized; only expected names, normalized states and diagnostic codes enter the packet. Temporary output is private and removed in finally. Screenshot collection requires exact unique regular basenames, PNG signature and bounded size, rejects symlinks and trace.zip, and copies only the two allowlisted images.

V0 function body, required names, parser, command ordering, packet and trace behavior remain unchanged. Shared capture/sourceIdentity gained an optional environment argument; V0 omits it, retaining inherited environment behavior. Producer's prior V0 20-case/four-command/one-trace pass was not unnecessarily repeated. The independent parser test run also exercised unsupported V2 and failed-preflight CLI behavior.

Documentation modifications are narrowly factual. The only checked plan item is the split machine-command checkbox, referencing a specific dirty-source packet. G1 walkthrough remains unchecked; test-first/old commit boxes remain unchecked. Full V2 runner and joint acceptance are explicitly pending/unavailable. The status distinguishes previously reviewed f22a70f browser evidence from this runner candidate.

## Independent execution

Node 24.22.2 / PostgreSQL 18 PATH; isolated lease `55433/3101/3102/5174`, `EAPR_DEMO_NAMESPACE=eapr_review_t1`, `EAPR_TEST_PREFIX=eapr_test_review_t1`. Both prefixes are explicitly supported by the native regex. No listeners occupied these ports before execution.

- `npm run test:integration -- tests/integration/verify-slice-evidence.test.ts`: 34 tests passed.
- `npm run verify:slice -- V1`: passed on clean exact candidate, all 13 mandatory cases and six zero-exit, no-signal commands, including typecheck.
- Additional independent direct probes through actual `normalizeReport`, `commandResult`, and `v1ExitCode`: 25 checks passed across the exact map, complete reports, error summaries with sentinel secret, missing assertion/result, duplicates, and todo/skipped statuses. Every malformed case produced aggregate exit 1 despite process exit 0; sentinel content did not enter normalized output.
- Separate disposable Git fixture: changing untracked content then tracked diff independently changed dirty evidence keys; all missing-file invocations wrote failed preflight manifests with zero commands and no sentinel raw contents. Fixture removed afterward.

An initial inline review probe had a JavaScript bracket typo and did not execute. It was corrected and all 25 independent probes then passed; no product files were changed.

## Verified packet

`/Users/devincheng/.codex/worktrees/acquisition-review/EnterpriseAgenticPaymentResolution/.evidence/41dea39293dd7e2468c4072d0091709f3315f684/V1/2026-11-08T22-19-57-827Z-4076/`

Confirmed source.clean true; result passed; jointAcceptance pending; actual launched Chromium `158.0.8127.18`; full migration identities control 1–3/runtime 1. Packet contains only manifest.json, commands.json, assertions.json and screenshots. Run directory mode 0700; JSON and PNG files 0600. No authenticated trace or raw report retained. Both SHA256 values were recomputed from PNG bytes:

- `screenshots/source-incomplete.png`: `0fc65c54d41b17354dc4de3b2b303b53d97921f39f68f3cbd84ac72d0b20ce2d`
- `screenshots/source-complete-pdf.png`: `34316997e1006183261f09a506662357f78a17379b238a078363f610cbf5c499`

Owned PostgreSQL was stopped with `npm run db:down`; subsequent listener check showed none on all four review ports. Main ports/session were untouched. Checkout remained clean. No helpers/product edits, commits, or pushes performed.
