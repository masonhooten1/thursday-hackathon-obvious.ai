import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { randomUUID } from "node:crypto";
import { runCompany } from "@/trigger/run-company";
import { realCollectorSeam } from "@/trigger/seams";
import type { AnalysisSeam } from "@/trigger/seams";
import { analyzeCompany } from "@/lib/workers/analysis";
import { PostgresWorkerRepository } from "@/lib/repositories/worker";
import { MockModelAdapter } from "@/lib/ai/mock-adapter";
import { makePlanContent } from "./ai/helpers/fixtures";

/**
 * The integration checkpoint (spec §System shape, task: "one real company
 * through the full path with a mocked model adapter"). The REAL collector
 * seam — guarded fetch, selective render, network capture, HubSpot
 * detection, Postgres persistence — runs against a real public domain; the
 * model stages use the visibly labeled mock because no BYOK key exists in
 * this environment. Skipped unless SIGNALPLAN_LIVE_CHECKPOINT is set:
 * CI never depends on external network state, and the checkpoint is run
 * explicitly at integration time.
 *
 * Run locally with local Postgres:
 *   DATABASE_URL=postgresql://postgres:pgpass@127.0.0.1:5432/postgres \
 *   TEST_DATABASE_URL=postgresql://postgres:pgpass@127.0.0.1:5432/postgres \
 *   SIGNALPLAN_LIVE_CHECKPOINT=1 npx vitest run tests/checkpoint-live.test.ts
 */

const live = process.env.SIGNALPLAN_LIVE_CHECKPOINT === "1";
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? "";

