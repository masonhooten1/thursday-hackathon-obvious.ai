// Pure profile-URL parsing — UI-free by design (spec §What we build): the pill
// task and the popup both consume this module as-is. No DOM, no chrome.* APIs.

// Profile URLs live on linkedin.com and its subdomains (www, country codes).
const LINKEDIN_HOST = /^([a-z0-9-]+\.)*linkedin\.com$/;
const HANDLE_IN_PATH = /^\/in\/([^/?#]+)/;

/**
 * Extract the decoded /in/<handle> segment from a LinkedIn profile URL.
 *
 * Returns null for anything that is not a profile URL — non-LinkedIn hosts,
 * non-/in/ paths, or unparseable input — so callers can treat null as "not a
 * LinkedIn profile URL" (spec popup state: Invalid URL).
 *
 * @param {unknown} url
 * @returns {string | null}
 */
export function parseProfileHandle(url) {
  try {
    const parsed = new URL(url);
    if (!LINKEDIN_HOST.test(parsed.hostname)) return null;
    const match = parsed.pathname.match(HANDLE_IN_PATH);
    return match ? decodeURIComponent(match[1]) : null;
  } catch {
    return null; // Unparseable input is "not a profile URL", not an error (V2).
  }
}
