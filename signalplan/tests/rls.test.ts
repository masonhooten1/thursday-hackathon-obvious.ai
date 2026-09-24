import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { randomUUID } from "node:crypto";

/**
 * Cross-user RLS test (acceptance check 9, database layer). Applies
 * db/schema.sql to a scratch database and connects the way Supabase does:
 * SET role authenticated + request.jwt.claims GUC per session.
 */

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? "";

if (!TEST_DATABASE_URL) {
  // Fail loudly — a silent skip would leave acceptance check 9 unverified.
  describe("RLS", () => {
    it("has a database to run against", () => {
      throw new Error(
        "TEST_DATABASE_URL is not set. Point it at a disposable Postgres: " +
          "TEST_DATABASE_URL=postgresql://<user>@127.0.0.1:5432/postgres npm test",
      );
    });
  });
} else {
  const scratchDb = `signalplan_rls_test_${process.pid}`;
  const adminUrl = TEST_DATABASE_URL.replace(/\/[^/?]+(\?.*)?$/, "/postgres");
  const scratchUrl = TEST_DATABASE_URL.replace(/\/[^/?]+(\?.*)?$/, `/${scratchDb}`);

  const schema = readFileSync(path.resolve(__dirname, "../db/schema.sql"), "utf8");

  let admin: Client;
  let userA: Client;
  let userB: Client;
  let service: Client;
  const userIdA = randomUUID();
  const userIdB = randomUUID();
  let workspaceA: string;
  let workspaceB: string;
  let campaignA: string;
  let runA: string;
  let companyA: string;

  async function connectAs(url: string): Promise<Client> {
    const c = new Client({ connectionString: url });
    await c.connect();
    return c;
  }

  beforeAll(async () => {
    admin = await connectAs(adminUrl);
    await admin.query(`drop database if exists ${scratchDb} with (force)`);
    await admin.query(`create database ${scratchDb}`);

    const setup = await connectAs(scratchUrl);
    await setup.query(schema);
    // Seed workspaces as the table owner (owner bypass mirrors the Supabase
    // postgres role used by service code).
    workspaceA = randomUUID();
    workspaceB = randomUUID();
    await setup.query("insert into workspaces (id, name) values ($1, $2), ($3, $4)", [
      workspaceA,
      "Workspace A",
      workspaceB,
      "Workspace B",
    ]);
    await setup.query(
      "insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner'), ($3, $4, 'owner')",
      [workspaceA, userIdA, workspaceB, userIdB],
    );
    await setup.end();

    userA = await connectAs(scratchUrl);
    userB = await connectAs(scratchUrl);
    service = await connectAs(scratchUrl);
    for (const [client, uid] of [
      [userA, userIdA],
      [userB, userIdB],
    ] as const) {
      await client.query("set role authenticated");
      await client.query("select set_config('request.jwt.claims', $1, false)", [
        JSON.stringify({ sub: uid, email: "x@example.com", aud: "authenticated" }),
      ]);
    }
    await service.query("set role service_role");

    // Workspace A: campaign → run → company chain for cross-user probes.
    await userA.query(
      "insert into campaigns (id, workspace_id, name, offer, limits) values ($1, $2, 'A campaign', $3, $4)",
      [
        (campaignA = randomUUID()),
        workspaceA,
        JSON.stringify({ headline: "h", idealCustomerProfile: "icp" }),
        JSON.stringify({ maxCompanies: 25, maxPagesPerCompany: 6, maxConcurrentJobs: 3, maxModelRequests: 8 }),
      ],
    );
    await userA.query(
      "insert into runs (id, campaign_id, workspace_id, idempotency_key) values ($1, $2, $3, $4)",
      [(runA = randomUUID()), campaignA, workspaceA, "rls-test-run-key-1"],
    );
    await userA.query(
      "insert into companies (id, run_id, campaign_id, workspace_id, name, domain) values ($1, $2, $3, $4, 'A Co', 'aco.example')",
      [(companyA = randomUUID()), runA, campaignA, workspaceA],
    );
  });

  afterAll(async () => {
    for (const c of [userA, userB, service, admin]) {
      await c?.end().catch(() => undefined);
    }
    const cleanup = new Client({ connectionString: adminUrl });
    await cleanup.connect();
    await cleanup.query(`drop database if exists ${scratchDb} with (force)`);
    await cleanup.end();
  });

  describe("authenticated sessions", () => {
    it("can read rows in their own workspace", async () => {
      const read = await userA.query("select name from campaigns where id = $1", [campaignA]);
      expect(read.rows[0].name).toBe("A campaign");
    });

    it("cannot select another workspace's rows", async () => {
      const own = await userB.query("select id from companies where id = $1", [companyA]);
      expect(own.rows).toHaveLength(0);
    });

    it("cannot update rows in another workspace", async () => {
      const crossed = await userB.query(
        "update companies set name = 'hijacked' where id = $1",
        [companyA],
      );
      expect(crossed.rowCount).toBe(0);
      const unchanged = await userA.query("select name from companies where id = $1", [
        companyA,
      ]);
      expect(unchanged.rows[0].name).toBe("A Co");
    });

    it("cannot insert rows into another workspace", async () => {
      await expect(
        userB.query(
          "insert into evidence (id, company_id, workspace_id, url, captured_at, method, excerpt, limitations) values (gen_random_uuid(), $1, $2, 'https://aco.example', now(), 'html', 'x', '[]'::jsonb)",
          [companyA, workspaceA],
        ),
      ).rejects.toThrow(/row-level security/i);
    });

    it("cannot create runs in another workspace's campaign", async () => {
      await expect(
        userB.query(
          "insert into runs (campaign_id, workspace_id, idempotency_key) values ($1, $2, $3)",
          [campaignA, workspaceB, "cross-workspace-key"],
        ),
      ).rejects.toThrow(/row-level security/i);
    });
  });

  describe("service role", () => {
    it("bypasses RLS the way the Supabase service role does (workers read/write directly)", async () => {
      const all = await service.query("select count(*)::int as n from companies");
      expect(all.rows[0].n).toBeGreaterThan(0);
    });
  });
}
