import type { Evidence } from "@/lib/contracts";
import type { AccountPlanContent } from "@/lib/ai/schemas";

/**
 * The constrained two-page print template (brief §The two-page deliverable).
 * Fixed A4 pages, fixed type scale — writing is constrained upstream (the
 * writer's 700–900-word budget, enforced in specialists.ts), never shrunk to
 * fit an essay here. Page 1 is the company marketing diagnosis; page 2 is the
 * HubSpot proposal and seller outreach plan. Every dynamic string is escaped;
 * page text is untrusted data (spec check 7 applies to the print path too).
 */

export interface PlanTemplateInput {
  domain: string;
  plan: AccountPlanContent;
  /** Evidence bundle — rendered as the compact source key on page 2. */
  evidence: Evidence[];
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const EVIDENCE_LABELS = ["E1", "E2", "E3", "E4", "E5", "E6", "E7", "E8", "E9", "E10"];

function evidenceLabel(evidence: Evidence[], id: string): string | null {
  const index = evidence.findIndex((e) => e.id === id);
  return index >= 0 && index < EVIDENCE_LABELS.length ? EVIDENCE_LABELS[index] : null;
}

/** `[E1]` marker for a claim's citations, or nothing when uncited. */
function citeLabels(evidence: Evidence[], evidenceIds: string[]): string {
  const labels = evidenceIds
    .map((id) => evidenceLabel(evidence, id))
    .filter((l): l is string => l !== null)
    .map((l) => `[${l}]`);
  return labels.length > 0 ? ` <span class="cite">${labels.join(" ")}</span>` : "";
}

const CATEGORY_LABELS: Record<AccountPlanContent["diagnosis"]["assessments"][number]["category"], string> = {
  positioning: "Positioning",
  acquisition: "Acquisition",
  conversion: "Conversion",
  nurture: "Nurture",
  handoff: "Handoff",
  measurement: "Measurement",
};

function esc(value: string): string {
  return escapeHtml(value);
}

export function renderPlanHtml(input: PlanTemplateInput): string {
  const { domain, plan: p, evidence } = input;
  const page1 = `
  <section class="page">
    <header>
      <h1>${esc(p.diagnosis.company)}</h1>
      <p class="meta">${esc(domain)} · scan ${esc(p.diagnosis.scanDate)} · <span class="label">PROPOSED — draft for review</span></p>
      <p><strong>Offer:</strong> ${esc(p.diagnosis.offerSummary)}</p>
      <p><strong>Likely buyer:</strong> ${esc(p.diagnosis.likelyBuyer)} · <strong>Business model:</strong> ${esc(p.diagnosis.businessModel)}</p>
      ${p.diagnosis.uncertainty.length > 0 ? `<p class="uncertainty"><strong>Uncertainty:</strong> ${esc(p.diagnosis.uncertainty.join("; "))}</p>` : ""}
    </header>
    <h2>Observed public journey</h2>
    <ol class="journey">
      ${p.diagnosis.journey
        .map(
          (s) =>
            `<li><strong>${esc(s.step)}</strong> — ${esc(s.description)}${citeLabels(evidence, s.evidenceIds)}</li>`,
        )
        .join("\n      ")}
    </ol>
    <h2>Assessment</h2>
    <dl class="assessment">
      ${p.diagnosis.assessments
        .map(
          (a) =>
            `<div class="assessment-item"><dt>${esc(CATEGORY_LABELS[a.category] ?? a.category)}</dt><dd>${esc(a.summary)}${citeLabels(evidence, a.evidenceIds)}</dd></div>`,
        )
        .join("\n      ")}
    </dl>
    <h2>Top opportunities</h2>
    <ol class="opportunities">
      ${p.opportunities
        .map(
          (o) => `<li>
        <p class="op-title"><strong>${esc(o.title)}</strong> — priority ${o.priority}${citeLabels(evidence, o.evidenceIds)}</p>
        <p><em>Observation:</em> ${esc(o.observation)}</p>
        <p><em>Hypothesis (proposed):</em> ${esc(o.hypothesis)}</p>
        <p><em>Proposed experiment:</em> ${esc(o.proposedExperiment)}</p>
        ${o.validationNeeded.length > 0 ? `<p class="validate"><em>Validate:</em> ${esc(o.validationNeeded.join("; "))}</p>` : ""}
      </li>`,
        )
        .join("\n      ")}
    </ol>
    <h2>Proposed 30-day roadmap</h2>
    <ol class="roadmap">
      ${p.roadmap30
        .map(
          (r) =>
            `<li><strong>${esc(r.owner)}</strong> — ${esc(r.experiment)} · metric: ${esc(r.metric)}${r.baseline ? ` · baseline: ${esc(r.baseline)}` : " · baseline required before targets"}</li>`,
        )
        .join("\n      ")}
    </ol>
  </section>`;

  const w = p.hubspotProposal;
  const page2 = `
  <section class="page">
    <h2>Proposed HubSpot workflow <span class="label">${esc(w.label)}</span></h2>
    <p><strong>Trigger:</strong> ${esc(w.trigger)}</p>
    ${w.conditions.length > 0 ? `<p><strong>Conditions:</strong> ${esc(w.conditions.join("; "))}</p>` : ""}
    <p><strong>Actions:</strong></p>
    <ul>${w.actions.map((a) => `<li>${esc(a)}</li>`).join("")}</ul>
    ${w.exitCriteria.length > 0 ? `<p><strong>Exit criteria:</strong> ${esc(w.exitCriteria.join("; "))}</p>` : ""}
    ${w.prerequisites.length > 0 ? `<p><strong>Prerequisites to validate:</strong> ${esc(w.prerequisites.join("; "))}</p>` : ""}
    <p><strong>Proposed owner:</strong> ${esc(w.owner)} · <strong>Measurement:</strong> ${esc(w.measurement)}</p>
    <h2>Seller outreach plan</h2>
    <p><strong>Buyer role to approach:</strong> ${esc(p.outreach.buyerRole)}</p>
    <p><strong>Discovery question:</strong> ${esc(p.outreach.discoveryQuestion)}</p>
    <p><strong>Offer:</strong> ${esc(p.outreach.offer)}</p>
    <ol class="sequence">
      ${p.outreach.sequence
        .map((t) => `<li><strong>Touch ${t.touch} — ${esc(t.subject)}</strong><br/>${esc(t.body)}</li>`)
        .join("\n      ")}
    </ol>
    ${p.outreach.successMeasures.length > 0 ? `<p><strong>Success measures:</strong></p><ul>${p.outreach.successMeasures.map((m) => `<li>${esc(m)}</li>`).join("")}</ul>` : ""}
    <h2>Source key</h2>
    <p class="source-key">${esc(p.sourceKey)}</p>
    <ul class="sources">
      ${evidence
        .map(
          (e, i) =>
            `<li>[${EVIDENCE_LABELS[i] ?? `E${i + 1}`}] ${esc(e.url)} — ${esc(e.method)} at ${esc(e.capturedAt)}${e.limitations.length > 0 ? ` · limitations: ${esc(e.limitations.join(", "))}` : ""}</li>`,
        )
        .join("\n      ")}
    </ul>
    <h2>Unknowns to validate in discovery</h2>
    <ul class="unknowns">${p.unknowns.map((u) => `<li>${esc(u)}</li>`).join("")}</ul>
  </section>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>${esc(p.diagnosis.company)} — SignalPlan account plan</title>
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: "Helvetica Neue", Arial, sans-serif; color: #111; }
  .page {
    width: 210mm; height: 297mm; overflow: hidden;
    padding: 14mm 16mm; page-break-after: always;
    font-size: 9.5pt; line-height: 1.35;
  }
  .page:last-child { page-break-after: auto; }
  h1 { font-size: 16pt; margin: 0 0 2mm; overflow-wrap: anywhere; }
  h2 { font-size: 11pt; margin: 4mm 0 1.5mm; border-bottom: 0.3pt solid #999; padding-bottom: 0.8mm; }
  p { margin: 0 0 1.6mm; overflow-wrap: anywhere; }
  li { margin-bottom: 0.8mm; overflow-wrap: anywhere; }
  .meta { color: #444; font-size: 8pt; }
  .label { background: #f0e6c8; padding: 0 1.5mm; border-radius: 1mm; font-size: 7.5pt; }
  .uncertainty { color: #555; font-size: 8pt; }
  .validate { color: #555; font-size: 8pt; }
  ol, ul { margin: 0 0 1.6mm; padding-left: 5mm; }
  .cite { color: #555; font-size: 7.5pt; white-space: nowrap; }
  .assessment { display: grid; grid-template-columns: 1fr 1fr; gap: 1mm 4mm; margin: 0; }
  .assessment-item dt { font-weight: bold; }
  .assessment-item dd { margin: 0 0 1mm; }
  .op-title { margin-bottom: 0.4mm; }
  .source-key { color: #555; font-size: 8pt; }
</style>
</head>
<body>${page1}${page2}</body>
</html>`;
}
