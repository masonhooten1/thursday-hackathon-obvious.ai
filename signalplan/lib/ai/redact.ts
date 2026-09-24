/**
 * Secret redaction for every string that could leave the process (spec
 * acceptance check 10: keys never appear in logs, error messages, exports, or
 * model context). Pure functions — no I/O, no server boundary, so both the
 * adapter and the tests can rely on them without setup.
 */

/** Matches `Bearer <token>` / `Basic <token>` values in arbitrary text. */
const CREDENTIAL_HEADER_PATTERN = /\b(bearer|basic|token)\s+[A-Za-z0-9._~+/=-]{8,}/gi;

/**
 * Replace every occurrence of each secret with `[redacted]`, plus any
 * credential-header value that slipped into the text. Split-and-join is used
 * instead of a regex built from the secret so regex metacharacters in a key
 * cannot break (or widen) the match.
 */
export function redactSecrets(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const secret of secrets) {
    if (secret.length >= 4) {
      out = out.split(secret).join("[redacted]");
    }
  }
  return out.replace(CREDENTIAL_HEADER_PATTERN, (_match, scheme: string) => `${scheme} [redacted]`);
}

/** True when none of the secrets appear in the text — used in assertions. */
export function containsNoSecrets(text: string, secrets: readonly string[]): boolean {
  return secrets.every((secret) => secret.length < 4 || !text.includes(secret));
}

/** Bound any response-derived text before it is embedded in an error. */
export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}… [truncated ${text.length - max} chars]`;
}
