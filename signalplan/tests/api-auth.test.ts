import { beforeEach, describe, expect, it } from "vitest";
import { createCampaignsRoutes } from "@/app/api/_handlers/campaigns";
import { createCampaignRunsRoutes } from "@/app/api/_handlers/campaign-runs";
import { createRunCancelRoutes, createRunStatusRoutes } from "@/app/api/_handlers/run-status";
import { createCompanyAuditRoutes } from "@/app/api/_handlers/company-audit";
import { createCompanyExportRoutes } from "@/app/api/_handlers/company-export";
import { createSettingsRoutes } from "@/app/api/_handlers/settings";
import { authedRequest, makeTestUsers, stubSessionStore, type TestUsers } from "./helpers/session-stubs";
import type { RouteDeps } from "@/app/api/_handlers/shared";
import type { Campaign } from "@/lib/contracts";

/**
 * Acceptance check 9 (API layer): logged-out requests cannot read data,
 * create jobs, or download reports; cross-user access is denied. Check 5:
 * run creation is idempotent. Check 8 (intake): unsafe domains never reach
 * the repository.
 */

let users: TestUsers;
let deps: RouteDeps;
const enqueuedRunIds: string[] = [];

beforeEach(() => {
  users = makeTestUsers();
  enqueuedRunIds.length = 0;
  deps = {
    sessionStore: stubSessionStore(users.tokens),
    repository: users.repo,
    enqueueRun: async (runId) => {
      enqueuedRunIds.push(runId);
    },
  };
});

const CAMPAIGNS_URL = "http://localhost:3000/api/campaigns";

async function createCampaign(token: string, workspaceId: string): Promise<Campaign> {
  const routes = createCampaignsRoutes(deps);
  const res = await routes.POST(
    authedRequest(CAMPAIGNS_URL, token, {
      method: "POST",
      workspaceId,
      body: {
        name: "AI outbound batch",
        offer: {
          headline: "Marketing consulting for HubSpot teams adopting AI outbound",
          idealCustomerProfile: "B2B AI software companies with a demo-led motion",
        },
      },
    }),
  );
  const text = await res.text();
  expect(res.status, text).toBe(201);
  return JSON.parse(text) as Campaign;
}

async function createRun(token: string, workspaceId: string, campaignId: string, body: unknown, key: string | null = "idem-key-1234567890") {
  const routes = createCampaignRunsRoutes(deps);
  // body's own idempotencyKey (if any) wins — spreading it first lets tests
  // override or omit the key to exercise the missing-key path.
  const payload = key === null ? body : { idempotencyKey: key, ...(body as object) };
  return routes.POST(
    authedRequest(`http://localhost:3000/api/campaigns/${campaignId}/runs`, token, {
      method: "POST",
      workspaceId,
      body: payload,
    }),
    { params: Promise.resolve({ id: campaignId }) },
  );
}

describe("authentication (acceptance check 9)", () => {
  it("rejects logged-out requests on every endpoint", async () => {
    const campaign = await createCampaign(users.tokenA, users.workspaceA);

    const probes: Promise<Response>[] = [
      createCampaignsRoutes(deps).POST(
        new Request(CAMPAIGNS_URL, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "x", offer: { headline: "h", idealCustomerProfile: "i" } }),
        }),
      ),
      createCampaignsRoutes(deps).GET(new Request(CAMPAIGNS_URL)),
      createRunStatusRoutes(deps).GET(new Request("http://localhost:3000/api/runs/xyz"), {
        params: Promise.resolve({ id: "xyz" }),
      }),
      createRunCancelRoutes(deps).POST(new Request("http://localhost:3000/api/runs/xyz/cancel", { method: "POST" }), {
        params: Promise.resolve({ id: "xyz" }),
      }),
      createCompanyAuditRoutes(deps).GET(new Request("http://localhost:3000/api/companies/xyz/audit"), {
        params: Promise.resolve({ id: "xyz" }),
      }),
      createCompanyExportRoutes(deps).POST(
        new Request("http://localhost:3000/api/companies/xyz/export", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ kind: "pdf" }),
        }),
        { params: Promise.resolve({ id: "xyz" }) },
      ),
      createSettingsRoutes(deps).GET(new Request("http://localhost:3000/api/settings")),
      createSettingsRoutes(deps).POST(
        new Request("http://localhost:3000/api/settings", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ provider: "openai", apiKey: "sk-test-12345" }),
        }),
      ),
    ];
    void campaign;

    for (const probe of probes) {
      const res = await probe;
      expect(res.status, `${res.url} logged out`).toBe(401);
    }
  });

  it("rejects invalid bearer tokens as 401, not 500", async () => {
    const res = await createCampaignsRoutes(deps).GET(
      authedRequest(CAMPAIGNS_URL, "invalid"),
    );
    expect(res.status).toBe(401);
  });

  it("denies cross-user access with 404 (existence not disclosed)", async () => {
    const campaign = await createCampaign(users.tokenA, users.workspaceA);

    const listRes = await createCampaignsRoutes(deps).GET(
      authedRequest(CAMPAIGNS_URL, users.tokenB, { workspaceId: users.workspaceA }),
    );
    expect(listRes.status).toBe(404);

    const runRes = await createRun(
      users.tokenB,
      users.workspaceA,
      campaign.id,
      { domains: ["example.com"] },
    );
    expect(runRes.status).toBe(404);
  });

  it("rejects a workspace header the user does not belong to, allows their own", async () => {
    const res = await createCampaignsRoutes(deps).GET(
      authedRequest(CAMPAIGNS_URL, users.tokenB, { workspaceId: users.workspaceA }),
    );
    expect(res.status).toBe(404);

    const own = await createCampaignsRoutes(deps).GET(
      authedRequest(CAMPAIGNS_URL, users.tokenB, { workspaceId: users.workspaceB }),
    );
    expect(own.status).toBe(200);
    expect(await own.json()).toEqual([]);
  });
});

