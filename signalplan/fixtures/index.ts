import {
  accountPlanSchema,
  campaignSchema,
  companySchema,
  evidenceSchema,
  findingSchema,
  pageCaptureSchema,
  runSchema,
  technologySignalSchema,
  type AccountPlan,
  type Campaign,
  type Company,
  type CompanyScore,
  type Evidence,
  type Finding,
  type PageCapture,
  type Run,
  type TechnologySignal,
} from "@/lib/contracts";
import type { CompanyAuditBundle } from "@/lib/repositories/types";

/**
 * Labeled synthetic fixture data (spec §fixtures): the interface module
 * renders from these so every UI state is demonstrable before the collection
 * and intelligence modules land. Fixtures are demonstrations, never results —
 * every surface that shows them carries a visible fixture label, and nothing
 * here is written to the database.
 *
 * Company set: three adapt the brief's real research seeds (Compa, Crescendo,
 * Hex) as detection-fixture narratives; the rest are fictional and cover the
 * remaining lifecycle states (failed, blocked, cancelled, and the in-flight
 * stages the fixture ticker advances).
 *
 * Every export below is parsed against its frozen contract at module load —
 * fixture drift fails loudly in tests and dev instead of rendering nonsense.
 */

function hoursAgo(h: number): string {
  return new Date(Date.now() - h * 3_600_000).toISOString();
}

function daysAgo(d: number): string {
  return hoursAgo(d * 24);
}

const WS = "9f1c2a34-7b8e-4c0d-a1b2-000000000001";
const CAMPAIGN = "9f1c2a34-7b8e-4c0d-a1b2-000000000002";
const RUN = "9f1c2a34-7b8e-4c0d-a1b2-000000000003";

export const FIXTURE_WORKSPACE_ID = WS;
export const FIXTURE_CAMPAIGN_ID = CAMPAIGN;
export const FIXTURE_RUN_ID = RUN;

function cid(suffix: string): string {
  return `9f1c2a34-7b8e-4c0d-a1b2-0000000000${suffix}`;
}

export const FIXTURE_COMPANY_IDS = {
  compa: cid("a1"),
  crescendo: cid("a2"),
  hex: cid("a3"),
  northwind: cid("a4"),
  lumina: cid("a5"),
  parallax: cid("a6"),
  meridian: cid("a7"),
  cobalt: cid("a8"),
  solstice: cid("a9"),
  veldt: cid("aa"),
} as const;

export const fixtureSellerOffer = {
  headline: "Marketing consulting for HubSpot-using companies adopting AI outbound prospecting and lead enrichment",
  idealCustomerProfile:
    "B2B AI software companies with a demo-led sales motion and a public HubSpot integration",
  differentiators: [
    "Evidence-cited audits — every observation links to a captured page",
    "HubSpot-native workflow design, validated before implementation",
  ],
  proofPoints: [
    "Scoped funnel/automation audits delivered in 30 days",
    "Pilot enrichment batches with provenance on every field",
  ],
  exclusions: ["Companies without a demo-led sales motion", "Recruiting and agencies"],
  callToAction: "Would a short annotated workflow sketch be useful?",
};

function score(parts: {
  icpFit: number | null;
  evidenceQuality: number | null;
  opportunityRelevance: number | null;
  feasibility: number | null;
  reasons: { component: "icp_fit" | "evidence_quality" | "opportunity_relevance" | "proposal_feasibility"; reason: string }[];
}): CompanyScore {
  const total =
    parts.icpFit === null ||
    parts.evidenceQuality === null ||
    parts.opportunityRelevance === null ||
    parts.feasibility === null
      ? null
      : parts.icpFit + parts.evidenceQuality + parts.opportunityRelevance + parts.feasibility;
  return {
    icpFit: parts.icpFit,
    evidenceQuality: parts.evidenceQuality,
    opportunityRelevance: parts.opportunityRelevance,
    proposalFeasibility: parts.feasibility,
    total,
    reasons: parts.reasons,
  };
}

export const fixtureCampaign: Campaign = campaignSchema.parse({
  id: CAMPAIGN,
  workspaceId: WS,
  name: "Hackathon demo batch — AI outbound ICP",
  offer: fixtureSellerOffer,
  limits: { maxCompanies: 25, maxPagesPerCompany: 6, maxConcurrentJobs: 3, maxModelRequests: 8 },
  status: "active",
  createdAt: hoursAgo(6),
  updatedAt: hoursAgo(2),
});

