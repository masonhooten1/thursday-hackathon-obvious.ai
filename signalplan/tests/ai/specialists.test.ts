import { describe, expect, it } from "vitest";
import type { ModelRole } from "@/lib/contracts";
import { MockModelAdapter, type MockHandler } from "@/lib/ai/mock-adapter";
import {
  applyReviewerDecisions,
  countPlanWords,
  draftWithReview,
  runPlanner,
  runPositioning,
  unresolvedClaimRefs,
  type SpecialistBundle,
} from "@/lib/ai/specialists";
import type { AccountPlanContent, ReviewerOutput } from "@/lib/ai/schemas";
import {
  makeEvidence,
  makePlanContent,
  OPPORTUNITY_ID_1,
  OPPORTUNITY_ID_2,
} from "./helpers/fixtures";

/**
 * Reviewer contract tests (check 4): every account-plan observation resolves
 * to an evidence record; unsupported claims are removed; the revise loop
 * reaches the writer exactly once; deterministic enforcement overrides the
 * model. The adapter is the labeled mock — no cloud credentials exist.
 */

const evidence = makeEvidence();

function makeBundle(
  handlers: Partial<Record<ModelRole, MockHandler>> = {},
): SpecialistBundle & { mock: MockModelAdapter } {
  const mock = new MockModelAdapter(handlers);
  return {
    ctx: {
      companyName: "Acme (synthetic fixture)",
      domain: "acme.example",
      offer: {
        headline: "Marketing consulting for HubSpot teams.",
        idealCustomerProfile: "B2B AI software companies.",
        differentiators: [],
        proofPoints: [],
        exclusions: [],
        callToAction: undefined,
      },
      hubspotEvidence: null,
    },
    evidence: [evidence],
    adapter: mock,
    mock,
  };
}

describe("specialist runners", () => {
  it("positioning output re-parses at the boundary and fills schema defaults", async () => {
    const { mock, ...bundle } = makeBundle({
      positioning: () => ({
        summary: "Demo-led analytics product for revenue teams.",
        likelyBuyer: "Head of Revenue Operations.",
        businessModel: "Self-serve SaaS with sales assist.",
        icpFit: { level: "partial", reason: "Product shape matches; stage unverified." },
      }),
    });
    const output = await runPositioning(bundle);
    expect(output.icpFit.level).toBe("partial");
    // Schema defaults applied by the runner's boundary re-parse:
    expect(output.journey).toEqual([]);
    expect(output.findings).toEqual([]);
    expect(mock.calls[0].role).toBe("positioning");
  });

  it("planner prompt embeds upstream analyst results", async () => {
    const { mock, ...bundle } = makeBundle({
      planner: () => ({
        workflow: {
          label: "proposed design",
          trigger: "Demo request submitted.",
          conditions: [],
          actions: ["Qualify account"],
          exitCriteria: [],
          prerequisites: [],
          owner: "Marketing ops (proposed)",
          measurement: "Meeting rate from demo requests.",
        },
        validationExperiment: "Shadow-run the routing for two weeks.",
        feasibility: { level: "partial", reason: "Depends on existing workflow support." },
      }),
    });
    const output = await runPlanner(
      bundle,
      { positioning: { summary: "Positioning fixture" }, funnel: {}, outbound: {} },
    );
    expect(mock.calls[0].role).toBe("planner");
    expect(mock.calls[0].system).toContain("Positioning fixture");
    expect(output.workflow.label).toBe("proposed design");
  });
});

