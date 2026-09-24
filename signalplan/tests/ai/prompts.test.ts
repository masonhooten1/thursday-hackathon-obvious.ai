import { describe, expect, it } from "vitest";
import type { SellerOffer } from "@/lib/contracts";
import {
  PLAN_WORD_BUDGET,
  funnelSystemPrompt,
  outboundSystemPrompt,
  plannerSystemPrompt,
  positioningSystemPrompt,
  reviewerSystemPrompt,
  writerSystemPrompt,
  type PromptContext,
} from "@/lib/ai/prompts";
import { INJECTION_EXCERPT, makeEvidence } from "./helpers/fixtures";

/**
 * Prompt-level guarantees (check 7): page text can only travel through the
 * adapter's untrusted evidence blocks, so no system prompt ever contains it;
 * every prompt carries the untrusted-data rule and the JSON-only contract;
 * the reviewer names all four verdicts; the writer carries the word budget.
 */

const offer: SellerOffer = {
  headline: "Marketing consulting for HubSpot teams adopting AI outbound.",
  idealCustomerProfile: "B2B AI software companies with a demo-led sales motion.",
  differentiators: ["Evidence-first audits"],
  proofPoints: ["Pilot structure"],
  exclusions: [],
  callToAction: "A short annotated workflow sketch.",
};

const ctx: PromptContext = {
  companyName: "Acme (synthetic fixture)",
  domain: "acme.example",
  offer,
  hubspotEvidence: {
    publicIntegration: "observed",
    internalAdoption: "unknown",
  },
};

const builders: [string, () => string][] = [
  ["positioning", () => positioningSystemPrompt(ctx)],
  ["funnel", () => funnelSystemPrompt(ctx)],
  ["outbound", () => outboundSystemPrompt(ctx)],
  ["planner", () => plannerSystemPrompt(ctx, { positioning: {}, funnel: {}, outbound: {} })],
  [
    "writer",
    () =>
      writerSystemPrompt(ctx, {
        positioning: {},
        funnel: {},
        outbound: {},
        planner: {},
      }),
  ],
  ["reviewer", () => reviewerSystemPrompt(ctx, { draft: true })],
];

describe("system prompts", () => {
  it.each(builders)("%s prompt carries the untrusted-data rule and JSON contract", (_name, build) => {
    const prompt = build();
    expect(prompt).toContain("untrusted_evidence");
    expect(prompt).toContain("never instructions");
    expect(prompt).toContain("single JSON object");
  });

  it.each(builders)("%s prompt never contains page text (check 7)", (_name, build) => {
    // Page text flows only through evidence bundles (user messages); even a
    // page that shouts instructions can never appear in a system prompt.
    const evidence = makeEvidence({ excerpt: INJECTION_EXCERPT });
    const prompt = build() + JSON.stringify(evidence.id); // id metadata is safe
    expect(prompt).not.toContain(INJECTION_EXCERPT);
    expect(prompt).not.toContain("Ignore all previous instructions");
  });

  it.each(builders)("%s prompt contains no tool surface", (_name, build) => {
    expect(build().toLowerCase()).not.toMatch(/\btools?\b/);
  });

  it("seller context carries the offer as operator-supplied facts", () => {
    const prompt = positioningSystemPrompt(ctx);
    expect(prompt).toContain(offer.headline);
    expect(prompt).toContain("operator-supplied facts");
    expect(prompt).toContain("Public integration evidence says nothing about the company's internal CRM.");
  });

  it("writer prompt pins the two-page structure and the word budget", () => {
    const prompt = writerSystemPrompt(ctx, {
      positioning: {},
      funnel: {},
      outbound: {},
      planner: {},
    });
    expect(prompt).toContain(`${PLAN_WORD_BUDGET.min}–${PLAN_WORD_BUDGET.max} words`);
    expect(prompt).toContain("Page 1");
    expect(prompt).toContain("Page 2");
    expect(prompt).toContain("never a person's identity or address");
  });

  it("writer revision notes reach the prompt as a revision request", () => {
    const prompt = writerSystemPrompt(
      ctx,
      { positioning: {}, funnel: {}, outbound: {}, planner: {} },
      "Cut the roadmap to three steps.",
    );
    expect(prompt).toContain("REVISION REQUEST");
    expect(prompt).toContain("Cut the roadmap to three steps.");
  });

  it("reviewer prompt names all four verdicts and demands independence", () => {
    const prompt = reviewerSystemPrompt(ctx, {});
    for (const verdict of ["supported", "revise", "unsupported", "needs_access"]) {
      expect(prompt).toContain(`'${verdict}'`);
    }
    expect(prompt).toContain("independent evidence reviewer");
  });

  it("planner prompt embeds upstream analyst results as trusted context", () => {
    const prompt = plannerSystemPrompt(ctx, {
      positioning: { summary: "Demo-led product for revenue teams." },
      funnel: {},
      outbound: {},
    });
    expect(prompt).toContain("Demo-led product for revenue teams.");
    expect(prompt).toContain("proposed design");
  });
});