export const fixtureCompanies: Company[] = [
  {
    id: FIXTURE_COMPANY_IDS.compa,
    runId: RUN,
    campaignId: CAMPAIGN,
    workspaceId: WS,
    name: "Compa",
    domain: "compa.ai",
    status: "ready",
    hubspotEvidence: {
      publicIntegration: "observed",
      internalAdoption: "unknown",
      checkedAt: hoursAgo(2),
      note: "HubSpot loader on home + HubSpot-connected Webflow form on /get-demo",
    },
    score: score({
      icpFit: 28,
      evidenceQuality: 24,
      opportunityRelevance: 22,
      feasibility: 12,
      reasons: [
        { component: "icp_fit", reason: "Demo-led B2B SaaS; public HubSpot integration matches the ICP." },
        { component: "evidence_quality", reason: "Embedded loader and form captured first-party; fresh captures." },
        { component: "opportunity_relevance", reason: "Demo-form friction maps directly onto the seller's offer." },
        { component: "proposal_feasibility", reason: "Specific workflow proposal possible; internal tier unknown (capped)." },
      ],
    }),
    createdAt: hoursAgo(6),
    updatedAt: hoursAgo(1),
  },
  {
    id: FIXTURE_COMPANY_IDS.crescendo,
    runId: RUN,
    campaignId: CAMPAIGN,
    workspaceId: WS,
    name: "Crescendo",
    domain: "crescendo.ai",
    status: "ready",
    hubspotEvidence: {
      publicIntegration: "probable",
      internalAdoption: "first_party_reported",
      checkedAt: hoursAgo(5),
      note: "First-party subprocessor disclosure names HubSpot as CRM; contact page has a HubSpot form",
    },
    score: score({
      icpFit: 26,
      evidenceQuality: 20,
      opportunityRelevance: 20,
      feasibility: 12,
      reasons: [
        { component: "icp_fit", reason: "AI product with a demo path; ICP fit strong but less form-led than Compa." },
        { component: "evidence_quality", reason: "First-party disclosure is dated — currency not assumed." },
        { component: "opportunity_relevance", reason: "Enrichment pilot proposal aligns with the seller's consulting offer." },
        { component: "proposal_feasibility", reason: "Existing routing must be validated before automation (capped)." },
      ],
    }),
    createdAt: hoursAgo(6),
    updatedAt: hoursAgo(1),
  },
  {
    id: FIXTURE_COMPANY_IDS.hex,
    runId: RUN,
    campaignId: CAMPAIGN,
    workspaceId: WS,
    name: "Hex",
    domain: "hex.tech",
    status: "partial",
    hubspotEvidence: {
      publicIntegration: "not_observed",
      internalAdoption: "unknown",
      checkedAt: daysAgo(6),
      note: "Raw homepage HTML exposed no HubSpot signature; subprocessor list suggests usage — scan incomplete, not_observed is not 'does not use'",
    },
    score: score({
      icpFit: 20,
      evidenceQuality: 12,
      opportunityRelevance: 17,
      feasibility: 12,
      reasons: [
        { component: "icp_fit", reason: "Data-tool product; buyer journey plausible but not demo-form led." },
        { component: "evidence_quality", reason: "Homepage scan incomplete; subprocessor evidence cached." },
        { component: "opportunity_relevance", reason: "Journey-split hypothesis fits the offer but needs validation." },
        { component: "proposal_feasibility", reason: "A scoped discovery proposal is feasible despite partial scan." },
      ],
    }),
    createdAt: hoursAgo(6),
    updatedAt: daysAgo(6),
  },
  {
    id: FIXTURE_COMPANY_IDS.northwind,
    runId: RUN,
    campaignId: CAMPAIGN,
    workspaceId: WS,
    name: "Northwind Robotics",
    domain: "northwindrobotics.com",
    status: "failed",
    hubspotEvidence: null,
    score: null,
    error: "Connection timed out after 3 attempts — site unreachable from the collector.",
    createdAt: hoursAgo(6),
    updatedAt: hoursAgo(4),
  },
  {
    id: FIXTURE_COMPANY_IDS.lumina,
    runId: RUN,
    campaignId: CAMPAIGN,
    workspaceId: WS,
    name: "Lumina Grid",
    domain: "luminagrid.io",
    status: "blocked",
    hubspotEvidence: null,
    score: null,
    error: "Robots policy disallows crawling on all selected pages; scan marked blocked.",
    createdAt: hoursAgo(6),
    updatedAt: hoursAgo(4),
  },
  {
    id: FIXTURE_COMPANY_IDS.parallax,
    runId: RUN,
    campaignId: CAMPAIGN,
    workspaceId: WS,
    name: "Parallax Data",
    domain: "parallaxdata.ai",
    status: "cancelled",
    hubspotEvidence: null,
    score: null,
    createdAt: hoursAgo(6),
    updatedAt: hoursAgo(5),
  },
  {
    id: FIXTURE_COMPANY_IDS.meridian,
    runId: RUN,
    campaignId: CAMPAIGN,
    workspaceId: WS,
    name: "Meridian Compliance",
    domain: "meridiancompliance.com",
    status: "reviewing",
    hubspotEvidence: {
      publicIntegration: "scan_incomplete",
      internalAdoption: "unknown",
      checkedAt: hoursAgo(1),
      note: "Two of six pages captured so far; detector verdict deferred",
    },
    score: null,
    createdAt: hoursAgo(6),
    updatedAt: hoursAgo(1),
  },
  {
    id: FIXTURE_COMPANY_IDS.cobalt,
    runId: RUN,
    campaignId: CAMPAIGN,
    workspaceId: WS,
    name: "Cobalt Ledger",
    domain: "cobaltledger.com",
    status: "analyzing",
    hubspotEvidence: null,
    score: null,
    createdAt: hoursAgo(6),
    updatedAt: hoursAgo(1),
  },
  {
    id: FIXTURE_COMPANY_IDS.solstice,
    runId: RUN,
    campaignId: CAMPAIGN,
    workspaceId: WS,
    name: "Solstice Health",
    domain: "solsticehealth.io",
    status: "queued",
    hubspotEvidence: null,
    score: null,
    createdAt: hoursAgo(6),
    updatedAt: hoursAgo(6),
  },
  {
    id: FIXTURE_COMPANY_IDS.veldt,
    runId: RUN,
    campaignId: CAMPAIGN,
    workspaceId: WS,
    name: "Veldt Analytics",
    domain: "veldtanalytics.com",
    status: "collecting",
    hubspotEvidence: null,
    score: null,
    createdAt: hoursAgo(6),
    updatedAt: hoursAgo(1),
  },
].map((c) => companySchema.parse(c));

