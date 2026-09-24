import type { Evidence } from "@/lib/contracts";
import type { LevelJudgement } from "./schemas";

/**
 * The transparent ranking heuristic (brief §Ranking): ICP fit 30, evidence
 * quality 25, opportunity relevance 25, feasibility 20 — every component
 * carries a short reason. Evidence confidence is computed separately and
 * never folds into the priority score; unknown company size or CRM tier
 * stays unknown rather than receiving invented points. A score is a priority
 * ordering aid, not a probability of purchase.
 */

export const RANKING_WEIGHTS = {
  icp_fit: 30,
  evidence_quality: 25,
  opportunity_relevance: 25,
  feasibility: 20,
} as const;

export type RankingComponent = keyof typeof RANKING_WEIGHTS;

export interface RankedComponent {
  component: RankingComponent;
  points: number;
  maxPoints: number;
  reason: string;
}

export interface RankedCompany {
  companyId: string;
  /** Sum of component points — a priority heuristic, not a probability. */
  score: number;
  components: RankedComponent[];
  /** Kept separate from `score` — displayed alongside it, never folded in. */
  evidenceConfidence: "high" | "medium" | "low";
}

/** Judgement level → points for a weighted component; unknown never scores. */
const LEVEL_POINTS: Record<
  Exclude<RankingComponent, "evidence_quality">,
  Record<LevelJudgement["level"], number>
> = {
  icp_fit: { strong: 30, partial: 18, weak: 6, unknown: 0 },
  opportunity_relevance: { strong: 25, partial: 15, weak: 5, unknown: 0 },
  feasibility: { strong: 20, partial: 12, weak: 4, unknown: 0 },
};

function levelComponent(
  component: Exclude<RankingComponent, "evidence_quality">,
  judgement: LevelJudgement,
): RankedComponent {
  const points = LEVEL_POINTS[component][judgement.level];
  return {
    component,
    points,
    maxPoints: RANKING_WEIGHTS[component],
    reason:
      judgement.level === "unknown"
        ? `${judgement.reason} — unknown is not scored (no invented points).`
        : judgement.reason,
  };
}

/**
 * Evidence quality from bundle composition only — deterministic, no model
 * judgement involved. Blocked captures and incomplete scans are penalized
 * rather than hidden; a thin bundle caps low without inventing coverage.
 */
export function evidenceQualityComponent(
  evidence: Evidence[],
  hubspotScanIncomplete: boolean,
): RankedComponent {
  const max = RANKING_WEIGHTS.evidence_quality;
  const reasons: string[] = [];
  let points: number = max;

  if (evidence.length < 3) {
    points = Math.min(points, 10);
    reasons.push(
      `only ${evidence.length} evidence record${evidence.length === 1 ? "" : "s"} captured (thin bundle caps at 10)`,
    );
  }
  const blocked = evidence.filter((e) => e.limitations.includes("blocked")).length;
  if (blocked > 0) {
    points -= 4 * blocked;
    reasons.push(`${blocked} blocked capture${blocked === 1 ? "" : "s"} (−4 each)`);
  }
  const cached = evidence.filter((e) => e.limitations.includes("cached")).length;
  if (cached > 0 && cached === evidence.length) {
    points -= 4;
    reasons.push("all captures cached (−4)");
  }
  const rendered = evidence.some((e) => e.method === "rendered_dom" || e.method === "network");
  if (rendered) {
    reasons.push("includes rendered-DOM or network evidence");
  }
  if (hubspotScanIncomplete) {
    points = Math.min(points, 15);
    reasons.push("HubSpot scan incomplete caps at 15 — absence of evidence is not negative evidence");
  }
  points = Math.max(0, Math.min(max, points));
  if (reasons.length === 0) {
    reasons.push(`${evidence.length} captures across first-party pages`);
  }
  return { component: "evidence_quality", points, maxPoints: max, reason: reasons.join("; ") };
}

/** Evidence confidence — deliberately separate from the priority score. */
export function evidenceConfidence(
  evidence: Evidence[],
  hubspotScanIncomplete: boolean,
): RankedCompany["evidenceConfidence"] {
  const blocked = evidence.filter((e) => e.limitations.includes("blocked")).length;
  const hasDeepCapture = evidence.some((e) => e.method === "rendered_dom" || e.method === "network");
  if (evidence.length >= 3 && blocked === 0 && hasDeepCapture && !hubspotScanIncomplete) {
    return "high";
  }
  if (evidence.length < 2 || blocked === evidence.length) {
    return "low";
  }
  return "medium";
}

export interface RankCompanyInput {
  companyId: string;
  evidence: Evidence[];
  /** Public integration status — `scan_incomplete` caps evidence quality. */
  hubspotStatus: {
    publicIntegration: "observed" | "probable" | "not_observed" | "scan_incomplete";
  } | null;
  icpFit: LevelJudgement;
  offerAlignment: LevelJudgement;
  feasibility: LevelJudgement;
}

export function rankCompany(input: RankCompanyInput): RankedCompany {
  const hubspotScanIncomplete = input.hubspotStatus?.publicIntegration === "scan_incomplete";
  const components: RankedComponent[] = [
    levelComponent("icp_fit", input.icpFit),
    evidenceQualityComponent(input.evidence, hubspotScanIncomplete),
    levelComponent("opportunity_relevance", input.offerAlignment),
    levelComponent("feasibility", input.feasibility),
  ];
  return {
    companyId: input.companyId,
    score: components.reduce((sum, c) => sum + c.points, 0),
    components,
    evidenceConfidence: evidenceConfidence(input.evidence, hubspotScanIncomplete),
  };
}

/** Highest score first; stable for ties so the board doesn't shuffle. */
export function rankByScore(companies: RankedCompany[]): RankedCompany[] {
  return [...companies].sort((a, b) => b.score - a.score);
}