describe("run creation (acceptance checks 5 and 8)", () => {
  let campaign: Campaign;
  beforeEach(async () => {
    campaign = await createCampaign(users.tokenA, users.workspaceA);
  });

  it("creates a run with queued companies and enqueues worker work once", async () => {
    const res = await createRun(users.tokenA, users.workspaceA, campaign.id, {
      domains: ["https://example.com", "compa.ai", "WWW.Example.COM"],
    });
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.run.status).toBe("queued");
    expect(body.run.companiesTotal).toBe(3); // deduped case-insensitively; www. is distinct
    expect(enqueuedRunIds).toEqual([body.run.id]);

    const status = await createRunStatusRoutes(deps).GET(
      authedRequest(`http://localhost:3000/api/runs/${body.run.id}`, users.tokenA, {
        workspaceId: users.workspaceA,
      }),
      { params: Promise.resolve({ id: body.run.id }) },
    );
    const statusBody = await status.json();
    expect(statusBody.companies).toHaveLength(3);
    for (const company of statusBody.companies) {
      expect(company.status).toBe("queued");
    }
  });

  it("replays the original run for a repeated idempotency key without enqueueing again", async () => {
    const first = await createRun(users.tokenA, users.workspaceA, campaign.id, {
      domains: ["example.com"],
    });
    expect(first.status).toBe(202);
    const second = await createRun(users.tokenA, users.workspaceA, campaign.id, {
      domains: ["example.com"],
    });
    expect(second.status).toBe(200);
    const secondBody = await second.json();
    expect(secondBody.idempotentReplay).toBe(true);
    expect(secondBody.run.id).toBe((await first.json()).run.id);
    expect(enqueuedRunIds).toHaveLength(1); // only the first creation enqueued

    const companies = await users.repo.listRunCompanies(users.workspaceA, secondBody.run.id);
    expect(companies).toHaveLength(1); // no duplicate company rows
  });

  it("requires an idempotency key (absent or too short both fail)", async () => {
    for (const bad of [null, "short"]) {
      const res = await createRun(
        users.tokenA,
        users.workspaceA,
        campaign.id,
        { domains: ["example.com"] },
        bad as string | null,
      );
      expect(res.status, `key=${String(bad)}`).toBe(400);
    }
    expect(users.repo.tables.runs).toHaveLength(0);
  });

  it("returns 400 when every domain fails intake validation", async () => {
    const res = await createRun(users.tokenA, users.workspaceA, campaign.id, {
      domains: ["169.254.169.254", "localhost", "metadata.google.internal"],
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.details).toHaveLength(3);
    expect(users.repo.tables.runs).toHaveLength(0);
  });

  it("creates the run with valid domains and records invalid ones as failures", async () => {
    const res = await createRun(users.tokenA, users.workspaceA, campaign.id, {
      domains: ["example.com", "10.0.0.1"],
    });
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.run.companiesTotal).toBe(1);
    expect(body.intake).toEqual([
      { domain: "example.com" },
      { domain: "10.0.0.1", error: expect.stringContaining("IP address") },
    ]);
  });

  it("runs stay visible after disconnects (durable progress, check 11 shape)", async () => {
    const created = await createRun(users.tokenA, users.workspaceA, campaign.id, {
      domains: ["example.com"],
    });
    const run = (await created.json()).run;
    // Reconnect with a different token instance later — same data path:
    const again = await createRunStatusRoutes(deps).GET(
      authedRequest(`http://localhost:3000/api/runs/${run.id}`, users.tokenA, {
        workspaceId: users.workspaceA,
      }),
      { params: Promise.resolve({ id: run.id }) },
    );
    expect(again.status).toBe(200);
  });
});

