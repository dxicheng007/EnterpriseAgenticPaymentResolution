# C3 bounded client/display independent review

Candidate: `a953860c58d0b81503d10fb5780c8f1b1d644d4f`.
Base: `5e6111ec0807e7dfd642ab01797fd7d861d16645`.
Checkout: `/Users/devincheng/.codex/worktrees/acquisition-evaluator-review/EnterpriseAgenticPaymentResolution` (detached, clean before and after review).
Reviewer session: `/root/astra_client_verify`, independently dispatched from builder and supervising lead. Model configuration is owned by the dispatch record; this report does not independently attest a model identifier.

## Verdict

Spec: reviewed for the explicitly bounded 12-file checkpoint; no actionable finding.
Quality: reviewed; no actionable finding.
Verification: focused machine checks pass, with the limits below. This is not V1/V2 machine acceptance. Joint user acceptance remains pending.

Reviewed root, apps, packages, tests and new scoped AGENTS guidance; producer C3 handoff and partial report; supplied diff package; actual candidate files and relevant frozen evidence/verification contracts and schemas. Pages, App registration, session bootstrap, real captures, polling orchestration and full E2E are explicitly outside this checkpoint.

## Findings and boundaries

No reproducible correctness or security defect found in the changed scope.

- All wrappers parse the authoritative response schemas. Requested dossier company/manifest, citation ID and polled job ID are additionally checked. Inputs use validated IDs and encoded paths/query parameters. Compile-blocked preview remains a null artifact response; the preview schema requires parentWrites exactly zero.
- Evidence schema validation constrains the original URL to the exact citation-relative endpoint and verifies excerpt/span agreement. IDs cannot introduce URL path/query delimiters. PDF page suffix is derived from the validated locator. Rendering uses ordinary escaped React text and UTF-16 slicing, including the non-BMP prefix regression. No HTML injection or arbitrary original URL is introduced.
- Evidence selection remounts on ID changes, aborts old reads and ignores late results after cancellation. Retry clears errors before reading. Future page-level company/manifest selection still needs its own stale-state integration checks.
- Verification eligibility requires a completed job, coverageComplete, every mandatory check present and passed, and summary.eligible. Failed/unavailable/missing checks cannot fabricate eligibility. Completed-without-summary renders unavailable. Coverage completion and eligibility are separate. Agent-authored tests are explicitly unavailable, not represented as independent checks.
- Mutations require the in-memory CSRF token, send same-origin credentials, and never replay on failure. An expired session clears only the token used by that request, avoiding clearing a newer token. No Authorization header, persistence of CSRF, sign-in interface, activation control or financial write is added. Session establishment/renewal remains producer-dependent and unverified here.
- Multipart metadata is a JSON string; file name is taken from the actual File; no multipart Content-Type is manually set. Client limits and schema checks are present. Complete-capture publication and empty upload evidence lists remain server contracts; no page in this checkpoint claims a fresh upload is cited.
- Product imports resolve through browser-safe schema modules. No protected truth, source generator, evaluator runtime, canonical Node crypto or fixture data enters the tested browser bundle. Public fixtures appear in tests only. Structured API errors rely on the server's public/redacted error contract; unstructured response bodies are replaced with generic messages.

## Reviewer commands and observed results

Node 24 selected with `PATH=/opt/homebrew/opt/node@24/bin:$PATH`.

1. `npm run test:unit -- packages/client/test`: initial sandbox run could not write the Vite config cache. Repeated with a narrowly scoped escalation for test caches: **3 files, 9 tests passed**.
2. `npm run typecheck`: **exit 0**.
3. Browser bundle through Vite's programmatic `build`, `configFile:false`, `write:false`, `minify:false`, ES library entries for all four client modules and both React displays: **exit 0**. All emitted chunk imports were local output chunks; explicit scan found no `__vite-browser-external`, `node:crypto`, or `node:fs`. This deliberately includes the otherwise-unregistered components rather than relying on the current App bundle.
4. `git diff --check BASE CANDIDATE`: **exit 0**.
5. `git rev-parse HEAD` matched candidate; `git status --short` remained empty.

No product edits, helper edits, pushes, services, database starts, browser session, model keys or financial changes. No owned services require cleanup.

Static rendering and mock HTTP tests do not prove browser interaction, exact real source bytes, full-capture gating, real session/CSRF composition, protected evaluator behavior, or parent database immutability. Those checks remain required after reviewed producer integration. The existing focused tests also do not directly mount EvidencePanel to exercise its async effects; its cancellation/retry behavior was assessed by code inspection here. These are accurately disclosed checkpoint limits, not evidence of a completed slice.
