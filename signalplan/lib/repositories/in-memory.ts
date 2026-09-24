import "server-only";
import type {
  Campaign,
  Company,
  Export,
  Run,
  WorkspaceSettingsRecord,
} from "@/lib/contracts";
import { dedupeDomains } from "@/lib/contracts";
import type { CompanyStatus, RunFailure, RunStatus } from "@/lib/contracts";
import type { SignalPlanRepository } from "./types";
import type { WorkerRepository } from "./worker";

/**
 * In-memory repository used by route tests (and only there). Mirrors the
 * Postgres implementation's semantics — idempotency, get-or-create exports,
 * workspace scoping — without a database.
 */

export interface InMemoryTables {
  workspaces: { id: string; memberUserIds: string[] }[];
  campaigns: Campaign[];
  runs: Run[];
  companies: Company[];
  exports: Export[];
  settings: WorkspaceSettingsRecord[];
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class InMemoryRepository implements SignalPlanRepository, WorkerRepository {
  async getRunCompanies(workspaceId: string, runId: string) {
    return this.tables.companies
      .filter((c) => c.runId === runId && c.workspaceId === workspaceId)
      .map((c) => ({ id: c.id, domain: c.domain, name: c.name, status: c.status }));
  }

  async setCompanyStatus(
    workspaceId: string,
    companyId: string,
    status: CompanyStatus,
    opts?: { error?: string },
  ): Promise<void> {
    const company = this.tables.companies.find(
      (c) => c.id === companyId && c.workspaceId === workspaceId,
    );
    if (!company) return;
    company.status = status;
    company.error = opts?.error;
    company.updatedAt = new Date().toISOString();
  }

  async setRunStatus(workspaceId: string, runId: string, status: RunStatus): Promise<void> {
    const run = this.tables.runs.find((r) => r.id === runId && r.workspaceId === workspaceId);
    if (!run) return;
    run.status = status;
    run.updatedAt = new Date().toISOString();
  }

  async recordRunFailure(
    workspaceId: string,
    runId: string,
    failure: RunFailure,
  ): Promise<void> {
    const run = this.tables.runs.find((r) => r.id === runId && r.workspaceId === workspaceId);
    if (!run) return;
    run.failures.push(failure);
  }

  async refreshRunCounters(workspaceId: string, runId: string): Promise<void> {
    const run = this.tables.runs.find((r) => r.id === runId && r.workspaceId === workspaceId);
    if (!run) return;
    const companies = this.tables.companies.filter(
      (c) => c.runId === runId && c.workspaceId === workspaceId,
    );
    run.companiesReady = companies.filter((c) => c.status === "ready").length;
    run.companiesFailed = companies.filter((c) =>
      ["failed", "partial", "blocked", "cancelled"].includes(c.status),
    ).length;
  }

  constructor(public tables: InMemoryTables = {
    workspaces: [],
    campaigns: [],
    runs: [],
    companies: [],
    exports: [],
    settings: [],
  }) {}

  async listWorkspaceIdsForUser(userId: string): Promise<string[]> {
    return this.tables.workspaces
      .filter((w) => w.memberUserIds.includes(userId))
      .map((w) => w.id);
  }

  async createCampaign(input: Campaign): Promise<Campaign> {
    this.tables.campaigns.push(clone(input));
    return clone(input);
  }

  async getCampaign(workspaceId: string, campaignId: string): Promise<Campaign | null> {
    const found = this.tables.campaigns.find(
      (c) => c.id === campaignId && c.workspaceId === workspaceId,
    );
    return found ? clone(found) : null;
  }

  async listCampaigns(workspaceId: string): Promise<Campaign[]> {
    return clone(this.tables.campaigns.filter((c) => c.workspaceId === workspaceId));
  }

  async createRun(input: {
    campaign: Campaign;
    idempotencyKey: string;
    domains: string[];
    runId: string;
  }): Promise<{ run: Run; created: boolean }> {
    const existing = this.tables.runs.find(
      (r) =>
        r.campaignId === input.campaign.id && r.idempotencyKey === input.idempotencyKey,
    );
    if (existing) return { run: clone(existing), created: false };

    const run: Run = {
      id: input.runId,
      campaignId: input.campaign.id,
      workspaceId: input.campaign.workspaceId,
      status: "queued",
      idempotencyKey: input.idempotencyKey,
      companiesTotal: dedupeDomains(input.domains).length,
      companiesReady: 0,
      companiesFailed: 0,
      modelRequestsUsed: 0,
      failures: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.tables.runs.push(run);

    // Company rows are keyed by (campaignId, domain): retries never duplicate
    // a company. A new run re-links the company to itself (resume semantics).
    for (const domain of dedupeDomains(input.domains)) {
      const existingCompany = this.tables.companies.find(
        (c) => c.campaignId === input.campaign.id && c.domain === domain,
      );
      if (existingCompany) {
        existingCompany.runId = run.id;
      } else {
        this.tables.companies.push({
          id: crypto.randomUUID(),
          runId: run.id,
          campaignId: input.campaign.id,
          workspaceId: input.campaign.workspaceId,
          name: domain,
          domain,
          status: "queued",
          hubspotEvidence: null,
          score: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }
    }
    return { run: clone(run), created: true };
  }

  async getRun(workspaceId: string, runId: string): Promise<Run | null> {
    const found = this.tables.runs.find(
      (r) => r.id === runId && r.workspaceId === workspaceId,
    );
    return found ? clone(found) : null;
  }

  async listRunCompanies(workspaceId: string, runId: string): Promise<Company[]> {
    return clone(
      this.tables.companies.filter(
        (c) => c.runId === runId && c.workspaceId === workspaceId,
      ),
    );
  }

  async cancelRun(workspaceId: string, runId: string): Promise<Run | null> {
    const run = await this.getRun(workspaceId, runId);
    if (!run || run.status === "completed" || run.status === "cancelled") {
      return run;
    }
    run.status = "cancelled";
    for (const c of this.tables.companies) {
      if (c.runId === runId && c.workspaceId === workspaceId && c.status === "queued") {
        c.status = "cancelled";
      }
    }
    return run;
  }

  async getCompany(workspaceId: string, companyId: string): Promise<Company | null> {
    const found = this.tables.companies.find(
      (c) => c.id === companyId && c.workspaceId === workspaceId,
    );
    return found ? clone(found) : null;
  }

  async getCompanyAudit(): Promise<null> {
    // Audit bundles are produced by the intelligence module; the skeleton has
    // no captures or findings yet.
    return null;
  }

  async getOrCreateExport(
    workspaceId: string,
    companyId: string,
    kind: Export["kind"],
  ): Promise<Export> {
    const existing = this.tables.exports.find(
      (e) =>
        e.companyId === companyId &&
        e.workspaceId === workspaceId &&
        e.kind === kind &&
        e.status !== "failed",
    );
    if (existing) return clone(existing);
    const created: Export = {
      id: crypto.randomUUID(),
      companyId,
      workspaceId,
      kind,
      status: "pending",
      createdAt: new Date().toISOString(),
    };
    this.tables.exports.push(created);
    return clone(created);
  }

  async getModelSettings(workspaceId: string): Promise<WorkspaceSettingsRecord | null> {
    const found = this.tables.settings.find((s) => s.workspaceId === workspaceId);
    return found ? clone(found) : null;
  }

  async saveModelSettings(workspaceId: string, record: WorkspaceSettingsRecord): Promise<void> {
    const idx = this.tables.settings.findIndex((s) => s.workspaceId === workspaceId);
    if (idx >= 0) this.tables.settings[idx] = clone(record);
    else this.tables.settings.push(clone(record));
  }
}
