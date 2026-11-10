# V3 browser report integration handoff

The original integration baseline was `9680b052765400ade5032b077893e7d4e472e147`. Its full V3 run `2026-11-10T06-44-10-625Z-20257` recorded browser exit `0` with `report-shape-or-file-invalid`. PR31 had added a second browser spec, while the normalizer required a single spec and the V3 allowlist still named only the first title. The baseline packet is under `.evidence/9680b052765400ade5032b077893e7d4e472e147/V3/2026-11-10T06-44-10-625Z-20257/`.

The coordinating agent fast-forwarded the branch to `31d8a4aed415ca7a083e37e683c7eb51e1d97a00` before the correction. That base supports multiple direct specs, but its Playwright normalization ignores the `expected` count, permits mismatched project identities, and rejects valid suites that combine direct and nested specs. Its V3 allowlist still had one title.

Source commit `96c55768cc19bc6c669bcb43963197e762f52d4c` adds the exact existing title `retries a failed details read and offers earlier unresolved approvals only as an explicit action`. The parser checks the summary against the mandatory case count, requires one file root and one project execution per spec, checks available project identity, and accepts direct and nested specs in that file within the existing depth limit. Exact allowlist coverage still determines the retained cases. Diagnostics and case output exclude raw errors, attachments and stdout. The no-database regression tests cover both valid report layouts, missing/extra/duplicate specs, project and file mismatches, error and summary failures, nonpassing or retried executions, empty suites and excessive depth. Existing one-spec V1 and V2 regressions ran in the same check.

## Focused machine checks

All commands used Node `v24.22.2`.

| Candidate | Command | Result | Local log |
| --- | --- | --- | --- |
| `9680b052` with initial regression tests | `npm run test:integration -- tests/integration/verify-slice-evidence.test.ts` | Exit 1, 1 failed and 51 passed. A valid two-spec report returned `report-shape-or-file-invalid`. | `/private/tmp/eapr-v3-report-red.log` |
| `31d8a4ae` with updated regression tests | `npm run test:integration -- tests/integration/verify-slice-evidence.test.ts` | Exit 1, 6 failed and 50 passed. Mixed direct and nested cases were rejected, and extra or mismatched projects and wrong or incomplete summary counts were accepted. | `/private/tmp/eapr-v3-report-upstream-red.log` |
| `96c55768` | `npm run test:integration -- tests/integration/verify-slice-evidence.test.ts tests/integration/verify-v2-evidence.test.ts` | Exit 0, 2 files and 62 tests passed. | `/private/tmp/eapr-v3-report-green-96c5576.log` |
| `96c55768` | `npm run typecheck` | Exit 0. | `/private/tmp/eapr-v3-report-typecheck-96c5576.log` |
| `96c55768` | `git diff HEAD^ HEAD --check` | Exit 0. | Git output was empty. |

This handoff records partial machine verification. The coordinating agent owns the database and browser lease for the full V3 rerun. Independent review and joint acceptance remain pending. Run-specific activation and visible evidence gaps remain tracked separately in the baseline review. The V4 live gate is also a separate review scope. [Baseline integration review](../reviews/platform-v3-v4-9680b05-review.md)
