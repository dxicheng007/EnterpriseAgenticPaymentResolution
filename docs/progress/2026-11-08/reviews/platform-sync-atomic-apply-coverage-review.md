# Scoped atomic-apply bounded coverage review

Candidate: `docs/progress/2026-11-08/handoffs/platform-sync-atomic-apply-design.md`

Repository inspected read-only: `/Users/devincheng/.codex/worktrees/platform-activation-integration/EnterpriseAgenticPaymentResolution`.

Verified candidate SHA-256: `4e07cae264aaae9bd4790240332061bc48d540de3eb99275ba1629dae45084ce`.

## Verdict

**Original P2 bounded-coverage/concurrent-capture finding: ADDRESSED.**

**Specification: aligned for the explicitly bounded, internal, unmounted primitive. Engineering quality: sufficient to proceed to a separately scoped implementation plan. No actionable residual or new breakage identified in this repair.** This is design review only; it authorizes no implementation, reservation, mounting, production synchronization claim, or joint user acceptance.

## Basis

1. **Coverage now comes from authoritative storage, not fixture emptiness.** Candidate lines 78–85 require the exact committed lane, exactly two declared streams and their checkpoint/baseline bindings, source-wide lane/undeclared-stream/incident checks, and complete source-global post-baseline financial history. The 1,000-event limit covers retained history, not merely the selected suffix. Global positions must be checked independently of matching inbox rows, preventing an inner join from concealing an orphan. Canonical page chains, event/delivery/inbox membership, counts, and range bindings establish completeness; overflow sentinels and explicit rejection prevent truncation from masquerading as coverage.

2. **Known captured blockers cannot disappear through selection or current equality.** Any post-baseline semantic history is unsupported, including a change followed by a return to the approved revision. Every financial-history member must resolve to the selected scope. Unexpected lanes/streams, malformed or foreign input, missing membership, and source incidents make the primitive unavailable. Previously traversed positions require actual successful immutable outcomes and original receipt associations. The new input is the entire suffix from the stored application frontier to the observed capture vector; no shorter caller-selected prefix may omit later captured work. This satisfies the original finding's request for a mechanically checked supported subset without inventing terminal skip/resolve authority.

3. **The concurrency boundary is precise and implementable without a new fence.** Lines 85–89 require one SQL statement snapshot for each coverage observation. Preparation obtains W; the authority/target-locked transaction obtains W' before classification acceptance or apply effects. Full canonical captured bindings and the extra-lane/incident predicates participate in equality; the frontier and historical outcomes are also bound and checked under account serialization. Changed coverage aborts with zero apply effects; retries cannot enlarge the prepared selection. Immutable rows may subsequently be checked by exact keys, but mutable capture state cannot be assembled piecemeal into a different cut.

4. **The locked statement snapshot is an observation cut, not a capture-to-commit exclusion guarantee.** Capture committed before W' is included. Capture committing afterward remains durable later input, even if it commits before the financial transaction; its positions cannot be acknowledged or advance this unit's application frontier. The next attempt must observe it. Lines 89–91 explicitly preserve this limit and introduce no capture checkpoint/global-stream lock or authority/hold writer. The authority head still fences actual pause/revocation through monetary commit. These are distinct boundaries and are not conflated.

5. **The frozen sources do not require a stronger capture/apply commit fence for this bounded increment.** PRD §11 requires durable capture, declared schema/semantic dependencies, containment, and contiguous application outcomes; §16 separately specifies account authority serialization and capture-checkpoint locking when advancing capture. F1 requires source-wide containment for missing/ambiguous seller or unscoped governing changes, and F4 requires unseen/changed event semantic dependencies to hold regardless of metadata delivery order. The candidate rejects all such captured history visible at its cut and retains per-event dependency checks plus independent current preflight. F5 expressly distinguishes pre-transaction semantic observation from subsequently arriving changes protected by event dependencies. No cited frozen requirement supplies an additional commit-time capture exclusion protocol. Requiring one here would strengthen the contract rather than repair this P2.

6. **The supported scope remains honestly narrow.** Rejecting another customer's otherwise valid history is unsupported coverage for this primitive, not a claim that the other customer's revision creates selected-customer drift or a source pause. Thus the design does not claim PRD-level independent-customer scheduling, long-running synchronization, complete document notification, or Company B support. Named future cases cover a blocker outside selection, capture changes before W', and capture after W', including sticky semantic history, corruption and overflow. Classifier `ec91a4bae74ab22623ed5cdeaf55f4de07e085a6` is pinned to its accepted exact-candidate review; active-only new replay bookkeeping is correctly treated as settled, not reopened policy.

## Proof limits and handoff

The later implementation plan must preserve the actual single-statement snapshot, bounded results, full-history/anti-orphan checks, canonical W/W' equality, audit binding and exact frontier checks described here. It must define strict query/result/failure and persistence shapes and prove the named barriers with real PostgreSQL. These are implementation obligations, not residual design findings. No SQL implementation, query plan, race test, runtime writer, or database was exercised by this review.

Read the original tracked review, exact repair diff/report, candidate, relevant PRD §§10–13/16, frozen F1/F4/F5 and authority/progress deferral, capture implementation report, accepted current-authority boundary, classifier exact-candidate review, repository guidance, shared lock/ownership rules, and verification conventions. Only this temporary report was written. No source, database, tests, migrations, commits, reservations or subagents were used. Machine proof, implementation review, live V5/V6 evidence and joint user acceptance remain separate.