export const fixtureEvidence: Evidence[] = [
  {
    id: cid("e1"),
    companyId: FIXTURE_COMPANY_IDS.compa,
    url: "https://www.compa.ai/",
    capturedAt: hoursAgo(2),
    method: "html",
    locator: 'script[src*="js.hs-scripts.com"]',
    excerpt:
      '<script defer src="//js.hs-scripts.com/2216543.js" ...></script> — HubSpot tracking loader present in initial HTML of the homepage.',
    limitations: [],
  },
  {
    id: cid("e2"),
    companyId: FIXTURE_COMPANY_IDS.compa,
    url: "https://www.compa.ai/get-demo",
    capturedAt: hoursAgo(2),
    method: "html",
    locator: 'script: hbspt.forms.create({ target: "#demo-form" })',
    excerpt:
      "hbspt.forms.create embed renders the demo request form; the surrounding form is a Webflow-native form wired to HubSpot (data-attribute handoff visible).",
    limitations: [],
  },
  {
    id: cid("e3"),
    companyId: FIXTURE_COMPANY_IDS.compa,
    url: "https://www.compa.ai/get-demo",
    capturedAt: hoursAgo(1),
    method: "network",
    locator: "POST https://forms.hubspot.com/uploads/v3/... (rendered pass)",
    excerpt:
      "Form submission POST to forms.hubspot.com observed during the rendered pass. Conflicting portal IDs recorded (2216543, 2216544) without inferring account organization.",
    limitations: [],
  },
  {
    id: cid("e4"),
    companyId: FIXTURE_COMPANY_IDS.compa,
    url: "https://www.compa.ai/pricing",
    capturedAt: hoursAgo(2),
    method: "html",
    excerpt:
      "Pricing page shows three tiers with a single 'Request demo' CTA routed to the same /get-demo journey for all segments; no HubSpot signature on this page.",
    limitations: [],
  },
  {
    id: cid("e5"),
    companyId: FIXTURE_COMPANY_IDS.compa,
    url: "https://www.compa.ai/customers",
    capturedAt: daysAgo(4),
    method: "html",
    excerpt:
      "Customer stories: two mid-market case studies describing demo-led adoption in total-rewards teams. Captured from cache — re-verify before citing in outreach.",
    limitations: ["cached"],
  },
  {
    id: cid("e6"),
    companyId: FIXTURE_COMPANY_IDS.crescendo,
    url: "https://www.crescendo.ai/subprocessors",
    capturedAt: hoursAgo(5),
    method: "first_party_text",
    excerpt:
      "Subprocessor list (dated 2026-06-30): 'HubSpot — CRM for prospect and customer data and communications.' First-party disclosure; currency not assumed.",
    limitations: ["dated disclosure 2026-06-30 — currency not assumed"],
  },
  {
    id: cid("e7"),
    companyId: FIXTURE_COMPANY_IDS.crescendo,
    url: "https://www.crescendo.ai/contact",
    capturedAt: hoursAgo(5),
    method: "html",
    locator: 'iframe[src*="forms.hubspot.com"]',
    excerpt:
      "Contact page embeds a HubSpot-hosted form iframe with 7 fields before submission.",
    limitations: [],
  },
  {
    id: cid("e8"),
    companyId: FIXTURE_COMPANY_IDS.hex,
    url: "https://hex.tech/",
    capturedAt: daysAgo(6),
    method: "html",
    excerpt:
      "Homepage HTML contains no HubSpot script or form signatures. Demo route is client-rendered — render required before a negative result is conclusive.",
    limitations: ["render required — client-rendered demo route not captured"],
  },
  {
    id: cid("e9"),
    companyId: FIXTURE_COMPANY_IDS.hex,
    url: "https://learn.hex.tech/docs/legal/subprocessors",
    capturedAt: daysAgo(6),
    method: "first_party_text",
    excerpt:
      "Subprocessor list includes HubSpot under 'customer engagement'. Served from the docs host; captured from cache during an earlier pass.",
    limitations: ["cached"],
  },
].map((e) => evidenceSchema.parse(e));

export const fixtureSignals: TechnologySignal[] = [
  {
    id: cid("s1"),
    companyId: FIXTURE_COMPANY_IDS.compa,
    vendor: "HubSpot",
    signature: "js.hs-scripts.com loader script",
    pageUrl: "https://www.compa.ai/",
    method: "html",
    integrationStatus: "observed",
    detectedAt: hoursAgo(2),
    locator: 'script[src*="js.hs-scripts.com"]',
    excerpt: "Tracking loader present in initial HTML.",
    conflictingPortalIds: [],
  },
  {
    id: cid("s2"),
    companyId: FIXTURE_COMPANY_IDS.compa,
    vendor: "HubSpot",
    signature: "hbspt.forms.create embed",
    pageUrl: "https://www.compa.ai/get-demo",
    method: "html",
    integrationStatus: "observed",
    detectedAt: hoursAgo(2),
    locator: "inline script on /get-demo",
    excerpt: "HubSpot form embed rendering the demo request form.",
    conflictingPortalIds: [],
  },
  {
    id: cid("s3"),
    companyId: FIXTURE_COMPANY_IDS.compa,
    vendor: "HubSpot",
    signature: "forms.hubspot.com submission POST",
    pageUrl: "https://www.compa.ai/get-demo",
    method: "network",
    integrationStatus: "observed",
    detectedAt: hoursAgo(1),
    excerpt: "Rendered-pass form POST to HubSpot forms endpoint.",
    conflictingPortalIds: ["2216543", "2216544"],
  },
  {
    id: cid("s4"),
    companyId: FIXTURE_COMPANY_IDS.compa,
    vendor: "Webflow",
    signature: "Webflow form data-attributes",
    pageUrl: "https://www.compa.ai/get-demo",
    method: "html",
    integrationStatus: "observed",
    detectedAt: hoursAgo(2),
    excerpt: "Webflow-native form with HubSpot handoff attributes.",
    conflictingPortalIds: [],
  },
  {
    id: cid("s5"),
    companyId: FIXTURE_COMPANY_IDS.crescendo,
    vendor: "HubSpot",
    signature: "First-party subprocessor disclosure",
    pageUrl: "https://www.crescendo.ai/subprocessors",
    method: "first_party_text",
    integrationStatus: "probable",
    detectedAt: hoursAgo(5),
    excerpt: "HubSpot named as CRM for prospect/customer data (dated 2026-06-30).",
    conflictingPortalIds: [],
  },
  {
    id: cid("s6"),
    companyId: FIXTURE_COMPANY_IDS.crescendo,
    vendor: "HubSpot",
    signature: "forms.hubspot.com form iframe",
    pageUrl: "https://www.crescendo.ai/contact",
    method: "html",
    integrationStatus: "probable",
    detectedAt: hoursAgo(5),
    locator: 'iframe[src*="forms.hubspot.com"]',
    excerpt: "HubSpot-hosted contact form iframe.",
    conflictingPortalIds: [],
  },
].map((s) => technologySignalSchema.parse(s));

