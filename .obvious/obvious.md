# obvious.md — thursday-hackathon-obvious.ai

## Repo status

Chrome MV3 extension ("LinkedIn to Email") scaffolded: `manifest.json`, placeholder
source files, Vitest tooling, a manifest sanity check, and a GitHub Actions CI
workflow. Feature code — URL capture, provider adapters, popup/options UI — lands
in later tasks; placeholders stand in until then.

## Stack

- Chrome Manifest V3 extension: vanilla JavaScript ES modules, no bundler
- Node 20 for tooling; Vitest for unit tests; no runtime dependencies

## Commands

- `npm install` — install dev dependencies
- `npm test` — run the Vitest suite
- `npm run check:manifest` — validate `manifest.json` (required keys, referenced files)

Local verification: load the repo root unpacked at `chrome://extensions` (see README).

## Handoff

CI (`.github/workflows/ci.yml`) runs install, Vitest, and the manifest check on
every push to `main` and every PR. Provider adapters must keep the normalized-result
contract described in the project spec (Obvious blueprint art_n2m5gMDY).
