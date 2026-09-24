# Provider response fixtures

Expected-shape fixtures for the adapter tests (Vitest), following the spec's
research notes: [P1] Prospeo `enrich-person` (POST, `linkedin_url`, `X-KEY`
header) and [H1] Hunter `email-finder` (`linkedin_handle`, 1 Search credit per
call).

Classification of 429 / 401 / network failures is HTTP-status-driven, so the
bodies of `rate_limited.json` and `unauthorized.json` are illustrative
placeholders — what the adapter keys on is the status code, not the body.

The first time the extension runs against a live key, replace these with the
recorded real bodies (spec V3 pins the live response shape so CI stays
hermetic while the fixture stays honest). Each adapter's normalizer is
isolated: updating a shape touches one fixture and one test.