describe.skipIf(!live)("live checkpoint — one real company end to end", () => {
  const scratchDb = `signalplan_checkpoint_${process.pid}`;
  const adminUrl = TEST_DATABASE_URL.replace(/\/[^/?]+(\?.*)?$/, "/postgres");
  const scratchUrl = TEST_DATABASE_URL.replace(/\/[^/?]+(\?.*)?$/, `/${scratchDb}`);
  const schema = readFileSync(path.resolve(__dirname, "../db/schema.sql"), "utf8");

  const workspaceId = randomUUID();
  const userId = randomUUID();
  const campaignId = randomUUID();
  const runId = randomUUID();
  const companyId = randomUUID();
  const domain = "compa.ai"; // Brief §Real research seeds — HubSpot loader fixture.

  let admin: Client;
  const timings: Record<string, number> = {};

  beforeAll(async () => {
    admin = new Client({ connectionString: adminUrl });
    await admin.connect();
    await admin.query(`drop database if exists ${scratchDb} with (force)`);
    await admin.query(`create database ${scratchDb}`);
    const setup = new Client({ connectionString: scratchUrl });
    await setup.connect();
    await setup.query(schema);
    await setup.query("insert into workspaces (id, name) values ($1, $2)", [
      workspaceId,
      "Live checkpoint",
    ]);
    await setup.query(
      "insert into workspace_members (workspace_id, user_id) values ($1, $2)",
      [workspaceId, userId],
    );
    await setup.query(
      "insert into campaigns (id, workspace_id, name, offer, limits) values ($1, $2, $3, $4, $5)",
      [
        campaignId,
        workspaceId,
        "Integration checkpoint",
        JSON.stringify({
          headline: "Marketing consulting for HubSpot teams adopting AI outbound.",
          idealCustomerProfile: "B2B AI software companies with a demo-led sales motion.",
        }),
        JSON.stringify({
          maxCompanies: 25,
          maxPagesPerCompany: 6,
          maxConcurrentJobs: 3,
          maxModelRequests: 8,
        }),
      ],
    );
    await setup.query(
      `insert into runs (id, campaign_id, workspace_id, status, idempotency_key,
         companies_total, companies_ready, companies_failed, model_requests_used, failures)
       values ($1, $2, $3, 'running', $4, 1, 0, 0, 0, '[]'::jsonb)`,
      [runId, campaignId, workspaceId, `checkpoint-${runId}`],
    );
    await setup.query(
      `insert into companies (id, run_id, campaign_id, workspace_id, name, domain, status)
       values ($1, $2, $3, $4, 'Compa (real checkpoint)', $5, 'queued')`,
      [companyId, runId, campaignId, workspaceId, domain],
    );
    await setup.end();
    // The pool is resolved lazily per call — point it at the scratch db.
    process.env.DATABASE_URL = scratchUrl;
  }, 60_000);

  afterAll(async () => {
    // Close the pool BEFORE dropping the scratch db — dropping under open
    // connections is what produced the 57P01 admin-shutdown noise.
    try {
      const { getPool } = await import("@/lib/data/db");
      await getPool().end();
    } catch {
      // pool may already be closed if the run failed early
    }
    await admin.query(`drop database if exists ${scratchDb} with (force)`);
    await admin.end();
  });

  /**
   * The analysis seam mirrors realAnalysisSeam except the adapter: the mock
   * stands in for the BYOK key this environment does not have. Everything
   * else — evidence bundle, budget gate, agent-run recording — is real.
   */
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

  it("collects real pages, detects HubSpot status, and produces a persisted plan", async () => {
    const repo = new PostgresWorkerRepository();
    const mock = new MockModelAdapter({
      positioning: (call) => ({
        summary: `Checkpoint fixture summary for ${call.evidence.length} evidence records.`,
        likelyBuyer: "Head of Revenue Operations.",
        businessModel: "Self-serve SaaS with sales assist.",
        icpFit: { level: "partial", reason: "Mock analysis — validation needed." },
      }),
      funnel: () => ({}),
      outbound: () => ({
        proposedIcp: "B2B software teams with a demo-led motion.",
        offerAlignment: { level: "partial", reason: "Mock analysis." },
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
        feasibility: { level: "partial", reason: "Mock analysis." },
      }),
      writer: (call) => makePlanContent(call.evidence.map((e) => e.id).slice(0, 1)),
      reviewer: () => ({ verdict: "supported", claims: [], revisionNotes: "" }),
    });

    const started = Date.now();
    let result: { companyId: string; status: string };
    try {
      result = await runCompany(
        { runId, workspaceId, companyId, domain },
        repo,
        realCollectorSeam(),
        mockAnalysisSeam(mock),
      );
    } catch (err) {
      // Dump the persisted specialist records — the failure reason lives in
      // the agent_runs error column, not in the rethrown summary.
      const pool = (await import("@/lib/data/db")).getPool();
      const runs = await pool.query(
        "select role, attempt, status, error from agent_runs where company_id = $1 order by started_at",
        [companyId],
      );
      console.log("agent runs:", JSON.stringify(runs.rows, null, 2));
      const caps = await pool.query(
        "select url, role, method, http_status, error from page_captures where company_id = $1",
        [companyId],
      );
      console.log("captures:", JSON.stringify(caps.rows, null, 2));
      throw err;
    }
    timings.totalMs = Date.now() - started;

    // The company reaches a terminal state — with the mock adapter it should
    // be ready; blocked would mean the real site refused collection, which
    // the assertion below surfaces honestly rather than hiding.
    const core = await repo.getCompanyCore(workspaceId, companyId);
    console.log("checkpoint timings:", JSON.stringify(timings));
    console.log(
      "company status:",
      core?.status,
      "hubspot:",
      core?.hubspotEvidence?.publicIntegration,
    );

    // Verify persisted output through the same tables the API audit read
    // serves: real evidence rows and a real account plan exist.
    const pool = (await import("@/lib/data/db")).getPool();
    const evidenceRows = await pool.query(
      "select count(*)::int as n from evidence where company_id = $1 and workspace_id = $2",
      [companyId, workspaceId],
    );
    const planRows = await pool.query(
      "select content from account_plans where company_id = $1 and workspace_id = $2",
      [companyId, workspaceId],
    );
    expect(evidenceRows.rows[0].n).toBeGreaterThan(0);
    expect(planRows.rows.length).toBeGreaterThan(0);
    expect(core?.hubspotEvidence?.publicIntegration).toBeDefined();

    if (result.status === "ready") {
      expect(core?.status).toBe("ready");
      // The mock writer labels itself — assert the plan landed with a real
      // diagnosis shape rather than fixture company copy.
      const plan = planRows.rows[0].content as {
        diagnosis?: { company?: string; likelyBuyer?: string };
      };
      expect(typeof plan.diagnosis?.company).toBe("string");
      expect(typeof plan.diagnosis?.likelyBuyer).toBe("string");
    } else {
      // Collection refused/blocked — the honest state, with the reason kept.
      expect(["blocked", "partial", "failed"]).toContain(result.status);
      expect(core?.status).toBe(result.status);
    }
  }, 300_000);
});