describe("reviewer contract (check 4)", () => {
  it("removes opportunities the reviewer marks unsupported", () => {
    const base = makePlanContent([evidence.id]);
    const fabricatedOpportunity = {
      ...base.opportunities[0],
      id: "00000000-0000-4000-8000-0000000000aa",
    };
    const plan: AccountPlanContent = {
      ...base,
      opportunities: [base.opportunities[0], fabricatedOpportunity],
    };
    const review: ReviewerOutput = {
      verdict: "unsupported",
      claims: [
        {
          ref: `opportunity:${fabricatedOpportunity.id}`,
          status: "unsupported",
          reason: "The cited evidence does not support this claim.",
        },
      ],
      revisionNotes: "",
    };
    const decided = applyReviewerDecisions(plan, review, new Set([evidence.id]));
    expect(decided.plan?.opportunities.map((o) => o.id)).toEqual([OPPORTUNITY_ID_1]);
    expect(decided.removedRefs).toEqual([`opportunity:${fabricatedOpportunity.id}`]);
  });

  it("removes claims citing evidence that is not in the bundle even when the reviewer missed it", () => {
    const plan = makePlanContent([evidence.id]);
    const fabricatedEvidenceId = "00000000-0000-4000-8000-0000000000bb";
    plan.opportunities[1].evidenceIds = [fabricatedEvidenceId];
    const review: ReviewerOutput = { verdict: "supported", claims: [], revisionNotes: "" };
    // Refs name the OPPORTUNITY id, not the fabricated evidence id:
    expect(unresolvedClaimRefs(plan, new Set([evidence.id]))).toEqual([
      `opportunity:${OPPORTUNITY_ID_2}`,
    ]);
    const decided = applyReviewerDecisions(plan, review, new Set([evidence.id]));
    expect(decided.plan?.opportunities.map((o) => o.id)).toEqual([OPPORTUNITY_ID_1]);
  });

  it("returns null when every opportunity is stripped — never an empty shell", () => {
    const plan = makePlanContent(["00000000-0000-4000-8000-0000000000cc"]);
    const review: ReviewerOutput = { verdict: "unsupported", claims: [], revisionNotes: "" };
    const decided = applyReviewerDecisions(plan, review, new Set([evidence.id]));
    expect(decided.plan).toBeNull();
  });

  it("runs the revise loop back to the writer exactly once, then enforces", async () => {
    const revised = makePlanContent([evidence.id]);
    let writerCount = 0;
    let reviewerCount = 0;
    const { mock, ...bundle } = makeBundle({
      // Handler args are (call, globalCallIndex) — count per role instead:
      writer: () => (writerCount++ === 0 ? makePlanContent([evidence.id]) : revised),
      reviewer: () =>
        reviewerCount++ === 0
          ? { verdict: "revise", claims: [], revisionNotes: "Tighten the conversion assessment." }
          : { verdict: "supported", claims: [], revisionNotes: "" },
    });
    const outcome = await draftWithReview(
      bundle,
      { positioning: {}, funnel: {}, outbound: {}, planner: {} },
    );
    expect(mock.calls.filter((c) => c.role === "writer")).toHaveLength(2);
    expect(outcome.writerPasses).toBe(2);
    expect(outcome.verdicts).toEqual(["revise", "supported"]);
    // The reviewer's revision notes reached the writer's second system prompt:
    const secondWriterSystem = mock.calls.filter((c) => c.role === "writer")[1].system;
    expect(secondWriterSystem).toContain("REVISION REQUEST");
    expect(secondWriterSystem).toContain("Tighten the conversion assessment.");
    expect(outcome.plan).not.toBeNull();
  });

  it("surfaces needs_access claims as validation questions", async () => {
    const bundle = makeBundle({
      writer: () => makePlanContent([evidence.id]),
      reviewer: () => ({
        verdict: "needs_access",
        claims: [
          {
            ref: "assessment:measurement",
            status: "needs_access",
            reason: "Internal attribution setup is not visible publicly.",
          },
        ],
        revisionNotes: "",
      }),
    });
    const outcome = await draftWithReview(
      bundle,
      { positioning: {}, funnel: {}, outbound: {}, planner: {} },
    );
    expect(outcome.verdicts).toEqual(["needs_access"]);
    expect(outcome.needsAccess).toHaveLength(1);
    expect(outcome.needsAccess[0].ref).toBe("assessment:measurement");
    expect(outcome.plan).not.toBeNull();
  });

  it("spends the budget revision when the first draft exceeds the word cap", async () => {
    // Pad several fields toward their schema caps (~1100 words total) without
    // overflowing any cap — the mock validates through the real schema.
    const words2000 = "baseline ".repeat(220).trimEnd();
    const words1000 = "baseline ".repeat(110).trimEnd();
    const bloated = makePlanContent([evidence.id]);
    bloated.diagnosis.offerSummary = words2000;
    bloated.diagnosis.likelyBuyer = words1000;
    bloated.diagnosis.businessModel = words1000;
    bloated.sourceKey = words2000;
    bloated.opportunities[0].observation = words2000;
    bloated.opportunities[1].observation = words2000;
    expect(countPlanWords(bloated)).toBeGreaterThan(900);
    let writerCount = 0;
    const { mock, ...bundle } = makeBundle({
      writer: () => (writerCount++ === 0 ? bloated : makePlanContent([evidence.id])),
      reviewer: () => ({ verdict: "supported", claims: [], revisionNotes: "" }),
    });
    const outcome = await draftWithReview(
      bundle,
      { positioning: {}, funnel: {}, outbound: {}, planner: {} },
    );
    expect(outcome.writerPasses).toBe(2);
    const secondWriterSystem = mock.calls.filter((c) => c.role === "writer")[1].system;
    expect(secondWriterSystem).toContain("constrain it to");
  });
});
