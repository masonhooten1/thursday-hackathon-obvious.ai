/**
 * Origin-city copy variants for the market landing pages (spec
 * art_XasJ5Kw8: "copy that varies by origin-city signal"). The signal is
 * the ad's utm_source; unknown or absent signals fall back to neutral
 * market copy. Copy stays honest — no invented drive times.
 */

const ORIGIN_LABELS: Record<string, string> = {
  dallas: "Dallas",
  sacramento: "Sacramento",
  "san-francisco": "San Francisco",
};

export function originCopy(marketName: string, utmSource?: string): string {
  const origin = utmSource ? ORIGIN_LABELS[utmSource.toLowerCase()] : undefined;
  if (origin) {
    return `Popular with ${origin} travelers — ${marketName} stays with open dates, nearest to the market center first.`;
  }
  return `${marketName} stays with open dates, nearest to the market center first.`;
}
