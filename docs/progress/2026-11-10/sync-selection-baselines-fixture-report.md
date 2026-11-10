# Task 2 — distinct immutable approval baselines

Released base `6d7b5b800022fd12508e9acd537afed84df274df`. Candidate `6721f37860cd1f60ea9442ebc68dd4e192ed28d2`, directly based on that release. C0 source prerequisite `620bf2de35fa42f014c9b23364c18962a7794af3`. Accepted variants plan SHA-256 `1a429ce30a791ce1bd48f1027e9bb6a3881044b3b6e7dc703e37d0ebdb9546e9`. Normative design SHA-256 `11c6193cd23d9f371fe2ad5a689a17abfa0053941809264944fffd313ede6ab3`.

## Candidate and self-review

Only `tests/fixtures/sync-selection-baselines.ts` (389 lines, 22,267 bytes) and `tests/integration/sync-selection-baselines-fixture.test.ts` (772 lines, 45,051 bytes) were committed. Total 1,161 insertions. The qualification suite exceeds the design estimate because it includes its own four-case proof and state assertions, real outer-runner observations, and durable phase/resource evidence. The fixture uses the existing enrollment and installed-reviewer modules for both proof and A5 chains. It adds no callback, scenario configuration or product seam. The existing untracked root clarification document is outside this commit.

Both original sets exist before publication. The call-through observer verified M1 had already published at position 2 and registered one candidate before the M2 capture call. Each proof used its own original agreement, immutable capture and independently pinned evidence/sidecar. Older approval was followed by a transactional check for absent newer activation and target before newer approval. Both first imports have one invoice, one customer, one account and one scoped configuration, version 1, balance 0→300000 cents and exactly their own initial origin. M2's window payment is in captured membership only. The public factory exposes only the promised runtime pool, two committed subjects, capture delegate and close.

The two lanes start with distinct initial activation IDs and exact vectors 2/0 and 3/0. The suite checked persisted lane rows and counts before opening the runtime read handles. Newer 3→5 and older 2→5 retained their complete pages and produced five global canonical identities, two pages and five ongoing inbox rows split 2/3, with seq3 in the older inbox only. Exact replays changed neither capture/activity nor non-capture rows. All approved snapshots, A5 and sync outcomes/receipts, origins, authority and P1 state remained unchanged. The author and observer input checks were separate.

After the first passing run, self-review strengthened the independent lane observation so a lane read API could not initialize a missing row before the test checked it. It also strengthened report, receipt and bootstrap plan bindings, recorded actual DB names and the ephemeral worker port, and confirmed registration before M2 at the observer seam. Authored originals, truth, fixture source and shared prerequisite files were unchanged between runs. No production RED was manufactured. This is scoped machine qualification plus author self-review. Root's fresh exact-candidate review is separate. No selector, P1 apply, later-slice or joint-acceptance credit is claimed.

## Executed verification

Node v24.22.2, PostgreSQL 18.6, npm 11.19.1. The root-owned cluster on loopback 55441 was reused and retained. Both runs used the granted test environment with `EAPR_PG_PORT=55441 EAPR_TEST_PREFIX=eapr_test_review_t2 EAPR_DEMO_NAMESPACE=eapr_review_t2 EAPR_CONTROL_PORT=3241 EAPR_WORKER_PORT=3242 EAPR_WEB_PORT=5182`, and their unique absolute Task 2 evidence path via `EAPR_SELECTION_FIXTURE_EVIDENCE_DIR`.

```sh
npm run typecheck
npm run test:integration -- tests/integration/sync-selection-baselines-fixture.test.ts -t 'distinct-baseline fixture qualification' --testTimeout=180000 --hookTimeout=180000
```

Initial `run-ljHYVraH` typecheck returned 0. Vitest reported 1 file and 4/4 cases passed in 54.87s. The wrapper then failed assigning to zsh's reserved `status` variable (`zsh:17: read-only variable: status`, wrapper exit 1), so the initial status log contains only the typecheck exit. The untouched raw Vitest log contains the successful test summary. Final `run-buY8tTHy` used a task-specific shell variable, recorded both exits 0, and passed 1 file and 4/4 cases in 54.94s with zero skipped cases. `git diff --check 6d7b5b800022fd12508e9acd537afed84df274df 6721f37860cd1f60ea9442ebc68dd4e192ed28d2` passed and the committed Git blob IDs match the final source inventory's candidate IDs.

