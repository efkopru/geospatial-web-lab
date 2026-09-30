# Second audit

Performed on 2026-09-29 after the first audit. This pass reproduced additional failures in account changes, asynchronous work, input validation, and runtime scripts. No database migrations were required.

## Findings and fixes

| Area | Reproduced flaw | Fix |
| --- | --- | --- |
| Authentication across tabs | Logout left another tab showing the previous account and its draft. | Broadcast authentication changes between tabs, fetch authoritative session state, and discard the previous workspace. Recheck on focus without resetting unchanged-account drafts. |
| Concurrent authentication requests | Old session responses could replace newer credentials; concurrent CSRF recovery could reject a legitimate mutation. | Reject reads from obsolete authentication generations and share a session lookup between concurrent recovery and focus requests. |
| Service upload | A delayed file read could submit an upload after logout or an account change. | Cancel continuations when their originating workflow unmounts. Obsolete data responses also stop issuing follow-up requests. |
| Service requests | Explicit null descriptions reached a database NOT NULL violation. | Normalize optional null descriptions to empty strings before validation. |
| Optimistic locking | Null, fractional, malformed, or oversized lock versions were coerced or caused HTTP 500. | Validate integer tokens and database bounds before writing. Apply this to service requests and inspections. |
| Queue acknowledgement | An enqueue error arriving after a worker started or completed could overwrite that work with a failed status. | Change only the still-pending record or matching generation; preserve committed progress and completed results. Covers imports, exports, dataset validation, and profiles. |
| Duplicate uploads | Concurrent uploads could hit model uniqueness validation and return an error instead of reusing the existing import. | Handle both validation-time and database-index races with the existing deduplication behavior. |
| Dataset rules | Malformed required-attribute collections could silently disable validation rules or cause server errors. | Require an array of valid attribute-name strings. |
| API shape validation | Scalar inspection objects and non-string parcel bounding boxes returned HTTP 500. | Reject invalid request shapes with client errors before accessing or parsing them. |
| Profile failures | Worker exceptions exposed internal details through API-visible error messages. | Return a fixed retry message and retain diagnostic details only in server logs. |
| Inspection editing | A late save for one asset erased a newer draft and replaced the details of another selected asset. | Track draft revisions and fetch details for the current selection. |
| Process shutdown | A stale PID file could target an unrelated process whose command merely contained `puma` or `sidekiq`. | Check executable and process-title structure, as well as working directory and PID. The regression uses a disposable unrelated process. |
| Database configuration | URI punctuation in a valid database password broke the Compose connection URL. | Supply passwords through `PGPASSWORD`, separately from `DATABASE_URL`. Verify actual PostgreSQL connections for all five Compose definitions. |
| Test reliability | The parcel concurrency test intercepted an initial lookup as if it were the failure handler, depending on test order. | Limit the simulated concurrent update to the unfinished-revision failure query. The original failing seed now passes. |

## Evidence

New backend regressions are in projects 01 and 02 at `backend/test/second_audit_test.rb`, and projects 04 and 05 at `backend/test/second_domain_regression_test.rb`.

Frontend evidence is in `tests/second-data-ui.test.jsx`, `tests/second-domain-inspections.test.jsx`, and the expanded `tests/session-audit.test.jsx`. `tests/browser/session-tabs.spec.js` reproduces logout and account changes across two real browser tabs. Runtime evidence includes `tests/runtime-shell.test.sh` and `tests/database-password.rb`.

See [VERIFICATION.md](VERIFICATION.md) for final combined results. Tests use synthetic local data and real Rails/PostgreSQL/Redis services where applicable. Test-only adapters reproduce queue acknowledgement failures deterministically.

Docker Compose configuration and direct PostgreSQL connections are verified. Actual container builds and execution remain unverified because Docker Desktop's engine is unavailable. No remote CI or public deployment was performed.
