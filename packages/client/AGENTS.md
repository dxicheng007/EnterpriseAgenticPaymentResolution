# Browser API clients

Follow the [package guide](../AGENTS.md). Import schema modules directly and keep canonical crypto, server adapters, protected fixtures, and evaluator code out of the browser module graph.

The [HTTP client](src/http.ts) parses [API errors](../contracts/src/activity.ts), uses same-origin credentials, and keeps mutation CSRF state in memory. The [source client](src/sources.ts) uses the [dossier](../contracts/src/source.ts) and [evidence and upload](../contracts/src/evidence.ts) schemas. The [preview client](src/preview.ts) and [verification client](src/verification.ts) consume the [runtime](../contracts/src/runtime.ts) and [review](../contracts/src/review.ts) contracts. The [local session client](src/session.ts) shares one bootstrap promise and consumes the [local demo schema](../contracts/src/local-demo.ts). The [parent client](src/parent.ts) reads one registered account and its activation state. A failed mutation is surfaced to the caller without automatic replay.

Run `npm run test:unit -- packages/client/test` for focused HTTP and rendering checks. Browser acceptance requires the actual source, session, and verification composition.
