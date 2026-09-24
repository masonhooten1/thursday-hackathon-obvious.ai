# @campground/api

The Campground Tonight API (spec D4): serves the campground catalog and cached
availability snapshots, and runs the in-process poller that keeps those
snapshots fresh. The poll cycle is the **only** component that talks to
external systems (Recreation.gov); every HTTP read serves data already stored
in SQLite.

## Run

```bash
# from the repo root — one npm install covers all workspaces
npm install

# seed the catalog (parks + campgrounds) into SQLite
npm run seed --workspace=@campground/api

# start the API on :8787 — scheduler armed, poll cadence 15 minutes
npm run dev --workspace=@campground/api
```

### Environment

| Variable             | Default                   | Meaning                                       |
| -------------------- | ------------------------- | --------------------------------------------- |
| `PORT`               | `8787`                    | HTTP port                                     |
| `CAMPGROUND_DB_PATH` | `campground.db`           | SQLite file (WAL)                             |
| `POLL_CRON`          | `*/15 * * * *`            | node-cron expression for the poll cadence     |
| `ADMIN_POLL_SECRET`  | unset (endpoint disabled) | Bearer secret for the manual poll trigger     |
| `POLL_USER_AGENT`    | `campground-tonight/0.1…` | Identifying User-Agent sent to Recreation.gov |

## Endpoints

- `GET /health` — liveness.
- `GET /api/parks` — the curated park list.
- `GET /api/campgrounds?parkId=&type=` — catalog campgrounds; `type` is one of
  `tent | rv | cabin | group | other`; both filters combine and are optional.
- `GET /api/availability?date=YYYY-MM-DD` — every campground with its latest
  snapshot (defaults to tonight, UTC). Counts are per site type per night; the
  response-level `stale` flag is true when the freshest served snapshot is at
  least twice the poll interval old (30 minutes at the default cadence). A
  campground with no snapshot yet has `snapshot: null` — the app renders that
  as "checking…", not as zero availability.
- `POST /api/admin/poll` — runs one poll cycle now and returns its report
  (`polled`, `succeeded`, `failed`, `failures`, `pruned`). Guarded by
  `Authorization: Bearer <ADMIN_POLL_SECRET>`; disabled with 503 when the
  secret is unset; 409 when a cycle is already in flight.

```bash
curl -X POST -H "Authorization: Bearer $ADMIN_POLL_SECRET" \
  http://localhost:8787/api/admin/poll
```

## How the poller behaves

- One cycle = every catalog campground, polled **sequentially** with a 250 ms
  stagger — a stroll, never a burst — fetching a 14-night window each.
- One snapshot row per campground per cycle. Rows are keyed by
  `(facility_id, captured_at)`: a re-polled identical cycle rewrites rather
  than duplicates.
- A failing facility never breaks the cycle: its last-known snapshot stays
  live, the failure is logged (`source degraded for facility …`) and reported.
  A source answering for the wrong facility is treated as a failure, not data.
- Each cycle ends by pruning snapshots older than 7 days.
- Re-entry guard: a second cycle cannot start while one runs (the admin
  trigger surfaces this as 409).

## Tests

```bash
npm test --workspace=@campground/api          # Vitest (all suites)
npm run lint --workspace=@campground/api      # ESLint
npm run typecheck --workspace=@campground/api # tsc --noEmit
```

Integration tests (`src/app.test.ts`) wire the real poller to a fake
`AvailabilitySource` behind the adapter interface: one tick → snapshots →
GET returns counts and freshness, including the stale boundaries at exactly
15 and 30 minutes, and the bearer rejections on the admin trigger.