export const fixtureCaptures: PageCapture[] = [
  {
    id: cid("p1"),
    companyId: FIXTURE_COMPANY_IDS.compa,
    url: "https://www.compa.ai/",
    role: "home",
    method: "html",
    httpStatus: 200,
    capturedAt: hoursAgo(2),
    links: ["https://www.compa.ai/get-demo", "https://www.compa.ai/pricing", "https://www.compa.ai/customers"],
    forms: [],
    runtimeObservations: [],
    limitations: [],
  },
  {
    id: cid("p2"),
    companyId: FIXTURE_COMPANY_IDS.compa,
    url: "https://www.compa.ai/get-demo",
    role: "demo_contact",
    method: "html",
    httpStatus: 200,
    capturedAt: hoursAgo(2),
    links: ["https://www.compa.ai/legal/privacy"],
    forms: [
      {
        action: "https://www.compa.ai/get-demo",
        method: "post",
        fields: [
          { name: "firstname", type: "text", required: true },
          { name: "lastname", type: "text", required: true },
          { name: "email", type: "email", required: true },
          { name: "company", type: "text", required: true },
          { name: "company_size", type: "select", required: true },
          { name: "industry", type: "select", required: true },
          { name: "use_case", type: "select", required: true },
          { name: "phone", type: "tel", required: false },
          { name: "message", type: "textarea", required: false },
        ],
      },
    ],
    runtimeObservations: [],
    limitations: [],
  },
  {
    id: cid("p3"),
    companyId: FIXTURE_COMPANY_IDS.compa,
    url: "https://www.compa.ai/get-demo",
    role: "demo_contact",
    method: "rendered_dom",
    httpStatus: 200,
    capturedAt: hoursAgo(1),
    links: [],
    forms: [],
    runtimeObservations: [
      "Consent banner defers tag firing until acceptance",
      "Service worker active on /get-demo",
    ],
    limitations: [],
  },
  {
    id: cid("p4"),
    companyId: FIXTURE_COMPANY_IDS.compa,
    url: "https://www.compa.ai/pricing",
    role: "pricing",
    method: "html",
    httpStatus: 200,
    capturedAt: hoursAgo(2),
    links: ["https://www.compa.ai/get-demo"],
    forms: [],
    runtimeObservations: [],
    limitations: [],
  },
  {
    id: cid("p5"),
    companyId: FIXTURE_COMPANY_IDS.crescendo,
    url: "https://www.crescendo.ai/subprocessors",
    role: "integration_use_case",
    method: "html",
    httpStatus: 200,
    capturedAt: hoursAgo(5),
    links: [],
    forms: [],
    runtimeObservations: [],
    limitations: [],
  },
  {
    id: cid("p6"),
    companyId: FIXTURE_COMPANY_IDS.crescendo,
    url: "https://www.crescendo.ai/contact",
    role: "demo_contact",
    method: "html",
    httpStatus: 200,
    capturedAt: hoursAgo(5),
    links: [],
    forms: [{ action: "https://forms.hubspot.com/...", method: "post", fields: [] }],
    runtimeObservations: [],
    limitations: [],
  },
  {
    id: cid("p7"),
    companyId: FIXTURE_COMPANY_IDS.hex,
    url: "https://hex.tech/",
    role: "home",
    method: "html",
    httpStatus: 200,
    capturedAt: daysAgo(6),
    links: ["https://hex.tech/product", "https://hex.tech/demo"],
    forms: [],
    runtimeObservations: [],
    limitations: ["render required — demo route is client-rendered"],
  },
].map((p) => pageCaptureSchema.parse(p));

