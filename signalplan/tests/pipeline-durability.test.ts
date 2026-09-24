import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { runBatch } from "@/trigger/run-batch";
import { runCompany } from "@/trigger/run-company";
import type { AnalysisSeam, CollectorSeam } from "@/trigger/seams";
import { analyzeCompany } from "@/lib/workers/analysis";
import { MockModelAdapter } from "@/lib/ai/mock-adapter";
import { InMemoryRepository } from "@/lib/repositories/in-memory";
import { makeTestUsers } from "./helpers/session-stubs";
import { makeEvidence, makePlanContent } from "./ai/helpers/fixtures";
import type { Campaign } from "@/lib/contracts";

/**
 * End-to-end pipeline durability and idempotency (acceptance checks 5 and 11,
 * exercised against the wired run-batch → run-company → analysis path with
 * the labeled mock adapter — no credentials required).
 */

function makeCampaign(workspaceId: string): Campaign {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    workspaceId,
    name: "Integration campaign",
    offer: {
      headline: "Marketing consulting for HubSpot teams.",
      idealCustomerProfile: "B2B AI software companies.",
      differentiators: [],
      proofPoints: [],
      exclusions: [],
    },
    limits: {
      maxCompanies: 25,
      maxPagesPerCompany: 6,
      maxConcurrentJobs: 3,
      maxModelRequests: 8,
    },
    status: "active",
    createdAt: now,
    updatedAt: now,
  };
}

function mockAnalysisSeam(mock: MockModelAdapter): AnalysisSeam {
  return async (input, repo) => {
    const campaign = await repo.getRunCampaign(input.workspaceId, input.runId);
    if (!campaign) throw new Error("campaign missing");
    const core = await repo.getCompanyCore(input.workspaceId, input.companyId);
    if (!core) throw new Error("company missing");
    const evidence = await repo.getCompanyEvidence(input.workspaceId, input.companyId);
    return analyzeCompany(
      {
        workspaceId: input.workspaceId,
        runId: input.runId,
        companyId: input.companyId,
        domain: input.domain,
        companyName: core.name,
        campaign: { offer: campaign.offer, limits: campaign.limits },
        evidence,
        hubspotEvidence: core.hubspotEvidence,
      },
      {
        adapter: mock,
        attempt: input.attempt,
        reserveModelRequest: () =>
          repo.reserveModelRequests(
            input.workspaceId,
            input.runId,
            1,
            campaign.limits.maxModelRequests,
          ),
        recordAgentRun: (record) =>
          repo.recordAgentRun(input.workspaceId, input.runId, input.companyId, record),
      },
    );
  };
}

/** Idempotent collector: re-running a company replaces its evidence set. */
function collectingSeam(repo: InMemoryRepository): CollectorSeam {
  return async (company) => {
    repo.tables.evidence = repo.tables.evidence.filter(
      (e) => e.companyId !== company.companyId,
    );
    repo.tables.evidence.push(
      makeEvidence({
        companyId: company.companyId,
        url: `https://${company.domain}`,
        excerpt: "Fixture page text for the durability run.",
      }),
    );
  };
}

