#!/usr/bin/env node
// Manifest sanity check: required keys present with spec values, and every
// file the manifest references exists on disk. Exits non-zero listing all
// problems at once, so CI failures are diagnosable in one pass.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];

function check(condition, message) {
  if (!condition) errors.push(message);
}

let manifest = null;
try {
  manifest = JSON.parse(readFileSync(resolve(repoRoot, 'manifest.json'), 'utf8'));
} catch (err) {
  errors.push(`manifest.json is missing or is not valid JSON: ${err.message}`);
}

if (manifest) {
  check(manifest.manifest_version === 3, 'manifest_version must be 3');
  check(
    typeof manifest.name === 'string' && manifest.name.length > 0,
    'name must be a non-empty string',
  );
  check(
    typeof manifest.version === 'string' && /^\d+\.\d+\.\d+$/.test(manifest.version),
    'version must be a semver string (x.y.z)',
  );

  const permissions = manifest.permissions ?? [];
  for (const permission of ['storage', 'activeTab']) {
    check(permissions.includes(permission), `permissions must include "${permission}"`);
  }

  const hosts = manifest.host_permissions ?? [];
  for (const host of ['https://api.prospeo.io/*', 'https://api.hunter.io/*']) {
    check(hosts.includes(host), `host_permissions must include "${host}"`);
  }

  check(manifest.background?.type === 'module', 'background.type must be "module"');
  check(
    typeof manifest.background?.service_worker === 'string',
    'background.service_worker must be a string',
  );

  const contentScript = manifest.content_scripts?.[0];
  check(
    Array.isArray(manifest.content_scripts) && manifest.content_scripts.length > 0,
    'content_scripts must be a non-empty array',
  );
  check(
    contentScript?.matches?.includes('https://www.linkedin.com/in/*') === true,
    'content_scripts[0].matches must include "https://www.linkedin.com/in/*"',
  );
  check(
    Array.isArray(contentScript?.js) && contentScript.js.length > 0,
    'content_scripts[0].js must be a non-empty array',
  );
  check(
    Array.isArray(contentScript?.css) && contentScript.css.length > 0,
    'content_scripts[0].css must be a non-empty array',
  );

  check(typeof manifest.action?.default_popup === 'string', 'action.default_popup must be a string');
  check(typeof manifest.options_page === 'string', 'options_page must be a string');

  // Every file the manifest references must exist, or Chrome fails to load it.
  const referencedFiles = [
    manifest.background?.service_worker,
    ...(contentScript?.js ?? []),
    ...(contentScript?.css ?? []),
    manifest.action?.default_popup,
    manifest.options_page,
  ].filter((file) => typeof file === 'string');

  for (const file of referencedFiles) {
    check(existsSync(resolve(repoRoot, file)), `referenced file does not exist: ${file}`);
  }
}

if (errors.length > 0) {
  console.error(`manifest check failed (${errors.length} problem${errors.length === 1 ? '' : 's'}):`);
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

console.log('manifest check passed: required keys present, all referenced files exist');
