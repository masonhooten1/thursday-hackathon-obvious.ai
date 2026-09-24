import { dedupeDomains, parsePublicDomain } from "@/lib/contracts";

/**
 * Client-side intake parsing for campaign setup (brief §Interface item 1).
 * Paste or CSV arrives as free text; every candidate is validated through the
 * shared parsePublicDomain so the operator sees the same rejection the server
 * will apply. The API re-validates authoritatively — this layer only shapes
 * feedback.
 */

export interface IntakeItem {
  raw: string;
  domain?: string;
  error?: string;
}

export interface IntakeResult {
  items: IntakeItem[];
  validDomains: string[];
}

function toResult(items: IntakeItem[]): IntakeResult {
  const validDomains = dedupeDomains(
    items.flatMap((i) => (i.domain ? [i.domain] : [])),
  );
  return { items, validDomains };
}

function parseCell(raw: string): IntakeItem {
  const result = parsePublicDomain(raw);
  return result.ok ? { raw, domain: result.domain } : { raw, error: result.message };
}

/** Paste intake: newline, comma, or semicolon separated domain candidates. */
export function parseIntakeText(text: string): IntakeResult {
  const cells = text
    .split(/[\n;,]/)
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
  return toResult(cells.map(parseCell));
}

/**
 * CSV intake: for each non-empty row, the first cell that parses as a public
 * domain wins; rows with none become errors. Deliberately simple — domain
 * seed lists are one column in practice, and the server re-validates
 * everything it receives.
 */
export function parseIntakeCsv(text: string): IntakeResult {
  const items: IntakeItem[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cells = line.split(",").map((c) => c.trim());
    const hit = cells.map(parseCell).find((i) => i.domain);
    items.push(hit ?? { raw: line.trim(), error: "No cell in this row is a valid public domain." });
  }
  return toResult(items);
}
