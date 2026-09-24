# Google Maps key setup

The terrain map needs a **billing-enabled Google Maps Platform key**. One key
serves both surfaces:

- **Native (react-native-maps, provider `google`)** — read at Expo config
  time from `GOOGLE_MAPS_API_KEY` (`apps/mobile/app.config.ts`).
- **Web (Google Maps JavaScript API)** — inlined into the bundle at build
  time from `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY`. Expo exposes any env var
  prefixed `EXPO_PUBLIC_` to app code; the key never appears in source.

The key is stored as the Obvious secret `GOOGLE_MAPS_API_KEY` (already
approved for this project). For a local shell, export both variables before
running Expo:

```bash
export GOOGLE_MAPS_API_KEY=...            # native (app.config.ts)
export EXPO_PUBLIC_GOOGLE_MAPS_API_KEY=$GOOGLE_MAPS_API_KEY  # web bundle
```

CI builds **without** the key: the web export renders the labeled fallback
("Map preview unavailable — set a Google Maps key") instead of a blank page,
and native builds get no key entry in the app config. Nothing in the build
depends on the key being present — by design, per the spec's degradation
rule.

Restrict the key in Google Cloud Console for production use: referrer
restrictions for the JS API, bundle-id/package-name restrictions for native.
Never commit key values — only the env-var plumbing lives in this repo.