describe("cancel endpoint", () => {
  it("cancels a queued run and its companies", async () => {
    const campaign = await createCampaign(users.tokenA, users.workspaceA);
    const created = await createRun(users.tokenA, users.workspaceA, campaign.id, {
      domains: ["example.com", "hex.tech"],
    });
    const run = (await created.json()).run;

    const res = await createRunCancelRoutes(deps).POST(
      authedRequest(`http://localhost:3000/api/runs/${run.id}/cancel`, users.tokenA, {
        method: "POST",
        workspaceId: users.workspaceA,
      }),
      { params: Promise.resolve({ id: run.id }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.run.status).toBe("cancelled");
    const companies = await users.repo.listRunCompanies(users.workspaceA, run.id);
    expect(companies.every((c) => c.status === "cancelled")).toBe(true);
  });
});

describe("BYOK settings (acceptance check 10)", () => {
  it("saves a key server-side and returns metadata only, never key material", async () => {
    const routes = createSettingsRoutes(deps);
    const saveRes = await routes.POST(
      authedRequest("http://localhost:3000/api/settings", users.tokenA, {
        method: "POST",
        workspaceId: users.workspaceA,
        body: { provider: "anthropic", apiKey: "sk-ant-secret-value-123456" },
      }),
    );
    expect(saveRes.status).toBe(201);
    const saved = await saveRes.json();
    expect(saved.provider).toBe("anthropic");
    expect(saved.keyLastFour).toBe("3456");
    expect(JSON.stringify(saved)).not.toContain("sk-ant");

    const getRes = await routes.GET(
      authedRequest("http://localhost:3000/api/settings", users.tokenA, {
        workspaceId: users.workspaceA,
      }),
    );
    const meta = await getRes.json();
    expect(meta).toEqual(saved);
    // The stored record holds the ciphertext; plaintext never sits in the table.
    const record = await users.repo.getModelSettings(users.workspaceA);
    expect(record?.encryptedKey).toBeDefined();
    expect(record?.encryptedKey).not.toContain("sk-ant-secret");
  });

  it("keeps workspaces isolated", async () => {
    const routes = createSettingsRoutes(deps);
    await routes.POST(
      authedRequest("http://localhost:3000/api/settings", users.tokenA, {
        method: "POST",
        workspaceId: users.workspaceA,
        body: { provider: "openai", apiKey: "sk-workspace-a-key" },
      }),
    );
    const other = await routes.GET(
      authedRequest("http://localhost:3000/api/settings", users.tokenB, {
        workspaceId: users.workspaceB,
      }),
    );
    const meta = await other.json();
    expect(meta.provider).toBeNull();
    expect(meta.keyLastFour).toBeNull();
  });
});

describe("export get-or-create (acceptance check 5)", () => {
  it("returns the same export on repeated requests", async () => {
    const campaign = await createCampaign(users.tokenA, users.workspaceA);
    const runRes = await createRun(users.tokenA, users.workspaceA, campaign.id, {
      domains: ["example.com"],
    });
    const run = (await runRes.json()).run;
    const companies = await users.repo.listRunCompanies(users.workspaceA, run.id);
    expect(companies.length).toBeGreaterThan(0);
    const companyId = companies[0].id;

    const routes = createCompanyExportRoutes(deps);
    const ctx = { params: Promise.resolve({ id: companyId }) };
    const first = await routes.POST(
      authedRequest(`http://localhost:3000/api/companies/${companyId}/export`, users.tokenA, {
        method: "POST",
        workspaceId: users.workspaceA,
        body: { kind: "pdf" },
      }),
      ctx,
    );
    expect(first.status).toBe(202);
    const second = await routes.POST(
      authedRequest(`http://localhost:3000/api/companies/${companyId}/export`, users.tokenA, {
        method: "POST",
        workspaceId: users.workspaceA,
        body: { kind: "pdf" },
      }),
      ctx,
    );
    // Still pending — the worker fills it in later — but crucially the SAME
    // export: retry/resume never duplicates (acceptance check 5).
    expect(second.status).toBe(202);
    expect((await first.json()).id).toBe((await second.json()).id);
    expect(users.repo.tables.exports).toHaveLength(1);
  });
});
