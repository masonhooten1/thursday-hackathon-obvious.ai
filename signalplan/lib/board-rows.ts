import type { AccountPlan, Finding } from "@/lib/contracts";
import type { RunStatusPayload } from "@/lib/data-source";
import { scanVintage, type DataProvenance, type EvidenceVintage } from "@/lib/vintage";

/**
 * Board row assembly (brief §Interface item 2): companies, status, HubSpot
 * evidence, strongest opportunity, review status, score reasons, and scan
 * vintage. Pure so the live board and the fixture board render through the
 * same mapper and cannot drift.
 */

export interface BoardRow {
  company: RunStatusPayload["companies"][number];
  strongestOpportunity: string | null;
  /** Assessment categories in the plan — the board's "opportunity theme" filter values. */
  assessmentCategories: Finding["category"][];
  reviewStatus: AccountPlan["status"] | null;
  scanVintage: EvidenceVintage | null;
}

export interface BoardExtras {
  accountPlans?: Record<string, AccountPlan | null>;
  /** Evidence per company id, for scan-vintage computation (live mode passes it when it has a bundle). */
  evidenceByCompany?: Record<string, { limitations: string[]; capturedAt: string }[]>;
  now?: Date;
  provenance?: DataProvenance;
}

/**
 * Strongest opportunity and review status come from the company's account
 * plan when one exists (fixture mode supplies plans; live mode will too once
 * the intelligence module lands). Without a plan the cells render empty —
 * never filled with invented content.
 */
export function boardRows(payload: RunStatusPayload, extras: BoardExtras = {}): BoardRow[] {
  const now = extras.now ?? new Date();
  const sorted = [...payload.companies].sort((a, b) => {
    const at = a.score?.total ?? -1;
    const bt = b.score?.total ?? -1;
    if (bt !== at) return bt - at;
    return a.name.localeCompare(b.name);
  });
  return sorted.map((company) => {
    const plan = extras.accountPlans?.[company.id] ?? null;
    const evidence = extras.evidenceByCompany?.[company.id];
    const scan = evidence ? scanVintage(evidence, now) : null;
    return {
      company,
      strongestOpportunity: plan?.opportunities[0]?.title ?? null,
      assessmentCategories: plan ? plan.diagnosis.assessments.map((a) => a.category) : [],
      reviewStatus: plan?.status ?? null,
      // Fixture data is always labeled synthetic by the banner + chips; the
      // vintage columns below describe capture freshness, which applies to
      // live and fixture data alike.
      scanVintage: extras.provenance === "fixture" ? (scan ?? "fresh") : scan,
    };
  });
}
