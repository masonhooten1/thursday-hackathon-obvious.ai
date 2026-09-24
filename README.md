# LinkedIn to Email

A Chrome (Manifest V3) extension that resolves the LinkedIn profile you are viewing to that person's company email — one click, without leaving the page.

Bring your own enrichment key: lookups go straight from your browser to Prospeo (default) or Hunter. Your key, your credits, your account. Results are shown and copied, never stored.

> **Status: scaffold.** The manifest, CI, and tooling are in place. Placeholder files stand in for the lookup flow, popup, and options page, which land in later tasks.

## How it works

1. While you view a profile on `linkedin.com/in/...`, the extension reads the profile URL from the address bar — it never scrapes LinkedIn's page markup.
2. One click sends that URL to the enrichment provider through the extension's service worker. Your API key is stored locally and sent only to its provider's API.
3. The company email is shown inline and in the popup, with copy-to-clipboard.

## Load the extension unpacked

1. Clone or download this repo.
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and select this repo's root folder (the directory containing `manifest.json`).
5. Pin the extension and open **Options** to add your enrichment API key. (The options UI is a placeholder until the settings task lands.)

## Development

Requires Node 20+.

```bash
npm install
npm test                 # Vitest unit tests
npm run check:manifest   # validate manifest.json keys + referenced files
```

CI runs both checks on every push to `main` and every pull request.

## Scope

In scope: single-profile lookup, two providers (Prospeo, Hunter), bring-your-own key, results shown but never stored. Out of scope: bulk or CSV enrichment, automated crawling, email sending, CRM sync. Automated access is against LinkedIn's ToS — this extension reads only the URL you are already viewing — and matching identities to work emails is GDPR-relevant, so use it for legitimate outreach from your own account.