- `real distinct proofs and first imports`
- `independent complete lane intervals`
- `fresh construction and immutable inputs`
- `partial construction cleanup`

## Genuine proofs and observed transport

The final primary and fresh attempts each produced two genuine eligible financial reports with 13/13 mandatory positive-case checks, complete profile/source/five-kind coverage and zero unexplained difference. Each selecting review produced a complete passed bootstrap result with 10 cases and 9 assertions. Each attempt's proof JSON retains report/attestation/evidence/plan and reviewer/A5 bindings plus six call-through outer measurements. No session ID, token, private proof bytes, expected records or subprocess payload is retained. The failure attempt executed genuine financial work and stopped before reviewer app construction. It retained no successful proof packet.

Outer requests are actual schema-normalized UTF-8 JSON byte counts plus one LF. Context counts include one LF on the private context pipe. Response lengths below are serialization of the parsed returned object, without LF. They do not measure raw stdout/stderr. Each elapsed time spans the actual awaited outer invocation. Evidence/sidecar sizes come from the actual bound files. Blank columns are outside that invocation.

| Attempt | Manifest | Outer stage | Request bytes with LF | Context bytes with LF | Returned object bytes | Pin bytes | Sidecar bytes | Elapsed ms |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| primary | M1 | financial-probe | 13800 | 560 | 960 | 31383 |  | 623.83 |
| primary | M1 | financial-launch | 14757 | 560 | 3298 | 31383 |  | 6346.76 |
| primary | M2 | financial-probe | 14557 | 560 | 960 | 34255 |  | 622.28 |
| primary | M2 | financial-launch | 15514 | 560 | 3298 | 34255 |  | 6349.14 |
| primary | M1 | bootstrap | 14256 | 989 | 15014 |  | 1291 | 2065.23 |
| primary | M2 | bootstrap | 15013 | 989 | 15014 |  | 1291 | 2061.37 |
| fresh | M1 | financial-probe | 13800 | 560 | 960 | 31383 |  | 618.96 |
| fresh | M1 | financial-launch | 14757 | 560 | 3298 | 31383 |  | 6403.80 |
| fresh | M2 | financial-probe | 14557 | 560 | 960 | 34255 |  | 629.48 |
| fresh | M2 | financial-launch | 15514 | 560 | 3298 | 34255 |  | 6453.49 |
| fresh | M1 | bootstrap | 14256 | 989 | 15014 |  | 1291 | 2106.96 |
| fresh | M2 | bootstrap | 15013 | 989 | 15014 |  | 1291 | 2127.49 |

Primary total construction elapsed 19375.93 ms.

Fresh total construction elapsed 19427.17 ms.

Individual nested subject-runner byte counts and timings were unobserved. Unchanged financial and bootstrap nested execution uses a 10,485,760-byte cap and 5,000 ms deadline. The outer evaluator deadline is 120,000 ms under the same byte cap. The existing transport rejects input, launch context and combined stdout/stderr only when strictly above its cap and applies the configured timer. The unchanged nested enforcement and the same genuine run's complete passing reports support compliance separately from the directly measured outer invocations.

## Inputs, source and cleanup evidence

All three attempts retained both 10-file old and 11-file newer input inventories before M1 publication, then independent per-capture inventories. Primary retained identical 21-file inventories after proof, after capture and after replay. Fresh retained its identical post-proof inventory and matched the primary author bytes. Failed construction retained before-publication and per-capture inventories, exact sentinel identity, awaited listener/pool closures and its own drop/root removal. The primary close was awaited twice. Both success attempts and the sentinel attempt have safe cleanup records with distinct owned roots/namespaces and actual resource identifiers. No shared cluster stop or unrelated drop was performed.

