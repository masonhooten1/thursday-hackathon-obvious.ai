import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { randomUUID } from "node:crypto";
import { PostgresWorkerRepository } from "@/lib/repositories/worker";

/**
 * The worker repository's SQL against real Postgres — status transitions,
 * failure recording, and counter refresh are all worker-path writes the live
 * board depends on.
 */

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? "";

if (!TEST_DATABASE_URL) {
  describe("worker repository", () => {
    it("has a database to run against", () => {
      throw new Error("TEST_DATABASE_URL is not set — see tests/rls.test.ts.");
    });
  });
} else {
  const scratchDb = `signalplan_worker_test_${process.pid}`;
  const adminUrl = TEST_DATABASE_URL.replace(/\/[^/?]+(\?.*)?$/, "/postgres");
  const scratchUrl = TEST_DATABASE_URL.replace(/\/[^/?]+(\?.*)?$/, `/${scratchDb}`);
  const schema = readFileSync(path.resolve(__dirname, "../db/schema.sql"), "utf8");

  let admin: Client;
  const workspaceId = randomUUID();
  const userId = randomUUID();
  const campaignId = randomUUID();
  const runId = randomUUID();
  const companyIds = [randomUUID(), randomUUID(), randomUUID()];

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
      "Worker test",
    ]);
    await setup.query(
      "insert into workspace_members (workspace_id, user_id) values ($1, $2)",
      [workspaceId, userId],
    );
    await setup.query(
      "insert into campaigns (id, workspace_id, name, offer, limits) values ($1, $2, 'c', $3, $4)",
      [
        campaignId,
        workspaceId,
        JSON.stringify({ headline: "h", idealCustomerProfile: "i" }),
        JSON.stringify({ maxCompanies: 25, maxPagesPerCompany: 6, maxConcurrentJobs: 3, maxModelRequests: 8 }),
      ],
    );
    await setup.query(
      "insert into runs (id, campaign_id, workspace_id, idempotency_key, companies_total) values ($1, $2, $3, $4, 3)",
      [runId, campaignId, workspaceId, `worker-test-${runId}`],
    );
    for (const id of companyIds) {
      await setup.query(
        "insert into companies (id, run_id, campaign_id, workspace_id, name, domain) values ($1, $2, $3, $4, $5, $6)",
        [id, runId, campaignId, workspaceId, `co-${id.slice(0, 6)}`, `co${id.slice(0, 6)}.example`],
      );
    }
    await setup.end();
  });

  afterAll(async () => {
    await dbClient?.end().catch(() => undefined);
    await admin?.end();
    const cleanup = new Client({ connectionString: adminUrl });
    await cleanup.connect();
    await cleanup.query(`drop database if exists ${scratchDb} with (force)`);
    await cleanup.end();
  });

  let dbClient: Client;

  function repoForScratch(): PostgresWorkerRepository {
    // One connection, passed through the repository's client factory — the
    // same seam production uses with the pool.
    return new PostgresWorkerRepository(() => dbClient);
  }

  it("transitions company status and refreshes run counters", async () => {
    dbClient = new Client({ connectionString: scratchUrl });
    await dbClient.connect();
    const repo = repoForScratch();
    await repo.setRunStatus(workspaceId, runId, "running");
    await repo.setCompanyStatus(workspaceId, companyIds[0], "ready");
    await repo.setCompanyStatus(workspaceId, companyIds[1], "failed", {
      error: "timeout",
    });
    await repo.refreshRunCounters(workspaceId, runId);

    const { rows } = await dbClient.query(
      "select status, companies_ready, companies_failed from runs where id = $1",
      [runId],
    );
    expect(rows[0].status).toBe("running");
    expect(Number(rows[0].companies_ready)).toBe(1);
    expect(Number(rows[0].companies_failed)).toBe(1);
  });

  it("defaults an offer row stored without optional arrays (DB-boundary re-validation)", async () => {
    // Seed a second campaign whose offer JSON omits the optional arrays —
    // the shape a row gets when written outside the API handler.
    const bareCampaign = randomUUID();
    await dbClient.query(
      "insert into campaigns (id, workspace_id, name, offer, limits) values ($1, $2, 'bare', $3, $4)",
      [
        bareCampaign,
        workspaceId,
        JSON.stringify({ headline: "h", idealCustomerProfile: "i" }),
        JSON.stringify({ maxCompanies: 25, maxPagesPerCompany: 6, maxConcurrentJobs: 3, maxModelRequests: 8 }),
      ],
    );
    const bareRun = randomUUID();
    await dbClient.query(
      `insert into runs (id, campaign_id, workspace_id, status, idempotency_key,
         companies_total, companies_ready, companies_failed, model_requests_used, failures)
       values ($1, $2, $3, 'running', $4, 0, 0, 0, 0, '[]'::jsonb)`,
      [bareRun, bareCampaign, workspaceId, `bare-${bareRun}`],
    );

    const repo = repoForScratch();
    const campaign = await repo.getRunCampaign(workspaceId, bareRun);
    expect(campaign).not.toBeNull();
    // Contract defaults applied at the boundary — the prompt builder reads
    // the optional array fields unconditionally.
    expect(campaign?.offer.differentiators).toEqual([]);
    expect(campaign?.offer.proofPoints).toEqual([]);
    expect(campaign?.offer.exclusions).toEqual([]);
    expect(campaign?.limits?.maxModelRequests).toBe(8);
  });

  it("records run failures in order", async () => {
    const repo = repoForScratch();
    await repo.recordRunFailure(workspaceId, runId, {
      companyId: companyIds[1],
      stage: "failed",
      error: "timeout",
    });
    const { rows } = await dbClient.query(
      "select failures from runs where id = $1",
      [runId],
    );
    expect(rows[0].failures).toEqual([
      { companyId: companyIds[1], stage: "failed", error: "timeout" },
    ]);
  });
}
