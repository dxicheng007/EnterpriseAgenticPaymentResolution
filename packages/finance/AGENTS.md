# Finance

Follow the [package guide](../AGENTS.md) and [repository instructions](../../AGENTS.md).
The pure [balance](src/balance.ts) and [target validation](src/validate.ts) functions use checked integer cents and explicit effective times. [Allocations](src/allocations.ts) require matching invoice and funding references in scope. [Full reversals](src/reversals.ts) preserve the original funding and void its associated allocations at the reversal's effective time.
