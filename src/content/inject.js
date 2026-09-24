// Content-script bootstrap (classic script). MV3 injects content_scripts as
// classic scripts — module syntax there fails to parse, so the ES-module pill
// loads via dynamic import of its web-accessible URL instead (spec V6 caught
// this live: the pill never mounted under direct injection).
import(chrome.runtime.getURL('src/content/pill.js')).catch(() => {
  // The pill is an enhancement: a failed mount must never break the page.
  // No URL or page material in the warning — nothing identifying is logged.
  console.warn('[lte] pill failed to load');
});
