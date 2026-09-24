import { describe, expect, it } from "vitest";
import {
  RANKING_WEIGHTS,
  evidenceConfidence,
  rankCompany,
  rankByScore,
} from "@/lib/ai/ranking";
import { makeEvidence } from "./helpers/fixtures";

const J = (level: "strong" | "partial" | "weak" | "unknown", reason: string) => ({ level, reason });

describe("rankCompany (brief §Ranking)", () => {
  it("scores a strong candidate across all four components with reasons", () => {
    const ranked = rankCompany({
      companyId: "c1",
      evidence: [makeEvidence(), makeEvidence(), makeEvidence()],
      hubspotStatus: { publicIntegration: "observed" },
      icpFit: J("strong", "Demo-led AI product matching the ICP."),
      offerAlignment: J("strong", "Uses HubSpot forms; enrichment pitch lands."),
      feasibility: J("strong", "Public demo form suggests simple routing."),
    });
    expect(ranked.components.map((c) => c.maxPoints)).toEqual([
      RANKING_WEIGHTS.icp_fit,
      RANKING_WEIGHTS.evidence_quality,
      RANKING_WEIGHTS.opportunity_relevance,
      RANKING_WEIGHTS.feasibility,
    ]);
    for (const component of ranked.components) {
      expect(component.reason.length).toBeGreaterThan(0);
    }
    expect(ranked.score).toBe(30 + 25 + 25 + 20);
  });

  it("gives unknown judgements zero points and says so — no invented points", () => {
    const ranked = rankCompany({
      companyId: "c2",
      evidence: [makeEvidence(), makeEvidence(), makeEvidence()],
      hubspotStatus: null,
      icpFit: J("unknown", "Company size and stage not verifiable from public pages."),
      offerAlignment: J("weak", "No visible HubSpot surface to attach to."),
      feasibility: J("unknown", "No signals about internal tooling."),
    });
    const icp = ranked.components.find((c) => c.component === "icp_fit");
    const feasibility = ranked.components.find((c) => c.component === "feasibility");
    expect(icp?.points).toBe(0);
    expect(icp?.reason).toContain("unknown is not scored");
    expect(feasibility?.points).toBe(0);
    expect(ranked.score).toBe(25 + 5); // evidence 25 (3 records, no penalties) + relevance 5
  });

  it("caps evidence quality when the HubSpot scan is incomplete", () => {
    const component = rankCompany({
      companyId: "c3",
      evidence: [makeEvidence(), makeEvidence(), makeEvidence()],
      hubspotStatus: { publicIntegration: "scan_incomplete" },
      icpFit: J("strong", "Fits."),
      offerAlignment: J("strong", "Fits."),
      feasibility: J("strong", "Fits."),
    }).components.find((c) => c.component === "evidence_quality");
    expect(component?.points).toBeLessThanOrEqual(15);
    expect(component?.reason).toContain("scan incomplete");
  });

  it("keeps evidence confidence separate from the priority score", () => {
    // Identical model judgements, different evidence bundles:
    const strongBundle = [
      makeEvidence(),
      makeEvidence(),
      { ...makeEvidence(), method: "rendered_dom" as const },
    ];
    const thinBundle = [makeEvidence()];
    const strong = rankCompany({
      companyId: "strong",
      evidence: strongBundle,
      hubspotStatus: { publicIntegration: "observed" },
      icpFit: J("weak", "Mismatch."),
      offerAlignment: J("weak", "Mismatch."),
      feasibility: J("weak", "Hard."),
    });
    const thin = rankCompany({
      companyId: "thin",
      evidence: thinBundle,
      hubspotStatus: { publicIntegration: "observed" },
      icpFit: J("weak", "Mismatch."),
      offerAlignment: J("weak", "Mismatch."),
      feasibility: J("weak", "Hard."),
    });
    // Scores differ only through the evidence-quality component:
    expect(strong.score).toBeGreaterThan(thin.score);
    expect(strong.evidenceConfidence).toBe("high");
    expect(thin.evidenceConfidence).toBe("low");
    // And the confidence never enters the score: same components otherwise.
    expect(strong.components.find((c) => c.component === "icp_fit")?.points).toBe(
      thin.components.find((c) => c.component === "icp_fit")?.points,
    );
  });

  it("orders companies highest-first and is stable for ties", () => {
    const ranked = [
      { companyId: "low", score: 10, components: [], evidenceConfidence: "medium" as const },
      { companyId: "high", score: 80, components: [], evidenceConfidence: "high" as const },
      { companyId: "tie-a", score: 40, components: [], evidenceConfidence: "low" as const },
      { companyId: "tie-b", score: 40, components: [], evidenceConfidence: "low" as const },
    ];
    expect(rankByScore(ranked).map((r) => r.companyId)).toEqual([
      "high",
      "tie-a",
      "tie-b",
      "low",
    ]);
  });

  it("reports blocked captures in the evidence-quality reason", () => {
    const ranked = rankCompany({
      companyId: "c4",
      evidence: [
        makeEvidence(),
        { ...makeEvidence(), limitations: ["blocked"] },
        { ...makeEvidence(), method: "network" },
      ],
      hubspotStatus: null,
      icpFit: J("partial", "Partial."),
      offerAlignment: J("partial", "Partial."),
      feasibility: J("partial", "Partial."),
    });
    const evidenceQuality = ranked.components.find((c) => c.component === "evidence_quality");
    expect(evidenceQuality?.reason).toContain("blocked capture");
  });
});

describe("evidenceConfidence", () => {
  it("is high only with depth, coverage, and no blocking", () => {
    const rendered = { ...makeEvidence(), method: "rendered_dom" as const };
    expect(evidenceConfidence([makeEvidence(), makeEvidence(), rendered], false)).toBe("high");
    expect(evidenceConfidence([makeEvidence(), makeEvidence(), rendered], true)).not.toBe("high");
    expect(evidenceConfidence([makeEvidence()], false)).toBe("low");
    expect(
      evidenceConfidence(
        [{ ...makeEvidence(), limitations: ["blocked"] }],
        false,
      ),
    ).toBe("low");
    expect(evidenceConfidence([makeEvidence(), makeEvidence()], false)).toBe("medium");
  });
});
