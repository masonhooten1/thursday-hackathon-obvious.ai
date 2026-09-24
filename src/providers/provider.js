// The adapter contract every enrichment provider implements (spec §What we
// build): each adapter exports findEmailByLinkedInUrl(url, { apiKey, signal })
// and resolves to one normalized LookupResult — never throwing for a
// provider-side outcome, so the UI renders one distinct, actionable message
// per failure class (spec V5). The constructors below keep every adapter's
// result shapes identical.

/**
 * @typedef {'no_key' | 'rate_limited' | 'network' | 'provider'} LookupErrorCode
 */

/**
 * @typedef {Object} LookupFound
 * @property {'found'} status
 * @property {string} email
 * @property {number} [confidence]
 * @property {string} provider
 */

/**
 * @typedef {Object} LookupNotFound
 * @property {'not_found'} status
 * @property {string} provider
 */

/**
 * @typedef {Object} LookupError
 * @property {'error'} status
 * @property {LookupErrorCode} code
 * @property {string} message
 */

/** @typedef {LookupFound | LookupNotFound | LookupError} LookupResult */

/**
 * @param {string} email
 * @param {number | null | undefined} confidence - Omitted from the result when unknown.
 * @param {string} provider
 * @returns {LookupFound}
 */
export function lookupFound(email, confidence, provider) {
  const result = { status: 'found', email, provider };
  if (confidence !== null && confidence !== undefined) result.confidence = confidence;
  return result;
}

/**
 * @param {string} provider
 * @returns {LookupNotFound}
 */
export function lookupNotFound(provider) {
  return { status: 'not_found', provider };
}

/**
 * @param {LookupErrorCode} code
 * @param {string} message
 * @returns {LookupError}
 */
export function lookupError(code, message) {
  return { status: 'error', code, message };
}

/**
 * Callers validate URLs before dispatch (the pill only renders on profile
 * pages; the popup validates its input), so reaching an adapter with an
 * unparseable URL is defensive. The contract has no caller-error code —
 * 'provider' is its "lookup could not be completed" bucket — and returning
 * before the network call avoids spending a lookup credit on a request we
 * already know is wrong.
 *
 * @returns {LookupError}
 */
export function lookupInvalidUrl() {
  return lookupError('provider', 'That URL is not a LinkedIn profile URL.');
}
