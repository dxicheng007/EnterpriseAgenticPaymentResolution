# A3a parent-storage handoff — independent architecture review

Reviewed handoff: `b-parent-storage-handoff.md`, SHA-256 `0f095fc7524df2b40dc811007ef39da8db049e666861e51a379a9aa59ba3d3b8`. Source inspection HEAD: `700d1353b9d18d6425b79e710636d68690424b79`. The A0 authority schema, hash and v2 bundle source files have no diff from accepted integration `6336517`.

**Specification verdict: aligned. Handoff-quality verdict: ready for bounded A3a implementation, with the nonblocking lock/privilege implementation note below.** No material product or financial specification gap was found. This review does not authorize dispatch or establish implementation correctness.

## Evidence and scope

Read repository, packages, parent, database and tests instructions; PRD thesis, process boundaries and acceptance criteria; implementation verification conventions and shared ownership; F1/F3/F5; activation-shapes and additive authority freezes; actual A0 contracts; parent state/bootstrap projection; storage transaction/activity helpers; runtime001 and migration role binding. Compared the accepted authority proposal §§7–9 and A3 handoff split. Independently checked their SHA-256 values: proposal `23e7117c3b1ac8cb5c4c44b044ed2efd53530f55e38294f0165ec9ba9db1f737`, handoffs `063bab1a66159f118f269c97c84a537c1529a64a0c8a7d743039f6b4096be45a`.

The assigned migration and repository paths are concrete, owned by one proposed writer and exclude control006/control007, shared contracts, composition and existing pure projections. Keeping activation storage under the existing parent workspace is consistent with the accepted handoff's explicit instruction to check ownership before creating a runtime package. Root retains lockfile and broader regression ownership.

Canonical text/digest storage distinguishes full-object byte identity from domain hashes. Scoped customer association, exact ensures, globally unique economic identities independent of account/event/version, immutable delivery bytes including observedAt, original economic receipt ownership, ordered complete lineage and paired activation/initial receipt match the frozen requirements. The before/planner/approved target distinction avoids changing historical hashes by silently replacing recorded time. Unique snapshot version applies to persisted snapshots; the copied planner baseline is separately retained in the aggregate.

Storage reads return absence without seeding state; they do not resolve untrusted scope or fabricate inactive state. A3b requires A2's actual published registry and loader, then adds authenticated composed reads. A3a does not claim this prerequisite is complete. A5 retains authorization, installed-policy/semantic checks, exact full-plan recomputation and transaction ownership. No later sync replay association, status transition, reenrollment or checkpoint policy is inferred from the storage schema.

## Implementation note: match locks to app-role privileges

Lines 48 and 58–59 require SELECT/INSERT-only immutable tables while also requiring scope/activation/identity locking. PostgreSQL 18 locking SELECT clauses, including `FOR KEY SHARE`, require UPDATE privilege on at least one selected table column. An implementation that uses `SELECT FOR UPDATE` on the immutable sentinel or aggregate under the specified grants will fail. This is a concrete implementation trap, not a missing financial rule. See [PostgreSQL 18 SELECT privileges](https://www.postgresql.org/docs/18/sql-select.html).

Use transaction-scoped advisory locks for immutable/absent scope and activation identities, then read and compare the immutable rows under those locks; keep the specified scope→activation→target→economic/delivery ordering and SQL uniqueness guards. Lock the mutable current pointer with its permitted UPDATE privilege. This preserves the brief's lock responsibilities without adding write rights to immutable records. Do not silently grant UPDATE or use an upsert-update merely to acquire a lock. If the implementer instead requires immutable row-lock clauses, return that exact privilege change to the owner first. The real app-role race tests must exercise the chosen protocol, including an already-existing sentinel/aggregate, rather than run mutation calls as the migration administrator.

## Verification and remaining dependencies

The required tests are meaningful storage evidence: real isolated PostgreSQL migrations/permissions, digest and indexed-field corruption rejection, canonical restart recovery, scoped collisions, global economic and delivery races, whole-transaction retry, rollback including activity counter, immutable historical reconstruction and zero-write reads. Administrative fixtures for corruption/history are clearly separated from application-role mutations. Nonempty imports and exact ensures must be exercised with validated fixtures; schema acceptance alone is not A5 authority proof.

No blocking dependency is missing for A3a after root's runtime002 reservation and accepted A0. A2 remains mandatory for A3b; A4/A5 retain their separately specified provenance, policy, semantic and readiness prerequisites. Existing schema-sensitive regressions and package-lock integration remain root-coordinated, as the handoff states. The implementation must return its concrete exported signatures and exact machine evidence for fresh code review.

Review method was bounded source/spec inspection plus the official PostgreSQL privilege reference. No SQL, implementation code, tests, commits or subagents were created or run. Only this review report was written. No broad existing-code review, V3 gate pass, live activation, sync proof or joint acceptance is claimed.