export const fixtureFindings: Finding[] = [
  {
    id: cid("f1"),
    category: "conversion",
    observation:
      "The demo request form asks for 9 fields, including phone and a free-text message, before any booking option appears.",
    evidenceIds: [cid("e2")],
    hypothesis:
      "A shorter first step would reduce abandonment while deferring enrichment until after a booking signal exists.",
    recommendation:
      "Proposed: split the form into a two-step flow — identity and company only in step one; enrichment fields requested post-booking.",
    confidence: "high",
    validationNeeded: [
      "Baseline form conversion rate by step",
      "Which fields feed required routing today",
      "HubSpot form vs Webflow-native form ownership",
    ],
    ownerRole: "Marketing Ops",
    effort: "small",
    metric: "Demo form conversion rate (baseline: not yet measured)",
  },
  {
    id: cid("f2"),
    category: "acquisition",
    observation:
      "Industry and use-case pages all route to the same generic demo journey; the originating use case is not preserved in the form.",
    evidenceIds: [cid("e1"), cid("e4")],
    hypothesis:
      "Preserving the originating use case would let follow-up match the visitor's context.",
    recommendation:
      "Proposed: capture source page in a hidden field and branch lifecycle emails on the use case.",
    confidence: "medium",
    validationNeeded: ["Existing hidden fields and source capture", "Workflow segmentation support"],
    ownerRole: "Demand Gen",
    effort: "medium",
    metric: "Demo requests with resolved use-case context (baseline: unknown)",
  },
  {
    id: cid("f3"),
    category: "measurement",
    observation:
      "A form submission POST to HubSpot was observed, but SPA route transitions showed no observable page-view request during the rendered pass.",
    evidenceIds: [cid("e3")],
    hypothesis: "Route-change instrumentation may under-count product-page engagement.",
    recommendation:
      "Proposed: review route-change instrumentation under a documented test condition before changing anything.",
    confidence: "low",
    validationNeeded: ["Consent state at capture", "Tag timing and blockers", "Supported tracking configuration"],
    ownerRole: "Analytics",
    effort: "medium",
    metric: "Page-view events per session on key routes (baseline: unknown)",
  },
  {
    id: cid("f4"),
    category: "nurture",
    observation: "The company claims a 40% lift in reply rates after its HubSpot rollout.",
    evidenceIds: [],
    hypothesis: "REJECTED BY REVIEWER — no captured evidence supports a quantified lift claim.",
    recommendation: "Proposed: removed from the plan; do not cite unverifiable lift numbers.",
    confidence: "low",
    validationNeeded: [],
    ownerRole: "Reviewer",
    effort: "small",
    metric: "n/a",
  },
  {
    id: cid("f5"),
    category: "nurture",
    observation:
      "A first-party subprocessor disclosure names HubSpot as the CRM for prospect and customer communications.",
    evidenceIds: [cid("e6")],
    hypothesis: "Lifecycle communications likely run in HubSpot; existing routing is unknown.",
    recommendation:
      "Proposed: validate existing routing before proposing automation; treat public evidence as adoption-suggestive, not verified.",
    confidence: "medium",
    validationNeeded: ["Existing workflow routing", "Lifecycle stage definitions"],
    ownerRole: "RevOps",
    effort: "small",
    metric: "Share of lifecycle emails sent via HubSpot (baseline: unknown)",
  },
  {
    id: cid("f6"),
    category: "conversion",
    observation: "The contact page form duplicates the demo path with 7 fields before submission.",
    evidenceIds: [cid("e7")],
    hypothesis: "Two parallel intake paths may split attribution and response handling.",
    recommendation: "Proposed: consolidate intake routing with explicit source persistence.",
    confidence: "medium",
    validationNeeded: ["Attribution configuration across both forms"],
    ownerRole: "Marketing Ops",
    effort: "small",
    metric: "Contact-form completion rate (baseline: unknown)",
  },
  {
    id: cid("f7"),
    category: "handoff",
    observation:
      "Self-serve and sales-assisted journeys exist side by side; the handoff point for qualified self-serve users is not publicly observable.",
    evidenceIds: [cid("e8"), cid("e9")],
    hypothesis: "An explicit handoff for qualified self-serve teams would shorten time-to-engage.",
    recommendation:
      "Proposed: map product-qualification signals to a handoff workflow — requires access to validate.",
    confidence: "low",
    validationNeeded: ["Existing routing", "Product events", "Account capabilities"],
    ownerRole: "Sales Ops",
    effort: "large",
    metric: "Self-serve to sales-assisted conversion (baseline: requires access)",
  },
].map((f) => findingSchema.parse(f));

/**
 * Findings scope to companies through the evidence they cite (the Finding
 * contract carries no companyId). The one unsupported finding — empty
 * evidenceIds, the review-rejection demo — is attributed explicitly.
 */
const UNSUPPORTED_FINDING_COMPANY: Record<string, string> = {
  [cid("f4")]: FIXTURE_COMPANY_IDS.compa,
};

function findingsForCompany(companyId: string): Finding[] {
  return fixtureFindings.filter((f) => {
    if (f.evidenceIds.length > 0) {
      return fixtureEvidence.find((e) => e.id === f.evidenceIds[0])?.companyId === companyId;
    }
    return UNSUPPORTED_FINDING_COMPANY[f.id] === companyId;
  });
}

