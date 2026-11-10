# User decision: explicit grants for proposed customer scopes

On November 10, 2026, the user answered the pending authorization question:

> The specification leaves this authorization choice open: for a newly proposed customer ID, who should grant read/verification-only access? Either option would still require separate explicit reviewer approval before importing records or enabling synchronization.

User answer:

> Require an explicit trusted operator/reviewer grant for each proposed scope (recommended).

This selects the explicit trusted grant approach from the [P4 policy audit](discovery-unblock-policy-audit.md#b--generated-account-readverify-capability). A proposal, finding or generated ID cannot grant itself access. Read/verification access to each exact proposed scope must be granted through trusted operator/reviewer authority. Approval to import records or enable synchronization remains a separate explicit per-customer reviewer decision. Existing parent-record access remains separately authorized under the existing specification.

This resolves the grantor/automatic-trust product choice. It does not mean that a dynamic grant workflow, grant storage, browser action or new API is already implemented. Existing trusted allowlists and fail-closed verification admission remain effective until a separately reviewed implementation is released. Operator runtime scope publication remains distinct from a Discovery verification grant.

Platform owns the narrow trusted grant contract, server-side admission/composition and any separately reserved storage; Discovery consumes the accepted grants without self-authorizing; Experience owns any separately released reviewer interface. Technical design must bind exact source/proposed scope, provenance and current authorization, preserve existing parent-read separation, and reuse existing authoritative rules. Materially unspecified policy still requires an exact gap to be raised; routine implementation details do not require another approval request.

The active selector tasks and their source/SQL leases are unchanged. Grant design can proceed independently, with source work serialized under the existing one-writer rule. This decision supplies no provider credentials, model/live permission, financial approval, or synchronization authority.