- Primary retained cleanup evidence for root `eapr-sync-selection-gF99sq`, namespace `eapr_test_review_t2_selpeers3c91d2ad9bed` and loopback worker port 60918. The root was absent after cleanup, the listener was closed, and both application pools ended.
- Fresh retained cleanup evidence for root `eapr-sync-selection-5j4UZQ`, namespace `eapr_test_review_t2_selpeers17f26070b619` and loopback worker port 60935. The root was absent after cleanup, the listener was closed, and both application pools ended.
- Failure retained cleanup evidence for root `eapr-sync-selection-3JnElg`, namespace `eapr_test_review_t2_selpeers1e30dcff1c3c` and loopback worker port 60992. The root was absent after cleanup, the listener was closed, and both application pools ended.

- Final source-before has 109 sorted path/hash/length or absence entries. Candidate/reference `6d7b5b800022fd12508e9acd537afed84df274df`.
- Final source-pre-run has 109 sorted path/hash/length or absence entries. Candidate/reference `41ced5b4f920159dd72b07ba02612f5532e187a3:db5ac0b8541a46c58df25572894b91cf15bf0eb2`.
- Final source-after has 109 sorted path/hash/length or absence entries. Candidate/reference `41ced5b4f920159dd72b07ba02612f5532e187a3:db5ac0b8541a46c58df25572894b91cf15bf0eb2`.

Both runs' source comparisons show only the two reserved additions relative to release and zero pre-run/post-run differences. Source-before, initial and final candidate inventories and all phase artifacts remain below. Raw logs are the original command output files. The command wrapper's initial shell diagnostic is recorded separately above.

