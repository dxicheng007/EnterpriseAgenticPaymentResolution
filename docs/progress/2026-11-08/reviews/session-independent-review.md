# Independent review — early B session/schema checkpoint

Candidate: `3fc329de09e101ac487cff2652d629415d162909`.
Base: `5e6111ec0807e7dfd642ab01797fd7d861d16645`.
Review checkout: `/Users/devincheng/.codex/worktrees/acquisition-review/EnterpriseAgenticPaymentResolution` (detached exact candidate, initially clean).

## Verdict

SPEC PASS and QUALITY PASS for this five-file checkpoint. No actionable defects found. The browser-safe producer SHA is accepted for C3 consumption via the direct `packages/contracts/src/local-demo.ts` module. The contracts root remains Node-dependent through canonical crypto; this review does not approve importing that root into the browser. The package currently has no exported subpath, so consumers must use the established direct-source path convention.

This is deliberately partial acceptance: source authorization adapters, source/preview composition, demo loading/candidates, actual server mounting, C2 verification, and UI remain outside this candidate. No whole B, V1/V2, production authentication, or joint user acceptance claim follows.

## Evidence and checks

Read root, apps, packages, and tests AGENTS; assigned B brief; full five-file diff; existing service credential usage and transitive schema imports. User-authorized automatic localhost bootstrap needs no sign-in screen.

With Node v24.22.2 on PATH, independently ran in the exact review checkout:

- `npm run test:unit -- packages/contracts/test/local-demo.test.ts`: 1 file / 1 test passed.
- `npm run test:integration -- tests/integration/local-composition.test.ts`: 1 file / 1 test passed. This focused test uses Fastify injection, not PostgreSQL.
- `npm run typecheck`: passed.
- Additional inline Node/tsx Fastify probes: 109 assertions passed. These covered actual absent/wrong/null/trailing-slash/localhost Origin; absent/wrong UI marker; same-site/cross-site fetch rejection; malformed/empty/nonobject/identity/grant-bearing bodies; unsupported media types; all eight forbidden credential headers both empty and populated on bootstrap and authenticated reads; redaction; missing/forged/duplicate cookies; wrong read Origin; absent/wrong/cross-origin CSRF mutation requests; valid mutations; repeat bootstrap preserving exact context/token without another cookie; protected replacement of unknown cookie; independent credential/sessionId/CSRF values; defensive copies of returned reviewer/grants; reconstruction invalidating previous session.
- Vite browser library build of direct `packages/contracts/src/local-demo.ts`, `configFile:false`, `write:false`, `minify:false`, with a resolve hook rejecting any `node:` dependency: passed. Output `eapr.js`, 211833 characters, zero external imports and no browser-external shim. No generated bundle persisted.

The first independent probe attempt failed in the injection harness because undefined header values are invalid; corrected the harness to omit absent headers and reran the full 109 assertions successfully. This was not a product failure.

## Boundary assessment

Bootstrap is explicitly protected before parsing by exact configured 127.0.0.1 HTTP Origin, UI marker, optional same-origin fetch metadata, forbidden-credential rejection, and JSON media type. Empty-object validation disallows caller identity or grants. Session secret, ID and CSRF are separately generated with 32 random bytes. Cookie is HttpOnly, SameSite=Strict, scoped to /api, without Domain/Max-Age; the code explicitly identifies local-demo HTTP behavior. Server memory owns sessions and trusted startup scopes. Mutation CSRF comparison validates fixed-length hex then uses timingSafeEqual. Typed redacted failures carry the expected 400/401/403 status codes. No financial approval, parent write, service token, DB credential, source operator token or filesystem path is issued. The opaque cookie itself is intentionally issued as the local browser capability and excluded from JSON.

The source operator route's explicit denial still requires composition testing in the later checkpoint; this candidate already rejects source-operator credential headers through reviewer authorization. It does not claim hostile local process isolation, consistent with the trusted-laptop requirement.

The submitted schema test checks strict shapes but does not itself prove browser bundling; the independent browser build above closes that evidence gap for this exact SHA. Preserve a browser build/import guard in later frontend checks to catch future transitive regressions.

No product files or test helpers were edited, no commit/push performed, no database or listening service started. Fastify instances were closed in finally blocks. No owned services remain to stop.
