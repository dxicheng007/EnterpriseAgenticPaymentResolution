# Task 1 implementation report

**DONE. Source permit released to root for independent exact review.**

- Branch: `codex/platform-discovery-producers`
- Released base and candidate parent: `7830e7029ff9ec183cc33b1898413db9ec4aee8a`
- Candidate: `c2f5401d77b0d5427bf8179867c8a9311d91bebe` (`feat: add offline discovery model configuration`)
- Accepted contract SHA-256: `8dd506cb483242069c8b140c83c2598de11110452225e352f2c5548271fa76d9`
- Accepted plan SHA-256: `7bd4017797920621b55c05c802e771f277325c96ecec9e0303907e3492efe1a8`

The exact commit adds only:

- `apps/control/src/discovery-model-configuration.ts`
- `apps/control/test/discovery-model-configuration.test.ts`

## Test evidence

Node 24.22.2 and Vitest 5.1.0. Used the Homebrew Node 24 PATH.

1. Setup red, `npm run test:unit -- apps/control/test/discovery-model-configuration.test.ts` exited 1 with no tests collected because the module was absent.
2. Behavioral red, the same command against the compilable unfinished exports exited 1, 5 failed / 1 passed. In `parses only exact disabled and configured shapes`, expected `{ok:true,value:{schemaVersion:1,state:'disabled'}}` and observed `{ok:false,code:'MODEL_CONFIGURATION_INVALID'}`. In `hashes the domain-separated parsed policy`, expected `e8d2edce035e29df2b0c959d2bf63b4644712101f67d279dcce733aec90e49df` and observed the undomained policy hash `98a507ba0fcb8830a8db9e96ffff6b7dd616db74d59b731b95f4ff309fafcd24`. The resolver also returned `MODEL_UNCONFIGURED` where explicit `undefined` should return `MODEL_CONFIGURATION_INVALID`.
3. Green, the same focused command on the committed contents exited 0, 1 file / 6 tests passed.
4. `npm run typecheck` on the committed contents exited 0.
5. The staged two-path whitespace check and `git diff --check 7830e7029ff9ec183cc33b1898413db9ec4aee8a HEAD` exited 0. Exact commit name-status lists only the two added files. The targeted diff across the composition module, local caller and all existing test callers was empty. Composition and local-caller blob hashes are respectively `3b115b156d35dff91f961e07db29c0799defc3af` and `b37b9281543ff9edec2947daf63d772904334489`, equal to the release check. Working tree was clean after commit.

## Runtime and scope

The configuration union is guarded before strict parsing, policy/limits schemas are shared with the hash boundary, and numeric ceilings are fixed literals. The hash uses the exact domain-separated preimage over the parsed policy. Public parser/hash catch unexpected validation and canonicalization exceptions, respectively where applicable, and expose only the fixed invalid code or an Error with that message. Tests exercise an exception originating in a nested runtime value. The optional resolver distinguishes a call with no argument from an explicitly supplied undefined and delegates every supplied value to the parser. Valid configured metadata yields only unavailable status and `MODEL_LIVE_RELEASE_PENDING`.

Source self-review found only imports from `@eapr/contracts` and Zod. The prescribed hash helper computes locally using Node crypto. The module performs no environment, file, registry, network, client or provider operations. There is no composition or startup mount. No database, browser, provider, integration or full slice checks ran. These are focused D0 machine results; independent exact-candidate review and joint acceptance remain separate. No push, merge, or D1 changes. No known implementation concern.