| Artifact relative to this workspace | Bytes | SHA-256 |
| --- | ---: | --- |
| `evidence/task-2/final-run-path` | 183 | `fd6e23b4e10d6f876d0221198965c2fcd542f425908308ab65bccf28a23ad5e0` |
| `evidence/task-2/inventory.py` | 1762 | `24443866cf830397371796e5d4bad587b0c216b466fcec5f4191c38f07a77cbc` |
| `evidence/task-2/run-buY8tTHy/failure-before-publication.json` | 3714 | `81aea82a1f4dccec9b7545962e2e08366f9d1d4eb1b437fdbae147128098683f` |
| `evidence/task-2/run-buY8tTHy/failure-capture-input-new.json` | 2224 | `ea805067edb535adf857239a7a36b5eb5c5f6ce5e8d47d297fee6191ec6774ce` |
| `evidence/task-2/run-buY8tTHy/failure-capture-input-old.json` | 1993 | `1bd0f9a9a91828d6cbc4ed6cfa6be47225f8ab1da32d00a8c6c6f6f0595bf558` |
| `evidence/task-2/run-buY8tTHy/failure-cleanup.json` | 622 | `15cf28e7392ba7b0c4879e556cb114082489c1e654ac4cff940eedaa30e1a03a` |
| `evidence/task-2/run-buY8tTHy/fresh-after-proof.json` | 3714 | `81aea82a1f4dccec9b7545962e2e08366f9d1d4eb1b437fdbae147128098683f` |
| `evidence/task-2/run-buY8tTHy/fresh-before-publication.json` | 3714 | `81aea82a1f4dccec9b7545962e2e08366f9d1d4eb1b437fdbae147128098683f` |
| `evidence/task-2/run-buY8tTHy/fresh-capture-input-new.json` | 2224 | `ea805067edb535adf857239a7a36b5eb5c5f6ce5e8d47d297fee6191ec6774ce` |
| `evidence/task-2/run-buY8tTHy/fresh-capture-input-old.json` | 1993 | `1bd0f9a9a91828d6cbc4ed6cfa6be47225f8ab1da32d00a8c6c6f6f0595bf558` |
| `evidence/task-2/run-buY8tTHy/fresh-cleanup.json` | 622 | `e74d8d0fa7d197d569cec9a8ecc8b120df1a35f2db45bc628feade62299df2b0` |
| `evidence/task-2/run-buY8tTHy/fresh-proof.json` | 26508 | `d2c230f3b2b236bad25d6e51245d8ac1ecdc1ac19af37053694ba541081117e4` |
| `evidence/task-2/run-buY8tTHy/integration.log` | 436 | `16bd26308c7583264984af2c2fe891405ff2add31b7f696a81a556c32d9d1239` |
| `evidence/task-2/run-buY8tTHy/primary-after-capture.json` | 3714 | `81aea82a1f4dccec9b7545962e2e08366f9d1d4eb1b437fdbae147128098683f` |
| `evidence/task-2/run-buY8tTHy/primary-after-proof.json` | 3714 | `81aea82a1f4dccec9b7545962e2e08366f9d1d4eb1b437fdbae147128098683f` |
| `evidence/task-2/run-buY8tTHy/primary-after-replay.json` | 3714 | `81aea82a1f4dccec9b7545962e2e08366f9d1d4eb1b437fdbae147128098683f` |
| `evidence/task-2/run-buY8tTHy/primary-before-publication.json` | 3714 | `81aea82a1f4dccec9b7545962e2e08366f9d1d4eb1b437fdbae147128098683f` |
| `evidence/task-2/run-buY8tTHy/primary-capture-and-replay.json` | 3557 | `f7eeef0c0eacb1c291cac84f2b22d6bb0fdebe7ed585fcce61d26afc529a7350` |
| `evidence/task-2/run-buY8tTHy/primary-capture-input-new.json` | 2224 | `ea805067edb535adf857239a7a36b5eb5c5f6ce5e8d47d297fee6191ec6774ce` |
| `evidence/task-2/run-buY8tTHy/primary-capture-input-old.json` | 1993 | `1bd0f9a9a91828d6cbc4ed6cfa6be47225f8ab1da32d00a8c6c6f6f0595bf558` |
| `evidence/task-2/run-buY8tTHy/primary-cleanup.json` | 622 | `955ebeaada22caf73155e307879e62e4efcd8621b6f81eca8c58caa01f842f46` |
| `evidence/task-2/run-buY8tTHy/primary-proof.json` | 26496 | `3f691585c293e77709867bc23d05a475d1acd8e8f6208faf1ef48ca495b97a94` |
| `evidence/task-2/run-buY8tTHy/status.log` | 28 | `e362238499ff4350697b4dbd839067e85f58ba28191641f012f6bd2261c46a78` |
| `evidence/task-2/run-buY8tTHy/toolchain.log` | 53 | `01a4411e6e776c81ba8e583ec9dbcca35b228f1726afce6958a71e07c402521f` |
| `evidence/task-2/run-buY8tTHy/typecheck.log` | 29 | `8fa1cf5506304e8abac55868e7f1a136c9b1dde57a3981a382da4c21ea129a6f` |
| `evidence/task-2/run-ljHYVraH/failure-before-publication.json` | 3714 | `81aea82a1f4dccec9b7545962e2e08366f9d1d4eb1b437fdbae147128098683f` |
| `evidence/task-2/run-ljHYVraH/failure-capture-input-new.json` | 2198 | `5c9fc29e307c6f05f29ae7ec3846d71bf90e703481f6d812d8380083718d9c8e` |
| `evidence/task-2/run-ljHYVraH/failure-capture-input-old.json` | 1967 | `a0fd6bea5f3cd235da3b4cc7fc0264630a1396c3da44d95d95d26a7cbc876c7d` |
| `evidence/task-2/run-ljHYVraH/failure-cleanup.json` | 453 | `644fde6d593aaa8bb5d79b886f9f8440933027b710261a1b0a6c476acdc19a1c` |
| `evidence/task-2/run-ljHYVraH/fresh-after-proof.json` | 3714 | `81aea82a1f4dccec9b7545962e2e08366f9d1d4eb1b437fdbae147128098683f` |
| `evidence/task-2/run-ljHYVraH/fresh-before-publication.json` | 3714 | `81aea82a1f4dccec9b7545962e2e08366f9d1d4eb1b437fdbae147128098683f` |
| `evidence/task-2/run-ljHYVraH/fresh-capture-input-new.json` | 2198 | `5c9fc29e307c6f05f29ae7ec3846d71bf90e703481f6d812d8380083718d9c8e` |
| `evidence/task-2/run-ljHYVraH/fresh-capture-input-old.json` | 1967 | `a0fd6bea5f3cd235da3b4cc7fc0264630a1396c3da44d95d95d26a7cbc876c7d` |
| `evidence/task-2/run-ljHYVraH/fresh-cleanup.json` | 453 | `1f7c7a20b07a0b59717745787c0644a65d08e10fc290e9b231a045a05956d458` |
| `evidence/task-2/run-ljHYVraH/fresh-proof.json` | 24214 | `4248069071cd854fae926d6eb7e7e51f70640c01d4c04f8a56f1294f6e59c861` |
| `evidence/task-2/run-ljHYVraH/integration.log` | 436 | `63b9b5dd4b364918677b9127de828c9741121c1a2316822ac18cf2638031d61d` |
| `evidence/task-2/run-ljHYVraH/primary-after-capture.json` | 3714 | `81aea82a1f4dccec9b7545962e2e08366f9d1d4eb1b437fdbae147128098683f` |
| `evidence/task-2/run-ljHYVraH/primary-after-proof.json` | 3714 | `81aea82a1f4dccec9b7545962e2e08366f9d1d4eb1b437fdbae147128098683f` |
| `evidence/task-2/run-ljHYVraH/primary-after-replay.json` | 3714 | `81aea82a1f4dccec9b7545962e2e08366f9d1d4eb1b437fdbae147128098683f` |
| `evidence/task-2/run-ljHYVraH/primary-before-publication.json` | 3714 | `81aea82a1f4dccec9b7545962e2e08366f9d1d4eb1b437fdbae147128098683f` |
| `evidence/task-2/run-ljHYVraH/primary-capture-and-replay.json` | 3557 | `d45fbd59a617bcfb4ece1832bdfeb4e0df0f8c4658d804f3c73c1c4a780f14a5` |
| `evidence/task-2/run-ljHYVraH/primary-capture-input-new.json` | 2198 | `5c9fc29e307c6f05f29ae7ec3846d71bf90e703481f6d812d8380083718d9c8e` |
| `evidence/task-2/run-ljHYVraH/primary-capture-input-old.json` | 1967 | `a0fd6bea5f3cd235da3b4cc7fc0264630a1396c3da44d95d95d26a7cbc876c7d` |
| `evidence/task-2/run-ljHYVraH/primary-cleanup.json` | 453 | `dc92ad749a75a700d90eb5658c1180cdfea2ecf7896d64702835a066c223d957` |
| `evidence/task-2/run-ljHYVraH/primary-proof.json` | 24187 | `d11fc71c0d28dba0ea6acbc42a20fe5160d737d005978626e8dcd45497b0e821` |
| `evidence/task-2/run-ljHYVraH/source-after.json` | 20004 | `63b4ce3f7ca28d87671875e2737419abd3183d00cf5ce916a0ea0290c61cbf83` |
| `evidence/task-2/run-ljHYVraH/source-comparison.json` | 338 | `c7bc16bb8cef072a8311e5474af56517e7b68198aecde700c9c76ec7f10e744c` |
| `evidence/task-2/run-ljHYVraH/source-pre-run.json` | 20004 | `63b4ce3f7ca28d87671875e2737419abd3183d00cf5ce916a0ea0290c61cbf83` |
| `evidence/task-2/run-ljHYVraH/status.log` | 13 | `46e30a761ca6fd0b4f75546bf2574bdbb39cfb978390e2ff0714e5d0e213da21` |
| `evidence/task-2/run-ljHYVraH/toolchain.log` | 53 | `01a4411e6e776c81ba8e583ec9dbcca35b228f1726afce6958a71e07c402521f` |
| `evidence/task-2/run-ljHYVraH/typecheck.log` | 29 | `8fa1cf5506304e8abac55868e7f1a136c9b1dde57a3981a382da4c21ea129a6f` |
| `evidence/task-2/run-path` | 183 | `c136f37fafc4cf18d7629bae8f8491aa0730828afcef909eba926200a9671966` |
| `evidence/task-2/source-after.json` | 20004 | `4ff1fe76978df62d7f07524f75b471a9214f209da0d3c80bec73ac8e24af342c` |
| `evidence/task-2/source-before.json` | 19795 | `50c261c196d7734d069345b5551494e2ce3beab204b362180d2d5b52c7c5c1a2` |
| `evidence/task-2/source-comparison.json` | 338 | `18ceb5cd5618a6257745308087611c13213bb55e4813e9edd270a092edf41fb9` |
| `evidence/task-2/source-pre-run.json` | 20004 | `4ff1fe76978df62d7f07524f75b471a9214f209da0d3c80bec73ac8e24af342c` |