export const fixturePlans: Record<string, AccountPlan> = {
  [FIXTURE_COMPANY_IDS.compa]: accountPlanSchema.parse({
    id: cid("b1"),
    companyId: FIXTURE_COMPANY_IDS.compa,
    workspaceId: WS,
    version: 1,
    status: "ready",
    diagnosis: {
      company: "Compa (compa.ai)",
      scanDate: hoursAgo(1),
      offerSummary: fixtureSellerOffer.headline,
      likelyBuyer: "Head of Total Rewards / People Ops at mid-market tech employers",
      businessModel: "Compensation-benchmarking SaaS with a demo-led sales motion",
      uncertainty: [
        "Internal CRM adoption is not verifiable from public evidence",
        "Company size and funding were not verified",
      ],
      journey: [
        {
          step: "Industry / use-case content pages",
          description: "Visitors arrive on industry pages that all route to the same /get-demo journey.",
          evidenceIds: [cid("e1"), cid("e4")],
        },
        {
          step: "Demo request form",
          description: "A 9-field HubSpot-connected Webflow form gates the booking option.",
          evidenceIds: [cid("e2")],
        },
        {
          step: "Form submission",
          description: "Submission POSTs to HubSpot forms; conflicting portal IDs recorded without inference.",
          evidenceIds: [cid("e3")],
        },
        {
          step: "Proof",
          description: "Customer stories describe demo-led adoption in total-rewards teams (cached capture).",
          evidenceIds: [cid("e5")],
        },
      ],
      assessments: [
        {
          category: "positioning",
          summary: "Positioning is clear and buyer-specific; proof is concentrated in two cached case studies.",
          evidenceIds: [cid("e5")],
        },
        {
          category: "acquisition",
          summary: "Content-led acquisition routes through a single generic demo journey.",
          evidenceIds: [cid("e1"), cid("e4")],
        },
        {
          category: "conversion",
          summary: "The 9-field form is the most likely friction point in the public journey.",
          evidenceIds: [cid("e2")],
        },
        {
          category: "nurture",
          summary: "Requires access — internal nurture stages are not observable publicly.",
          evidenceIds: [],
        },
        {
          category: "handoff",
          summary: "Requires access — demo-to-owner handoff is not observable publicly.",
          evidenceIds: [],
        },
        {
          category: "measurement",
          summary: "A HubSpot submission POST was observed; route-change page-view instrumentation needs review.",
          evidenceIds: [cid("e3")],
        },
      ],
    },
    opportunities: [
      {
        id: cid("b4"),
        title: "Shorten the demo-form first step",
        observation: "Nine fields are requested before any booking option appears.",
        evidenceIds: [cid("e2")],
        hypothesis: "A shorter first step reduces abandonment; enrichment moves after the booking signal.",
        proposedExperiment:
          "Two-step form: identity + company first; enrichment fields requested post-booking. Compare step-completion against the current baseline.",
        validationNeeded: ["Baseline conversion by step", "Fields required for routing"],
        priority: 1,
      },
      {
        id: cid("b5"),
        title: "Segment-specific follow-up from industry pages",
        observation: "Industry pages route into the same generic demo journey without preserving context.",
        evidenceIds: [cid("e1"), cid("e4")],
        hypothesis: "Preserving the originating use case lets response match visitor context.",
        proposedExperiment:
          "Hidden field carries the source use case into HubSpot; lifecycle emails branch on it for one cohort.",
        validationNeeded: ["Hidden-field support in the current form", "Workflow segmentation"],
        priority: 2,
      },
      {
        id: cid("b6"),
        title: "Instrument SPA route transitions",
        observation: "Route transitions showed no observable page-view request in the rendered pass.",
        evidenceIds: [cid("e3")],
        hypothesis: "Engagement on key routes may be under-counted.",
        proposedExperiment:
          "Document a test condition and review route-change instrumentation before changing configuration.",
        validationNeeded: ["Consent state", "Tag timing", "Supported tracking configuration"],
        priority: 3,
      },
    ],
    roadmap30: [
      {
        owner: "Marketing Ops",
        experiment: "Instrument the current demo form funnel to establish a baseline.",
        metric: "Demo form conversion rate",
        baseline: "Not yet measured — instrument first",
      },
      {
        owner: "Marketing Ops",
        experiment: "Ship the two-step form for one traffic cohort.",
        metric: "Step-completion and booking rate vs baseline",
      },
      {
        owner: "Demand Gen",
        experiment: "Add source use-case capture to the form and verify it lands in HubSpot.",
        metric: "Share of submissions with resolved use-case context",
      },
      {
        owner: "RevOps",
        experiment: "Branch one lifecycle email on the captured use case.",
        metric: "Reply rate on branched vs generic sequence",
      },
    ],
    hubspotProposal: {
      label: "proposed design" as const,
      trigger: "Demo request submitted",
      conditions: ["Source use-case page known", "Company size captured in step one"],
      actions: [
        "Preserve use case and source in deal/company properties",
        "Qualify account against the ICP list",
        "Assign owner and create a response task",
        "Notify owner in the selling channel",
        "Stop follow-up on reply, meeting, disqualification, or opt-out",
      ],
      exitCriteria: ["Meeting booked", "Disqualified", "Opt-out"],
      owner: "Marketing Ops",
      measurement:
        "Positive replies and meetings per demo request vs pre-pilot baseline; no lift estimate is claimed until data exists.",
      prerequisites: [
        "HubSpot workflow permissions verified for the operative tier",
        "Hidden-field capture confirmed on the live form",
        "Existing routing documented before changes",
      ],
    },
    outreach: {
      buyerRole: "Head of Total Rewards (or equivalent people-analytics owner)",
      discoveryQuestion:
        "How do demo requests from different industry pages get routed to the right follow-up today?",
      offer: "A scoped funnel/automation audit of the demo journey, with an annotated workflow sketch as the deliverable",
      sequence: [
        {
          touch: 1,
          subject: "Your industry pages all lead to the same demo form",
          body: "I noticed your industry pages lead into the same demo journey. If the originating use case is not already informing follow-up, there may be an opportunity to make that response more relevant. We help teams connect those signals to HubSpot routing and nurture. Would a short annotated workflow sketch be useful?",
        },
        {
          touch: 2,
          subject: "The annotated workflow sketch",
          body: "Attached is the sketch: source use case captured at the form, routed in HubSpot, with the follow-up branched per segment. If useful, I can walk through it in 15 minutes — no obligation.",
        },
        {
          touch: 3,
          subject: "Closing note",
          body: "Closing the loop on the workflow sketch. If demo-journey routing is not a priority this quarter, I will leave the sketch with you — it is yours to use either way.",
        },
      ],
      successMeasures: [
        "Positive reply rate on the sequence",
        "Qualified conversations per 10 researched accounts",
        "Meetings booked; pipeline only after data exists",
      ],
    },
    sourceKey: "E1–E5 captured 2026-09-24 — compa.ai home, /get-demo (html + rendered), /pricing, /customers (cached)",
    unknowns: [
      "Internal CRM adoption (public integration evidence does not establish it)",
      "Existing routing and lifecycle stage definitions",
      "Portal ID conflict (2216543 / 2216544) — recorded, not interpreted",
      "Which form platform owns submission routing (Webflow vs HubSpot native)",
    ],
  }),
  [FIXTURE_COMPANY_IDS.crescendo]: accountPlanSchema.parse({
    id: cid("b2"),
    companyId: FIXTURE_COMPANY_IDS.crescendo,
    workspaceId: WS,
    version: 1,
    status: "review",
    diagnosis: {
      company: "Crescendo (crescendo.ai)",
      scanDate: hoursAgo(5),
      offerSummary: fixtureSellerOffer.headline,
      likelyBuyer: "Revenue/Growth leadership at AI companies scaling outbound",
      businessModel: "AI product with enterprise demo paths and self-serve content",
      uncertainty: ["HubSpot usage is first-party-reported, not connection-verified"],
      journey: [
        {
          step: "Subprocessor disclosure",
          description: "First-party page names HubSpot as CRM for prospect/customer data (dated 2026-06-30).",
          evidenceIds: [cid("e6")],
        },
        {
          step: "Contact form",
          description: "HubSpot-hosted form iframe with 7 fields on the contact page.",
          evidenceIds: [cid("e7")],
        },
      ],
      assessments: [
        {
          category: "nurture",
          summary: "Lifecycle communications likely run in HubSpot; routing details are unknown.",
          evidenceIds: [cid("e6")],
        },
        {
          category: "conversion",
          summary: "Contact and demo paths run in parallel with separate forms.",
          evidenceIds: [cid("e7")],
        },
        {
          category: "measurement",
          summary: "Requires access — attribution configuration is not publicly observable.",
          evidenceIds: [],
        },
      ],
    },
    opportunities: [
      {
        id: cid("b7"),
        title: "Industry-specific account research and enrichment pilot",
        observation: "Public evidence suggests HubSpot is used for prospect/customer communications.",
        evidenceIds: [cid("e6")],
        hypothesis:
          "A scoped pilot researching one target segment with provenance-carrying enrichment fields would fit the seller's consulting offer.",
        proposedExperiment:
          "Pilot: one segment, an approved account batch, enrichment fields with source and capture time, reviewed HubSpot updates staged for approval.",
        validationNeeded: ["Existing routing first", "HubSpot tier capabilities", "Data-source authorization for contact enrichment"],
        priority: 1,
      },
      {
        id: cid("b8"),
        title: "Validate routing before automation",
        observation: "Two intake paths (contact form, demo path) may split attribution and handling.",
        evidenceIds: [cid("e7")],
        hypothesis: "Documenting existing routing prevents automating on top of an unverified process.",
        proposedExperiment: "Routing audit: map both forms to owners, queues, and lifecycle stages before any change.",
        validationNeeded: ["Current workflow ownership", "Response SLAs"],
        priority: 2,
      },
    ],
    roadmap30: [
      {
        owner: "RevOps",
        experiment: "Audit existing routing for both intake forms.",
        metric: "Documented routing map",
        baseline: "No current map exists (validate)",
      },
      {
        owner: "Consultant + RevOps",
        experiment: "Run the one-segment enrichment pilot with reviewed, staged updates.",
        metric: "Enrichment field completeness with provenance",
      },
      {
        owner: "Sales leadership",
        experiment: "Reviewer acceptance check on staged updates and drafts.",
        metric: "Reviewer acceptance rate of drafts",
      },
    ],
    hubspotProposal: {
      label: "proposed design" as const,
      trigger: "Approved account batch enters the enrichment pilot",
      conditions: ["Segment approved", "Existing routing documented"],
      actions: [
        "Research accounts with source-carrying fields",
        "Stage proposed property updates for human review",
        "Preserve existing verified values by default",
      ],
      exitCriteria: ["Batch reviewed and approved or rejected", "Suppression list applied"],
      owner: "RevOps",
      measurement: "Duplicate rate and reviewer acceptance of staged updates during the pilot.",
      prerequisites: ["Routing audit complete", "Authorized data sources configured for any contact enrichment"],
    },
    outreach: {
      buyerRole: "VP Revenue Operations (or growth-equivalent)",
      discoveryQuestion: "How are prospect and customer communications separated in your HubSpot instance today?",
      offer: "A scoped enrichment pilot: one segment, approved batch, provenance on every field",
      sequence: [
        {
          touch: 1,
          subject: "Your subprocessor page made this easy",
          body: "Your subprocessor disclosure describes HubSpot as your CRM for prospect and customer communications. We run a scoped pilot that researches one segment and stages reviewed HubSpot updates — provenance on every field. Worth a look?",
        },
        {
          touch: 2,
          subject: "Pilot outline",
          body: "One-page outline of the pilot: segment, batch size, fields, approval point, and the measures we baseline first. Happy to share.",
        },
        {
          touch: 3,
          subject: "Closing note",
          body: "Closing the loop — if enrichment provenance is not a priority this quarter, I will stop here. The outline is yours if useful.",
        },
      ],
      successMeasures: ["Positive replies", "Pilot acceptance", "Meetings booked after review"],
    },
    sourceKey: "E6–E7 captured 2026-09-24 — crescendo.ai /subprocessors (first-party, dated), /contact",
    unknowns: [
      "Whether the dated disclosure still reflects current usage",
      "Existing workflow routing and ownership",
      "Authorized connection status (public evidence never verifies it)",
    ],
  }),
  [FIXTURE_COMPANY_IDS.hex]: accountPlanSchema.parse({
    id: cid("b3"),
    companyId: FIXTURE_COMPANY_IDS.hex,
    workspaceId: WS,
    version: 1,
    status: "draft",
    diagnosis: {
      company: "Hex (hex.tech)",
      scanDate: daysAgo(6),
      offerSummary: fixtureSellerOffer.headline,
      likelyBuyer: "Data team leadership evaluating collaborative analytics",
      businessModel: "Collaborative data-science platform with self-serve and sales-assisted routes",
      uncertainty: [
        "Scan incomplete — homepage HTML only; demo route is client-rendered",
        "Subprocessor evidence is cached from an earlier capture",
      ],
      journey: [
        {
          step: "Homepage (html)",
          description: "No HubSpot signature in initial HTML; not_observed is not 'does not use'.",
          evidenceIds: [cid("e8")],
        },
        {
          step: "Subprocessor list (docs host)",
          description: "HubSpot listed under customer engagement; cached capture.",
          evidenceIds: [cid("e9")],
        },
      ],
      assessments: [
        {
          category: "handoff",
          summary: "Self-serve and sales-assisted journeys coexist; handoff is not publicly observable.",
          evidenceIds: [cid("e8"), cid("e9")],
        },
        {
          category: "measurement",
          summary: "Requires access — tracking configuration is not verifiable from the partial scan.",
          evidenceIds: [],
        },
      ],
    },
    opportunities: [
      {
        id: cid("b9"),
        title: "Map self-serve vs sales-assisted journeys",
        observation: "Two routes exist with no publicly observable handoff for qualified self-serve teams.",
        evidenceIds: [cid("e9")],
        hypothesis: "An explicit handoff would shorten time-to-engage for qualified accounts.",
        proposedExperiment: "Discovery-first: confirm system responsibilities before proposing automation.",
        validationNeeded: ["Existing routing", "Product events", "Account capabilities"],
        priority: 1,
      },
    ],
    roadmap30: [
      {
        owner: "Sales Ops",
        experiment: "Complete the rendered scan of the demo route to close the partial-scan gap.",
        metric: "Scan completeness (pages captured)",
        baseline: "Homepage only",
      },
      {
        owner: "Consultant",
        experiment: "Discovery call on journey responsibilities before any automation proposal.",
        metric: "Documented journey map",
      },
    ],
    hubspotProposal: {
      label: "proposed design" as const,
      trigger: "Self-serve account reaches a usage-qualification threshold",
      conditions: ["Qualification signals documented with the company first"],
      actions: ["Create or update the account record", "Assign owner", "Create a response task"],
      exitCriteria: ["Engaged by sales", "Disqualified", "Opt-out"],
      owner: "Sales Ops",
      measurement: "Time from qualification to first human touch (baseline: requires access).",
      prerequisites: ["Rendered scan completed", "System responsibilities confirmed in discovery"],
    },
    outreach: {
      buyerRole: "Head of Product-Led Growth (or revenue-ops equivalent)",
      discoveryQuestion: "When does a self-serve team become interesting to sales today?",
      offer: "A scoped journey-mapping engagement with an evidence-backed audit",
      sequence: [
        {
          touch: 1,
          subject: "Two journeys, one question",
          body: "Hex serves self-serve teams and sales-assisted accounts. When a self-serve team starts looking like an enterprise account, who sees that signal first? We help teams wire that handoff in HubSpot — validated, not assumed.",
        },
        {
          touch: 2,
          subject: "Journey-mapping sketch",
          body: "A one-page sketch of a qualification-to-handoff flow, including what would need validating in your instance.",
        },
        {
          touch: 3,
          subject: "Closing note",
          body: "Closing the loop. If the self-serve handoff is not a priority this quarter, the sketch is yours to keep.",
        },
      ],
      successMeasures: ["Positive replies", "Discovery calls booked", "Documented journey maps delivered"],
    },
    sourceKey: "E8–E9 captured 2026-09-18 — hex.tech home (html, incomplete), learn.hex.tech subprocessors (cached)",
    unknowns: [
      "Whether HubSpot tracking is present after render (scan incomplete)",
      "Internal CRM adoption",
      "Handoff ownership between self-serve and sales",
    ],
  }),
};

