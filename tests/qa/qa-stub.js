// QA stub (spec §Verification V6): serves the recorded fixtures under
// tests/fixtures as a local provider API, plus a local stand-in "profile
// page" for the on-profile pill. Drives browser evidence without touching
// the real provider APIs or LinkedIn.
//
//   node tests/qa/qa-stub.js [--api-port 8899] [--page-port 8898]
//
// API stub (default port 8899) — the QA copy of the extension points the
// adapters' endpoint overrides (globalThis.__PROSPEO_ENDPOINT__ /
// __HUNTER_ENDPOINT__, resolved per call in src/providers/*.js) here:
//   POST /enrich-person     Prospeo shape, served per current scenario
//   GET  /v2/email-finder   Hunter shape, served per current scenario
//   POST|GET /__scenario    Inspect/set { provider, scenario, delayMs }
//
// Scenarios map to HTTP statuses the way the adapters classify them:
// found → 200, not_found → 200, rate_limited → 429, unauthorized → 401.
// delayMs holds a response open (popup "loading" state capture).
//
// Page server (default port 8898) — serves a plainly-labeled local page at
// /in/<handle> so the content script (matches the QA copy's added pattern)
// injects the pill. It is a simulation, styled as such on the page itself.
//
// No secrets flow through this server: the key sent by the extension is a
// throwaway QA value, and request logs deliberately exclude it.

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const FIXTURES_DIR = fileURLToPath(new URL('../fixtures/', import.meta.url));

const SCENARIOS = {
  found: 200,
  not_found: 200,
  rate_limited: 429,
  unauthorized: 401,
};

function argValue(flag, fallback) {
  const index = process.argv.indexOf(flag);
  return index !== -1 && process.argv[index + 1] ? Number(process.argv[index + 1]) : fallback;
}

const API_PORT = argValue('--api-port', 8899);
const PAGE_PORT = argValue('--page-port', 8898);

// Current scenario per provider; the driver flips these between captures.
const state = {
  prospeo: { scenario: 'found', delayMs: 0 },
  hunter: { scenario: 'found', delayMs: 0 },
};

function cors(res, preflight = false) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-KEY');
  // Opt-in for Chrome Private Network Access; ignored elsewhere.
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  if (preflight) res.setHeader('Access-Control-Max-Age', '86400');
}

function sendJson(res, status, body) {
  cors(res);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function serveFixture(provider, scenario) {
  const file = path.join(FIXTURES_DIR, provider, `${scenario}.json`);
  try {
    return { status: SCENARIOS[scenario], body: await readFile(file, 'utf8') };
  } catch (err) {
    console.error(`[stub] fixture missing: ${file} (${err.message})`);
    return { status: 500, body: '{"error": "fixture missing"}' };
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const apiServer = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    cors(res, true);
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://127.0.0.1:${API_PORT}`);

  if (url.pathname === '/__scenario') {
    if (req.method === 'POST') {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        try {
          const update = JSON.parse(body);
          const entry = state[update.provider];
          if (!entry || !SCENARIOS[update.scenario]) {
            sendJson(res, 400, { error: 'unknown provider or scenario' });
            return;
          }
          entry.scenario = update.scenario;
          entry.delayMs = Number(update.delayMs) || 0;
          console.log(`[stub] ${update.provider} scenario → ${entry.scenario} (delay ${entry.delayMs}ms)`);
          sendJson(res, 200, { ok: true, ...entry });
        } catch (err) {
          sendJson(res, 400, { error: `bad JSON: ${err.message}` });
        }
      });
      return;
    }
    sendJson(res, 200, state);
    return;
  }

  const provider = url.pathname === '/enrich-person' ? 'prospeo' : url.pathname === '/v2/email-finder' ? 'hunter' : null;
  if (provider && (req.method === 'POST' || req.method === 'GET')) {
    const { scenario, delayMs } = state[provider];
    if (delayMs) await sleep(delayMs);
    const { status, body } = await serveFixture(provider, scenario);
    console.log(`[stub] ${provider} ${req.method} ${url.pathname} → ${status} (${scenario})`);
    sendJson(res, status, JSON.parse(body));
    return;
  }

  sendJson(res, 404, { error: `not found: ${url.pathname}` });
});

// Plainly-labeled local stand-in for a LinkedIn profile page — the content
// script matches the QA copy's /in/* pattern and mounts the pill here.
const pageServer = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PAGE_PORT}`);
  const match = url.pathname.match(/^\/in\/([^/?#]+)/);
  if (!match) {
    res.writeHead(404, { 'Content-Type': 'text/html' });
    res.end('<h1>qa-stub page server</h1><p>Profiles live at /in/&lt;handle&gt;.</p>');
    return;
  }
  const handle = decodeURIComponent(match[1]);
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(`<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>${handle} — profile (local simulation)</title>
  <style>body{font:16px/1.5 system-ui,sans-serif;max-width:560px;margin:64px auto;color:#222}
  .tag{display:inline-block;background:#f2f2f2;border:1px solid #ddd;border-radius:6px;padding:2px 8px;font-size:12px;color:#666}</style></head>
  <body>
    <span class="tag">local simulation — qa-stub page server</span>
    <h1>${handle}</h1>
    <p>Software Engineer at Sterling Cooper</p>
    <p>Stands in for <code>https://www.linkedin.com/in/${handle}</code> so the
    on-profile pill can be exercised without touching LinkedIn.</p>
  </body>
</html>`);
});

apiServer.listen(API_PORT, '127.0.0.1', () => {
  console.log(`[stub] provider API on http://127.0.0.1:${API_PORT} (scenarios: ${Object.keys(SCENARIOS).join(', ')})`);
});
pageServer.listen(PAGE_PORT, '127.0.0.1', () => {
  console.log(`[stub] profile pages on http://127.0.0.1:${PAGE_PORT}/in/<handle>`);
});
