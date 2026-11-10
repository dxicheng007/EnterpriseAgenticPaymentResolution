# Independent scoped A4 authorization repair review

Candidate: `393d47ae01b9d56c548c554a37003f6658e3d54a`
Previously reviewed base: `bd3907959be6c3f0be191ba185ff60bde63cc30c`

**Verdict: approved for the scoped repair. No remaining finding or new regression identified in the fix diff.** The prior P2 source-authorization-before-conflict finding is addressed. This closes that A4 review blocker; it does not claim A5 implementation, worker delivery, or joint acceptance.

Reviewed the three-file candidate delta, prior independent review, tracked Authorization review repair report, A4 authorization/recovery handoff and normative authority proposal, actual activation service/routes and authorization helpers, and correction/restart regression coverage. HEAD matched the candidate. The two root-owned untracked review documents are not source changes.

The same-account branch checks the immutable intent source before comparing canonical requests, so exact and changed source-forbidden requests both fail 403. Exact authorized recovery uses the original intent directly; it neither reads the current head nor revalidates policy/preparation, and retains original bundle and reviewer association.

The foreign-account branch resolves the requested account's saved head and checks that source grant before returning the generic key conflict. It does not return the foreign account, source, request, bundle or receipt, nor require a grant for the foreign source. This preserves the specified generic cross-scope conflict after authorization of the requested subject. Missing requested heads return the same 404 whether the global key is occupied elsewhere or unused; there is no key-dependent foreign association disclosure in that branch. All rejection paths precede publication and intent commitment.

The added integration assertions use the real committed intent and trusted publisher, cover forbidden exact/changed/foreign-account requests, authorized requested-source collision, missing head, unchanged intent and absent published bundle. Existing composed restart coverage still proves a new authorized session can recover the original intent after head correction and loss of current policy. The reported RED/GREEN and typecheck/composed integration pass are builder evidence; I did not duplicate database suites.

Independent execution: a focused Node 24 reproduction imported the actual candidate `createActivationReview` with controlled repository/publisher ports. It passed exact and changed same-account 403, foreign-account 403/authorized 409, occupied-versus-unused-key missing-head 404 coherence, zero publication for all rejected calls, and successful exact retry with absent head, zero head reads and no preparation revalidation. This is targeted service evidence, not an additional database or end-to-end result.

No source edits, commits, database suites or subagents were used. Earlier scoped review limitations and acceptance boundaries remain unchanged.
