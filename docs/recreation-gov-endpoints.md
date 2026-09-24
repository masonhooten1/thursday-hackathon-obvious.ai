# Recreation.gov availability endpoint — discovery record

Discovered 2026-09-24 by loading a real campground reservation page in a driven
headless-Chrome browser (agent-browser, Chrome 154) and capturing the availability
XHRs with a HAR recording. Probes run against live services the same day.

## What changed vs. the community-documented paths

The paths community tools used until recently are gone: on 2026-09-24 a direct probe
of `GET /api/camps/availability/campground/232490` (three parameter variants,
documented in the MVP spec as E4) returned clean JSON `404 Not Found`. The live site
still uses the same base path — the difference is a **`/month` suffix on the path**
and a **renamed response key** (`camps` → `campsites`).

## The request the site actually makes

Loading `https://www.recreation.gov/camping/campgrounds/232490` (Mather Campground,
Grand Canyon NP) fires exactly two availability XHRs during page hydration, one per
month of the visible booking horizon:

```
GET https://www.recreation.gov/api/camps/availability/campground/232490/month?start_date=2026-09-01T00%3A00%3A00.000Z
GET https://www.recreation.gov/api/camps/availability/campground/232490/month?start_date=2026-10-01T00%3A00%3A00.000Z
```

- **Method / path**: `GET /api/camps/availability/campground/{facilityId}/month`
- **Query parameter**: `start_date` — the **first day of a month**, encoded as
  `YYYY-MM-01T00:00:00.000Z` (URL-encoded colons). The site requests the current
  month and the next month; each response covers that calendar month.
- **Auth**: none. The page's XHR carried no cookies, no `Authorization` header, and
  no API key (verified in the HAR capture). A plain `curl` with only `Accept` and a
  `User-Agent` header returns the full JSON (HTTP 200, ~570–630 KB for a 288-site
  campground, in under 0.6 s).
- **An identifying User-Agent is accepted**: `CampgroundTonight/0.1 (hackathon MVP;
  contact …; repo …)` returned HTTP 200 with a valid body — the honest UA does not
  trigger blocking. The adapter sends it.
- **Protocol**: HTTP/3 when the client supports it; the endpoint is a normal JSON
  resource, not a bot-guarded surface.

## Response shape

Top level (October probe, facility 232490):

```json
{
  "campsites": { "<campsite_id>": { /* CampsiteRecord */ } },
  "count": 288
}
```

`count` equals the number of entries in `campsites`. Each `CampsiteRecord` (field
names exactly as observed at Mather Campground, 2026-09-24):

```json
{
  "campsite_id": 4085,
  "site": "037",
  "loop": "Aspen Loop (Sites 1-59)",
  "campsite_reserve_type": "Site-Specific",
  "availabilities": {
    "2026-09-03T00:00:00Z": "Reserved",
    "2026-09-04T00:00:00Z": "Reserved"
  },
  "quantities": {
    "2026-09-01T00:00:00Z": 1,
    "2026-09-02T00:00:00Z": 1
  },
  "campsite_type": "RV NONELECTRIC",
  "type_of_use": "Overnight",
  "min_num_people": 0,
  "max_num_people": 6,
  "capacity_rating": "Single",
  "hide_external": false,
  "campsite_rules": {},
  "supplemental_camping": {}
}
```

Notes on the two maps, exactly as keyed by the service:

- **`availabilities`** keys are ISO datetimes at UTC midnight with a bare `Z`
  (`2026-09-03T00:00:00Z` — note: no milliseconds, unlike the request's
  `.000Z`), one entry per reservable night of the month. Coverage observed at
  Mather: every day of the requested calendar month.
- **`quantities`** keys use the same format; values observed were 0 or 1 per night
  (units per reservation, relevant for multi-unit group areas).

### Availability state vocabulary (observed counts across 288 sites × 30 nights)

| State                  | Count  | Means                                          |
| ---------------------- | ------ | ---------------------------------------------- |
| `Available`            | 760    | bookable that night — the only available state |
| `Reserved`             | 5,244  | already booked                                 |
| `Not Available Cutoff` | 967    | outside the bookable window (cutoff)           |
| `Closed`               | 23     | campground closed that night                   |

Treat **only the literal string `Available`** as available; anything else (including
future states not yet observed) counts as unavailable.

### `campsite_type` vocabulary (observed at facility 232490)

| Raw value                          | Sites | Maps to (shared contract) |
| ---------------------------------- | ----- | ------------------------- |
| `TENT ONLY NONELECTRIC`            | 143   | `tent`                    |
| `RV NONELECTRIC`                   | 76    | `rv`                      |
| `STANDARD NONELECTRIC`             | 60    | `tent`                    |
| `EQUESTRIAN NONELECTRIC`           | 2     | `other`                   |
| `GROUP TENT ONLY AREA NONELECTRIC` | 7     | `group`                   |

Normalization rule (checks in order, first match wins — `GROUP` must be tested
before `TENT` because group-tent names contain both): value containing `GROUP` →
`group`; containing `CABIN` → `cabin`; containing `RV`/`VEHICLE`/`TRAILER`/`CARAVAN`
→ `rv`; containing `TENT`/`STANDARD` → `tent`; **anything else → `other`** (per the
MVP spec: unknown site types normalize to `other`, never fail the snapshot).

## Adapter mapping (Recreation.gov availability → shared snapshot)

- The endpoint is **month-aligned**: one request per calendar month touched by the
  requested window (the site itself fetches current + next month). For a window
  starting mid-month plus 14 nights, that is two requests, merged per night.
- For each night in the window, `byType[type]` counts campsites whose
  `availabilities[key] === "Available"` for that night's date key, grouped by the
  normalized `campsite_type`. A missing date key counts as 0 (unreservable/beyond
  cutoff). `totalSites` is the number of campsites in the response.
- `windowStart` is the first night (UTC calendar date); the response's `nights`
  arrays cover exactly `windowStart … windowStart + nights - 1`.

## RIDB metadata endpoint (E2)

`GET https://ridb.recreation.gov/api/v1/facilities/{facilityId}` is the official
metadata source. Unauthenticated calls return `401 Unauthorized` (live probe,
2026-09-24); RIDB requires an API key (request header `apikey`), documented at
50 req/s. The keyed call is verified and its response shape recorded in this file
once the key is available. Metadata-only degradation mode (spec) applies if either
source proves unusable.

## Politeness policy (implemented in the shared client, `services/api/src/adapters`)

- one request in flight per host (single-flight queue per hostname)
- minimum spacing between requests to the same host (default 1 s — a full
  15-minute cycle over ~100 campgrounds finishes in ~100 s, well inside the window)
- identifying `User-Agent` on every request
- exponential backoff on `429`/`5xx` (honoring `Retry-After` when present); network
  errors are retried the same way
- **no retry on `403`** — a block is a signal, not an error to hammer; other `4xx`
  responses are deterministic and are not retried either
- concurrency stays at 1–2 requests; the poller staggers campgrounds across cycles

## Provenance

- Discovery session: 2026-09-24, headless Chrome 154 via agent-browser, HAR capture
  of 129 requests on the Mather Campground page (facility 232490).
- Direct probes from the repo sandbox same day: September window (HTTP 200,
  566,650 bytes, 288 campsites), October window with identifying UA (HTTP 200,
  631,374 bytes, 288 campsites).
- The committed test fixture
  (`services/api/src/adapters/__fixtures__/recreation-gov-month-232490.json`) is an
  excerpt of the captured September response — real campsite records covering every
  observed `campsite_type` and every availability state, plus one synthetic record
  with empty `availabilities` to pin the empty-range edge case.