function setup(companyCount: number) {
  const users = makeTestUsers();
  const campaign = makeCampaign(users.workspaceA);
  users.repo.tables.campaigns.push(campaign);
  const runId = randomUUID();
  users.repo.tables.runs.push({
    id: runId,
    campaignId: campaign.id,
    workspaceId: users.workspaceA,
    status: "queued",
    idempotencyKey: `key-${runId}`,
    companiesTotal: companyCount,
    companiesReady: 0,
    companiesFailed: 0,
    modelRequestsUsed: 0,
    failures: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  const companyIds = Array.from({ length: companyCount }, () => {
    const id = randomUUID();
    users.repo.tables.companies.push({
      id,
      runId,
      campaignId: campaign.id,
      workspaceId: users.workspaceA,
      name: `co-${id.slice(0, 6)}`,
      domain: `co${id.slice(0, 6)}.example`,
      status: "queued",
      hubspotEvidence: null,
      score: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    return id;
  });
  return { users, campaign, runId, companyIds };
}

function fullMock(): MockModelAdapter {
  return new MockModelAdapter({
    positioning: (call) => ({
      summary: "Demo-led analytics product for revenue teams.",
      likelyBuyer: "Head of Revenue Operations.",
      businessModel: "Self-serve SaaS with sales assist.",
      icpFit: { level: "partial", reason: "Product shape matches; stage unverified." },
      findings: [
        {
          category: "conversion",
          observation: "The demo form requests many fields before a booking option.",
          // The analyst must cite collected evidence — pulled from the call.
          evidenceIds: call.evidence.map((e) => e.id).slice(0, 1),
          hypothesis: "Fewer first-step fields may raise completion.",
          recommendation: "Proposed: test a two-step form (validation needed).",
          confidence: "medium",
          ownerRole: "Marketing ops (proposed)",
          effort: "small",
          metric: "Demo-form completion rate baseline.",
        },
      ],
    }),
    funnel: () => ({}),
    outbound: () => ({
      proposedIcp: "B2B software teams with a demo-led motion.",
      offerAlignment: { level: "partial", reason: "Offer matches the observed motion." },
    }),
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
    writer: (call) => makePlanContent([call.evidence[0]?.id ?? ""]),
    reviewer: () => ({ verdict: "supported", claims: [], revisionNotes: "" }),
  });
}

describe("disconnect durability (check 11)", () => {
  it("enqueue → disconnect → workers finish later → reconnect shows completed progress", async () => {
    const { users, runId, companyIds } = setup(2);

    const enqueued: { id: string; domain: string }[] = [];
    const batch = await runBatch(
      { runId, workspaceId: users.workspaceA },
      users.repo,
      async (company) => {
        enqueued.push(company);
      },
    );
    expect(batch.dispatched).toBe(2);
    expect(users.repo.tables.runs[0].status).toBe("running");

    // ── The operator closes the browser here. Nothing below depends on it. ──
    // The worker runtime keeps going: each enqueued company job runs to its
    // terminal state through the collector + analysis stages.
    const mock = fullMock();
    for (const company of enqueued) {
      await runCompany(
        { runId, workspaceId: users.workspaceA, companyId: company.id, domain: company.domain },
        users.repo,
        collectingSeam(users.repo),
        mockAnalysisSeam(mock),
      );
    }

    // ── Reconnect: the run status endpoint's repository reads. ──
    const companies = await users.repo.getRunCompanies(users.workspaceA, runId);
    expect(companies.map((c) => c.status)).toEqual(["ready", "ready"]);
    const run = users.repo.tables.runs[0];
    expect(run.status).toBe("completed");
    expect(run.companiesReady).toBe(2);

    // Every observation in a plan still resolves to real persisted evidence.
    for (const company of companyIds) {
      const audit = await users.repo.getCompanyAudit(users.workspaceA, company);
      expect(audit?.accountPlan).not.toBeNull();
      expect(audit?.findings.length).toBeGreaterThan(0);
      expect(audit?.evidence.length).toBeGreaterThan(0);
    }
  });

  it("resuming a finished run re-dispatches nothing and keeps one record per company", async () => {
    const { users, runId, companyIds } = setup(2);
    const mock = fullMock();
    for (const companyId of companyIds) {
      await runCompany(
        {
          runId,
          workspaceId: users.workspaceA,
          companyId,
          domain: "resume.example",
        },
        users.repo,
        collectingSeam(users.repo),
        mockAnalysisSeam(mock),
      );
    }
    const before = users.repo.tables.companies.map((c) => `${c.id}:${c.status}`);

    const resume = await runBatch(
      { runId, workspaceId: users.workspaceA },
      users.repo,
      async () => {
        throw new Error("resume must not re-dispatch terminal companies");
      },
    );
    expect(resume.dispatched).toBe(0);
    expect(users.repo.tables.companies.map((c) => `${c.id}:${c.status}`)).toEqual(before);
  });
});

describe("retry idempotency (check 5)", () => {
  it("a retried company job leaves one company record, one plan, one export", async () => {
    const { users, runId, companyIds } = setup(1);
    const companyId = companyIds[0];
    const mock = fullMock();

    // Attempt 1: collection succeeds, analysis blows up (transient) → failed.
    await expect(
      runCompany(
        { runId, workspaceId: users.workspaceA, companyId, domain: "retry.example" },
        users.repo,
        collectingSeam(users.repo),
        async () => {
          throw new Error("provider 503");
        },
      ),
    ).rejects.toThrow("provider 503");
    expect((await users.repo.getRunCompanies(users.workspaceA, runId))[0].status).toBe("failed");

    // Attempt 2 (the retry): same payload, fresh seams.
    await runCompany(
      { runId, workspaceId: users.workspaceA, companyId, domain: "retry.example" },
      users.repo,
      collectingSeam(users.repo),
      mockAnalysisSeam(mock),
    );

    const companies = users.repo.tables.companies.filter((c) => c.id === companyId);
    expect(companies).toHaveLength(1);
    expect(companies[0].status).toBe("ready");
    expect(users.repo.tables.accountPlans).toHaveLength(1);
    // The idempotent collector replaced, not duplicated, the evidence set.
    expect(users.repo.tables.evidence.filter((e) => e.companyId === companyId)).toHaveLength(1);

    // Export creation is equally idempotent across retries.
    const first = await users.repo.getOrCreateExport(users.workspaceA, companyId, "pdf");
    const second = await users.repo.getOrCreateExport(users.workspaceA, companyId, "pdf");
    expect(second.id).toBe(first.id);
    expect(users.repo.tables.exports).toHaveLength(1);
  });

  it("cancelling a run stops the fan-out and leaves companies queued", async () => {
    const { users, runId } = setup(3);
    await users.repo.setRunStatus(users.workspaceA, runId, "cancelled");

    const enqueued: string[] = [];
    const batch = await runBatch(
      { runId, workspaceId: users.workspaceA },
      users.repo,
      async (company) => {
        enqueued.push(company.id);
      },
    );
    expect(batch).toEqual({ runId, status: "cancelled", dispatched: 0 });
    expect(enqueued).toEqual([]);
    expect(
      (await users.repo.getRunCompanies(users.workspaceA, runId)).every(
        (c) => c.status === "queued",
      ),
    ).toBe(true);
  });
});

describe("global model-request cap (brief §Execution settings)", () => {
  it("reserves are atomic against the run cap across parallel specialists", async () => {
    const { users, runId } = setup(1);
    users.repo.tables.runs[0].modelRequestsUsed = 7; // cap 8 → one slot left

    expect(await users.repo.reserveModelRequests(users.workspaceA, runId, 1, 8)).toBe(true);
    expect(
      await users.repo.reserveModelRequests(users.workspaceA, runId, 1, 8),
    ).toBe(false);
    expect(users.repo.tables.runs[0].modelRequestsUsed).toBe(8);
  });
});
