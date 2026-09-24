import { describe, expect, it } from "vitest";
import { renderPlanHtml } from "@/reports/template";
import { printHtmlToPdf } from "@/workers/reports/print";
import { printExportCore } from "@/trigger/print-export";
import { makeEvidence, makePlanContent } from "../ai/helpers/fixtures";

/**
 * Spec check 6: long company names and long source URLs still produce
 * exactly two readable PDF pages. Rendered with real headless chromium —
 * no cloud credentials involved.
 */

const evidence = makeEvidence();

function countPdfPages(pdf: Uint8Array): number {
  const raw = Buffer.from(pdf).toString("latin1");
  expect(raw.startsWith("%PDF")).toBe(true);
  // Match `/Type /Page` but not `/Type /Pages`:
  return (raw.match(/\/Type\s*\/Page(?![s])/g) ?? []).length;
}

describe("printHtmlToPdf — two-page guarantee (check 6)", () => {
  it("renders a typical plan to exactly two A4 pages", async () => {
    const html = renderPlanHtml({
      domain: "acme.example",
      plan: makePlanContent([evidence.id]),
      evidence: [evidence],
    });
    const pdf = await printHtmlToPdf(html);
    expect(countPdfPages(pdf)).toBe(2);
  }, 60_000);

  it("renders adversarial-length content to exactly two A4 pages", async () => {
    // Contract caps everywhere: 300-char names, 2000-char texts, 3000-char
    // email bodies, a 10-record source key with max-length URLs.
    const longName = "A".repeat(300);
    const longUrl = `https://acme.example/${"p".repeat(180)}/very/long/path?q=${"x".repeat(180)}`;
    const adversarialEvidence = Array.from({ length: 10 }, (_, i) => ({
      ...evidence,
      id: `${String(i + 1).padStart(2, "0")}000000-0000-4000-8000-0000000000ff`,
      url: `${longUrl}&record=${i}`,
      excerpt: `Excerpt ${i}: ${"word ".repeat(90)}`,
    }));
    const plan = makePlanContent([adversarialEvidence[0].id]);
    plan.diagnosis.company = longName;
    plan.diagnosis.offerSummary = `Offer summary. ${"conversion ".repeat(180)}`;
    plan.diagnosis.likelyBuyer = `Buyer. ${"operations ".repeat(90)}`;
    plan.diagnosis.businessModel = `Model. ${"subscription ".repeat(70)}`;
    plan.diagnosis.uncertainty = Array.from(
      { length: 10 },
      (_, i) => `Uncertainty ${i + 1}: ${"unverified ".repeat(60)}`,
    );
    plan.diagnosis.journey = Array.from({ length: 8 }, (_, i) => ({
      step: `Step ${i + 1}: ${"action ".repeat(30)}`,
      description: `Do the thing ${i + 1}: ${"carefully ".repeat(100)}`,
      evidenceIds: [adversarialEvidence[i % adversarialEvidence.length].id],
    }));
    plan.diagnosis.assessments = (
      ["positioning", "acquisition", "conversion", "nurture", "handoff", "measurement"] as const
    ).map((category, i) => ({
      category,
      summary: `Assessment ${i + 1}: ${"observed ".repeat(180)}`,
      evidenceIds: [adversarialEvidence[i % adversarialEvidence.length].id],
    }));
    plan.opportunities = plan.opportunities.map((o, i) => ({
      ...o,
      title: `Opportunity ${i + 1}: ${"theme ".repeat(40)}`,
      observation: `Observation ${i + 1}: ${"observed ".repeat(180)}`,
      hypothesis: `Hypothesis ${i + 1}: ${"proposed ".repeat(180)}`,
      proposedExperiment: `Experiment ${i + 1}: ${"test ".repeat(180)}`,
    }));
    plan.roadmap30 = plan.roadmap30.map((r, i) => ({
      ...r,
      experiment: `Experiment ${i + 1}: ${"carefully ".repeat(100)}`,
      metric: `Metric ${i + 1}: ${"baseline ".repeat(30)}`,
    }));
    plan.hubspotProposal.trigger = `Trigger: ${"condition ".repeat(90)}`;
    plan.outreach.sequence = plan.outreach.sequence.map((t, i) => ({
      ...t,
      subject: `Subject ${i + 1}: ${"words ".repeat(40)}`,
      body: `Body ${i + 1}: ${"copy ".repeat(300)}`,
    }));
    plan.unknowns = Array.from(
      { length: 10 },
      (_, i) => `Unknown ${i + 1}: ${"validate ".repeat(60)}`,
    );

    const html = renderPlanHtml({
      domain: "acme.example",
      plan,
      evidence: adversarialEvidence,
    });
    const pdf = await printHtmlToPdf(html);
    expect(countPdfPages(pdf)).toBe(2);
  }, 60_000);
});

describe("printExportCore", () => {
  it("passes template HTML to the print function and reports the byte length", async () => {
    let received = "";
    const print = async (html: string) => {
      received = html;
      return new Uint8Array([37, 80, 68, 70]); // %PDF
    };
    const result = await printExportCore({ exportId: "exp_1", html: "<html>plan</html>" }, print);
    expect(received).toBe("<html>plan</html>");
    expect(result).toEqual({ exportId: "exp_1", byteLength: 4 });
  });
});
