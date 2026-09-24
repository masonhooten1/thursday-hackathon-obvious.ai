// Regression coverage for the WAR pattern fix and the QA builder hooks.
//
// Chrome 154 rejects web_accessible_resources "matches" patterns that name a
// path below the origin root (e.g. https://www.linkedin.com/in/*) — the whole
// extension fails to load with ERR_INVALID_COMMAND_LINE. The shipped manifest
// therefore keeps every WAR match origin-rooted, and the QA builder's
// generated localhost entries follow the same rule.

import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildQaCopy } from './build-qa-copy.js';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const API_ORIGIN = 'http://127.0.0.1:8899';
const PAGE_ORIGIN = 'http://127.0.0.1:8898';

function loadManifest(dir) {
  return JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
}

describe('shipped manifest web_accessible_resources', () => {
  it('keeps every match pattern origin-rooted', () => {
    const manifest = loadManifest(repoRoot);
    const matches = manifest.web_accessible_resources.flatMap((war) => war.matches);
    expect(matches.length).toBeGreaterThan(0);
    for (const match of matches) {
      // Chrome 154 rejects path-specific patterns like .../in/*; only /* loads.
      expect(new URL(match).pathname, match).toBe('/*');
    }
  });
});

describe('buildQaCopy', () => {
  let target;

  function buildCopy() {
    target = mkdtempSync(path.join(tmpdir(), 'qa-copy-'));
    return buildQaCopy({ source: repoRoot, target });
  }

  it('adds the stub origins without widening the shipped patterns', () => {
    buildCopy();
    const manifest = loadManifest(target);

    // (2) host_permissions gain exactly the stub API origin.
    expect(manifest.host_permissions).toContain(`${API_ORIGIN}/*`);
    expect(manifest.host_permissions).not.toContain(`${API_ORIGIN}/in/*`);

    // (3) content scripts run on the stub profile pages next to LinkedIn's.
    const matches = manifest.content_scripts.flatMap((cs) => cs.matches);
    expect(matches).toContain('https://www.linkedin.com/in/*');
    expect(matches).toContain(`${PAGE_ORIGIN}/in/*`);

    // (3b) WAR matches for the stub page are origin-rooted — the same Chrome
    // 154 constraint the shipped manifest follows.
    const warMatches = manifest.web_accessible_resources.flatMap((war) => war.matches);
    expect(warMatches).toContain(`${PAGE_ORIGIN}/*`);
    expect(warMatches).not.toContain(`${PAGE_ORIGIN}/in/*`);
    for (const match of warMatches) {
      expect(new URL(match).pathname, match).toBe('/*');
    }
  });

  it('generates the endpoint override module and imports it first in the worker', () => {
    buildCopy();
    const qaEndpoints = readFileSync(path.join(target, 'src', 'background', 'qa-endpoints.js'), 'utf8');
    expect(qaEndpoints).toContain(`globalThis.__PROSPEO_ENDPOINT__ = '${API_ORIGIN}/enrich-person'`);
    expect(qaEndpoints).toContain(`globalThis.__HUNTER_ENDPOINT__ = '${API_ORIGIN}/v2/email-finder'`);

    const worker = readFileSync(path.join(target, 'src', 'background', 'service-worker.js'), 'utf8');
    expect(worker.startsWith("import './qa-endpoints.js';")).toBe(true);
  });

  it('relaxes the pill host check only inside the copy', () => {
    buildCopy();
    const copied = readFileSync(path.join(target, 'src', 'content', 'detect.js'), 'utf8');
    expect(copied).toContain("parsed.hostname !== '127.0.0.1'");

    const shipped = readFileSync(path.join(repoRoot, 'src', 'content', 'detect.js'), 'utf8');
    expect(shipped).not.toContain("parsed.hostname !== '127.0.0.1'");
  });

  it('rejects a source without a manifest', () => {
    expect(() => buildQaCopy({ source: tmpdir(), target: mkdtempSync(path.join(tmpdir(), 'qa-x-')) })).toThrow(
      /--source \(repo root\) and --target are required/,
    );
  });

  it('leaves nothing behind', () => {
    buildCopy();
    rmSync(target, { recursive: true, force: true });
  });
});