function bundleFor(companyId: string, name: string, domain: string, status: Company["status"]): CompanyAuditBundle {
  const company = fixtureCompanies.find((c) => c.id === companyId);
  return {
    company: company ?? {
      id: companyId,
      runId: RUN,
      campaignId: CAMPAIGN,
      workspaceId: WS,
      name,
      domain,
      status,
      hubspotEvidence: null,
      score: null,
      createdAt: hoursAgo(6),
      updatedAt: hoursAgo(1),
    },
    evidence: fixtureEvidence.filter((e) => e.companyId === companyId),
    findings: findingsForCompany(companyId),
    signals: fixtureSignals.filter((s) => s.companyId === companyId),
    captures: fixtureCaptures.filter((p) => p.companyId === companyId),
    accountPlan: fixturePlans[companyId] ?? null,
  };
}

/** Audit bundles keyed by company id — the fixture AuditSource reads these. */
export const fixtureAuditBundles: Record<string, CompanyAuditBundle> = {
  [FIXTURE_COMPANY_IDS.compa]: bundleFor(FIXTURE_COMPANY_IDS.compa, "Compa", "compa.ai", "ready"),
  [FIXTURE_COMPANY_IDS.crescendo]: bundleFor(
    FIXTURE_COMPANY_IDS.crescendo,
    "Crescendo",
    "crescendo.ai",
    "ready",
  ),
  [FIXTURE_COMPANY_IDS.hex]: bundleFor(FIXTURE_COMPANY_IDS.hex, "Hex", "hex.tech", "partial"),
  [FIXTURE_COMPANY_IDS.northwind]: bundleFor(
    FIXTURE_COMPANY_IDS.northwind,
    "Northwind Robotics",
    "northwindrobotics.com",
    "failed",
  ),
  [FIXTURE_COMPANY_IDS.lumina]: bundleFor(
    FIXTURE_COMPANY_IDS.lumina,
    "Lumina Grid",
    "luminagrid.io",
    "blocked",
  ),
  [FIXTURE_COMPANY_IDS.parallax]: bundleFor(
    FIXTURE_COMPANY_IDS.parallax,
    "Parallax Data",
    "parallaxdata.ai",
    "cancelled",
  ),
  [FIXTURE_COMPANY_IDS.meridian]: bundleFor(
    FIXTURE_COMPANY_IDS.meridian,
    "Meridian Compliance",
    "meridiancompliance.com",
    "reviewing",
  ),
  [FIXTURE_COMPANY_IDS.cobalt]: bundleFor(
    FIXTURE_COMPANY_IDS.cobalt,
    "Cobalt Ledger",
    "cobaltledger.com",
    "analyzing",
  ),
  [FIXTURE_COMPANY_IDS.solstice]: bundleFor(
    FIXTURE_COMPANY_IDS.solstice,
    "Solstice Health",
    "solsticehealth.io",
    "queued",
  ),
  [FIXTURE_COMPANY_IDS.veldt]: bundleFor(
    FIXTURE_COMPANY_IDS.veldt,
    "Veldt Analytics",
    "veldtanalytics.com",
    "collecting",
  ),
};

export const fixtureFindingsFor = (companyId: string): Finding[] =>
  findingsForCompany(companyId);

export const fixtureRun: Run = runSchema.parse({
  id: RUN,
  campaignId: CAMPAIGN,
  workspaceId: WS,
  status: "running",
  idempotencyKey: "fixture-demo-2026-09-24-01",
  companiesTotal: fixtureCompanies.length,
  companiesReady: fixtureCompanies.filter((c) => c.status === "ready").length,
  companiesFailed: fixtureCompanies.filter((c) =>
    ["failed", "partial", "blocked", "cancelled"].includes(c.status),
  ).length,
  modelRequestsUsed: 5,
  failures: [
    {
      companyId: FIXTURE_COMPANY_IDS.northwind,
      stage: "collecting",
      error: "Connection timed out after 3 attempts — site unreachable from the collector.",
    },
  ],
  createdAt: hoursAgo(6),
  updatedAt: hoursAgo(1),
});
