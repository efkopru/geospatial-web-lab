# Audit and fixes

The subsequent [second audit](AUDIT_SECOND_PASS.md) records additional reproduced flaws and fixes. [VERIFICATION.md](VERIFICATION.md) contains the latest combined results.

Audited locally on 2026-09-29 across all five applications. The work covered authentication, permissions, asynchronous jobs, concurrent updates, frontend state, spatial geometry, startup, and deployment configuration.

## Corrected defects

| Area | Defect | Correction |
| --- | --- | --- |
| Authentication, all apps | A copied session cookie remained usable after logout. | Store digests of revocable login tokens, expire sessions after 24 hours, revoke the current login, and disconnect its WebSockets. Periodic authorization checks cover notification outages and role changes. |
| Shared frontend | Rotated CSRF tokens stranded mutations; stale authentication responses could overwrite a newer login. Failed logout produced an unhandled error. | Refresh and retry only explicit CSRF rejections, prohibit retry under a different account, ignore stale authentication results, clear expired sessions, and display logout failure. |
| Notifications | A failed live notification could turn a committed database action into an HTTP or job failure and prevent subsequent enqueueing. | Separate durable state changes from best-effort notification delivery. Preserve completed results when notifications fail. |
| Background queues | ActiveJob can return false after rejecting an enqueue, leaving records falsely pending. | Check enqueue results and expose retryable failures or roll back replay state. |
| Service reports | Concurrent export deliveries could overwrite a completed report. | Serialize export work with PostgreSQL advisory locks and verify contention using an independent database connection. |
| Data upload and editors | Old file reads, delayed saves, and overlapping refreshes could replace the active draft or newer results. | Sequence requests and file reads, reset invalid uploads, key editors by record, and isolate workspace state by account. |
| Parcel calculations | A failed older job could overwrite a newer revision; recalculation could discard a completed snapshot. | Guard failure updates by revision and status. Allow retries only for failed scenarios and preserve completed exports. |
| Inspection edits | A live status change could turn a pending resolve operation into an unintended reopen. | Retain the draft's original version and status; require stale drafts to be reopened before submission. |
| Spatial geometry | Polygon winding and anonymous feature IDs caused map errors; profile interpolation crossed the wrong side of the globe at the antimeridian. | Normalize exterior/hole winding without mutating input, use unambiguous feature lookup, guard map lifecycle callbacks, and sample profiles along geodesics. |
| API input | Fractional sequence/speed values were truncated; malformed object payloads could produce server errors. | Reject invalid numeric values and return 400 for malformed object bodies. |
| Startup | Starting applications could rerun demo seeds; stale process identifiers and failed children could leave inconsistent runtimes. | Separate explicit demo seeding, validate process ownership, lock supervisors, stop child processes on termination/failure, and propagate startup errors. |
| Deployment | Application database credentials had administrator privileges and insecure fallback secrets. | Require generated secrets, use a restricted application role and a separate administrator initialization step, run Rails containers without root, and add restart/shutdown policies. |

## Evidence and limits

Regression tests cover copied-cookie replay, expiry, independent logins, notification outages, cancelled enqueues, competing job deliveries, stale browser responses, malformed input, polygon holes, and antimeridian sampling. Browser tests use real Rails APIs, PostgreSQL/PostGIS, Redis, and workers.

See [VERIFICATION.md](VERIFICATION.md) for final test counts and deployment checks. The production JavaScript dependency audit reported zero known vulnerabilities on the audit date. That is a dependency advisory result, not a general security guarantee.

Docker Desktop's engine is unavailable in this environment. Compose parsing and restricted-role production migrations were verified; actual container image builds and container execution remain unverified. Remote CI and public deployment have not run.
