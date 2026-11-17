# Decision: synchronization owns replicas; providers own transport

Accepted 15 November 2026. Design constraint for CLOUD-01; synchronization is not implemented by this refactor.

Google Drive is the first requested provider, with other storage providers later. The editor must continue to function offline. A provider SDK belongs behind a transport adapter, outside document commands and view components. A synchronization service decides which revisions to transfer and how to preserve conflicts; a provider transports immutable objects and revision references. Native/web authentication and account secrets remain platform concerns.

The transferable authority is validated document revisions and original media. Tabs, selections, window placement and live undo stay local. Document IDs remain stable across devices. The current `document.version` is a local edit counter; two offline devices can produce the same counter. Neither that number nor a modification timestamp can establish a winner.

Before implementing a provider:

1. Define a remote vault identity, manifest capability and content-digested immutable objects. Upload referenced objects completely before publishing a manifest that points at them.
2. Record the last common revision/base hash locally. Publish conditionally against an observed remote revision, using verified provider capabilities or another explicit coordination mechanism. Do not assume the local filesystem guard works remotely.
3. Detect concurrent branches from their base relationships. Retain both recoverable revisions/conflicts, including rich text, geometry and original media. Do not silently choose the later timestamp or rewrite IDs to hide a conflict. Automatic merging requires its own semantics/tests.
4. Represent deletion/restore explicitly and retain referenced assets until recovery and all applicable replicas permit cleanup. Interrupted transfers, retries, pagination, offline restarts and stale clients must be testable through the transport boundary.
5. Validate every downloaded document through the same schema/migration boundary before making it canonical. Unsupported/newer capabilities fail closed. Account/provider switching must not mix vault identities.

The existing file-vault engine supplies local atomic commits, immutable revisions and byte IO separation. It remains the local persistence authority. Future cloud replication should consume a committed snapshot and submit validated revisions through the local writer, preserving its lease and pending-edit rules. A CRDT, server or particular cloud SDK has not been selected.

Use the same seams for original scan images and positional OCR. Region links need stable page/region targets before cloud transport; provider file paths or mutable note titles must not become link identity. See CLOUD-01, SCAN-01, REGION-01, PAGE-02 and SCALE-01 in the [backlog](../backlog.md).
