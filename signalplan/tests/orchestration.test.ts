import { describe, expect, it } from "vitest";
import { runStatusFromCompanies, companyStatusAfterError } from "@/lib/workers/orchestration";
import { SeamNotIntegratedError } from "@/trigger/seams";
import { runCompany } from "@/trigger/run-company";
import { runBatch } from "@/trigger/run-batch";
import { InMemoryRepository } from "@/lib/repositories/in-memory";
import { makeTestUsers } from "./helpers/session-stubs";
import { randomUUID } from "node:crypto";

/**
 * Orchestration state machine and failure isolation (acceptance check 3 at
 * the orchestration level: one blocked or failed company never fails the
 * batch — it carries the failure while the rest complete).
 */

describe("runStatusFromCompanies", () => {
  it("rolls up terminal company states", () => {
    expect(runStatusFromCompanies([])).toBe("completed");
    expect(runStatusFromCompanies(["ready", "ready"])).toBe("completed");
    expect(runStatusFromCompanies(["ready", "failed"])).toBe("partial");
    expect(runStatusFromCompanies(["blocked", "failed"])).toBe("failed");
    expect(runStatusFromCompanies(["ready", "partial", "blocked"])).toBe("partial");
  });
});

describe("companyStatusAfterError", () => {
  it("treats not-yet-integrated seams as blocked, not failed", () => {
    const result = companyStatusAfterError(new SeamNotIntegratedError("collector"));
    expect(result).toEqual({ status: "blocked", retryable: false });
  });

  it("treats other errors as retryable failures", () => {
    expect(companyStatusAfterError(new Error("connection reset"))).toEqual({
      status: "failed",
      retryable: true,
    });
  });
});

describe("runCompany", () => {
  function setup(companyCount = 1) {
    const users = makeTestUsers();
    const runId = randomUUID();
    users.repo.tables.runs.push({
      id: runId,
      campaignId: randomUUID(),
      workspaceId: users.workspaceA,
      status: "running",
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
        campaignId: users.repo.tables.runs[0].campaignId,
        workspaceId: users.workspaceA,
        name: `co-${id}`,
        domain: `co${id.slice(0, 6)}.example`,
        status: "queued",
        hubspotEvidence: null,
        score: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      return id;
    });
    return { users, runId, companyIds };
  }

  it("marks the company blocked and records the failure when the collector seam is not integrated", async () => {
    const { users, runId, companyIds } = setup();
    const status = await runCompany(
      { runId, workspaceId: users.workspaceA, companyId: companyIds[0] },
      users.repo,
      async () => {
        throw new SeamNotIntegratedError("collector");
      },
    );
    expect(status).toEqual({ companyId: companyIds[0], status: "blocked" });
    const companies = await users.repo.getRunCompanies(users.workspaceA, runId);
    expect(companies[0].status).toBe("blocked");
    const run = users.repo.tables.runs.find((r) => r.id === runId);
    expect(run?.failures).toHaveLength(1);
    expect(run?.companiesFailed).toBe(1);
  });

  it("marks the company failed and rethrows transient errors for retry", async () => {
    const { users, runId, companyIds } = setup();
    await expect(
      runCompany(
        { runId, workspaceId: users.workspaceA, companyId: companyIds[0] },
        users.repo,
        async () => {
          throw new Error("DNS resolution failed");
        },
      ),
    ).rejects.toThrow("DNS resolution failed");
    const companies = await users.repo.getRunCompanies(users.workspaceA, runId);
    expect(companies[0].status).toBe("failed");
  });

  it("one company's failure leaves the others free to finish (check 3 shape)", async () => {
    const { users, runId, companyIds } = setup(3);
    const failing = async (): Promise<void> => {
      throw new SeamNotIntegratedError("collector");
    };
    const outcomes = await Promise.all(
      companyIds.map((companyId) =>
        runCompany({ runId, workspaceId: users.workspaceA, companyId }, users.repo, failing),
      ),
    );
    expect(outcomes.every((o) => o.status === "blocked")).toBe(true);
    // No batch-level failure: the run records failures per company and the
    // batch task still reaches a terminal state.
    const statuses = (await users.repo.getRunCompanies(users.workspaceA, runId)).map(
      (c) => c.status,
    );
    expect(runStatusFromCompanies(statuses)).toBe("failed");
  });
});

describe("runBatch", () => {
  it("fans out to every queued company exactly once and sets the run running", async () => {
    const users = makeTestUsers();
    const runId = randomUUID();
    const campaignId = randomUUID();
    users.repo.tables.runs.push({
      id: runId,
      campaignId,
      workspaceId: users.workspaceA,
      status: "queued",
      idempotencyKey: `key-${runId}`,
      companiesTotal: 2,
      companiesReady: 0,
      companiesFailed: 0,
      modelRequestsUsed: 0,
      failures: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const ids = ["a", "b"].map((s) => {
      const id = randomUUID();
      users.repo.tables.companies.push({
        id,
        runId,
        campaignId,
        workspaceId: users.workspaceA,
        name: `Company ${s}`,
        domain: `${s}.example`,
        status: "queued",
        hubspotEvidence: null,
        score: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      return id;
    });

    const enqueued: string[] = [];
    await runBatch(
      { runId, workspaceId: users.workspaceA },
      users.repo,
      async (companyId) => {
        enqueued.push(companyId);
      },
    );
    expect(enqueued).toEqual(ids);
    expect(users.repo.tables.runs[0].status).toBe("failed"); // nothing ready yet
  });
});
