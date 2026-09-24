# Campground seed — provenance and curation rules

These files are the v1 campground catalog: **six marquee parks, 60 campgrounds**,
every row a real Recreation.gov facility observed live on **2026-09-24**.

- `parks.json` — the six marquee parks, keyed by Recreation.gov recarea id.
- `campgrounds.json` — the campground rows matching the shared zod contract
  (`packages/shared/src/contract.ts`): facilityId, parkId, name, lat/lng,
  bookingUrl, normalized siteTypes.

Both files carry `version: 1` and `generatedAt`. The format is pinned by
`version`; breaking changes bump it and the seeder rejects older layouts.

## How the data was produced

Generated from the live Recreation.gov search / campground-detail / campsites
endpoints (documented in `docs/recreation-gov-endpoints.md`) by:

```sh
npm run generate-catalog --workspace=@campground/api
```

The generator encodes the curation rules below, is strictly sequential and
polite (identifying User-Agent, request spacing, 429 backoff), caches responses
on disk (`data/generate-cache/`, gitignored), and skips a facility whose detail
page 404s with a visible `DEAD facility id` warning. Curation decisions are
encoded as `EXCLUDED_FACILITY_IDS` / `MANUAL_FACILITY_IDS` so a regeneration
reproduces these files deterministically (only `generatedAt` changes).

## Curation rules

1. **Six marquee parks**, keyed by Recreation.gov recarea id:
   Yosemite (2991), Yellowstone (2988), Grand Canyon (2733), Zion (2994),
   Great Smoky Mountains (2739), Glacier (2725) — all verified in the search
   index during the 2026-09-24 pull.
2. **Overnight campground entities only.** Entities flagged day-use by the
   search API (`campsite_type_of_use: ["Day"]` without `Overnight`) are
   excluded: the GSM picnic pavilions, Appalachian Clubhouse, and Spence
   Cabin. Colter Bay Marina End Ties (10246274) is bookable but lists boat
   slips, not campsites.
3. **Dead ids are excluded**, not shipped: Trailer Village RV Park
   (10111236) returned 404 on both its booking page and campsites endpoint.
4. **Deactivated-but-resolvable campgrounds stay in the catalog** — seasonal
   closures are availability state, not catalog absence. Norris (259306) and
   Pebble Creek (259307) are deactivated today; their reservation pages and
   detail records resolve. The seeder's health check (page 200) passes for
   them; the availability poller decides what to show.
5. **siteTypes** derive from the live campsite inventory via
   `normalizeSiteTypes` (shared package): STANDARD/WALK-TO/TENT/ADMIRATION →
   tent, RV → rv, CABIN/LODGING → cabin, GROUP → group, everything else
   (equestrian, sleeping shelters) → other. A campground with zero bookable
   sites would be excluded; all 60 have non-empty inventories.

## Health-check semantics

`npm run seed --workspace=@campground/api` health-checks every facility id
against `https://www.recreation.gov/camping/campgrounds/{facilityId}` at seed
time (spaced GETs, identifying User-Agent):

| Page response | Meaning | Seed behavior |
| --- | --- | --- |
| 200 | alive | — |
| 404 | dead id | **flagged in output; seed still succeeds** |
| 403 / 429 / 5xx / network error | unverified (may be transient) | flagged with a re-run hint |

Re-running the seed retries anything unverified. A flagged dead id is data
about catalog decay, not a seed error.
