# Evidence

Follow the [package guide](../AGENTS.md) and the frozen [evidence and capture contract](../../docs/superpowers/plans/2026-11-08-contract-freeze.md#f4--evidence-uploads-and-coordinated-snapshots).

[Extraction](src/extract.ts) records the original media type and extractor version. [Locators](src/locate.ts) resolve immutable PDF, CSV, JSON, or email citations and preserve UTF-16 offsets where specified. [Byte storage](src/store.ts) verifies original hashes on reads and writes. The [source evidence service](../sources/src/evidence-records.ts) checks scoped associations before resolving evidence or original bytes.
