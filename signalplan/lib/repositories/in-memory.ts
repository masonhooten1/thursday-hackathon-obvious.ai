import "server-only";
import type {
  AccountPlan,
  AgentRole,
  AgentRunStatus,
  Campaign,
  Company,
  CompanyScore,
  CompanyStatus,
  Evidence,
  Export,
  Finding,
  HubSpotEvidence,
  PageCapture,
  ReviewerVerdict,
  Run,
  RunFailure,
  RunStatus,
  TechnologySignal,
  WorkspaceSettingsRecord,
} from "@/lib/contracts";
import { dedupeDomains } from "@/lib/contracts";
import type { SignalPlanRepository } from "./types";
import type { WorkerRepository } from "./worker";

/**
 * In-memory repository used by route tests and the pipeline integration tests
 * (and only there). Mirrors the Postgres implementation's semantics —
 * idempotency, get-or-create exports, replace-on-retry writes, workspace
 * scoping — without a database.
 */

export interface InMemoryTables {
  workspaces: { id: string; memberUserIds: string[] }[];
  campaigns: Campaign[];
  runs: Run[];
  companies: Company[];
  evidence: Evidence[];
  /** Keyed by companyId — the Finding contract carries no workspace/company id. */
  findings: Record<string, Finding[]>;
  signals: TechnologySignal[];
  captures: PageCapture[];
  accountPlans: AccountPlan[];
  agentRuns: {
    id: string;
    runId: string;
    companyId: string;
    workspaceId: string;
    role: AgentRole;
    status: AgentRunStatus;
    attempt: number;
    verdict?: ReviewerVerdict;
    error?: string;
    startedAt?: string;
    finishedAt?: string;
  }[];
  exports: Export[];
  settings: WorkspaceSettingsRecord[];
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class InMemoryRepository implements SignalPlanRepository, WorkerRepository {
  /** True when the company row exists in this workspace (RLS-shaped scoping). */
  private companyInWorkspace(workspaceId: string, companyId: string): boolean {
    return this.tables.companies.some(
      (c) => c.id === companyId && c.workspaceId === workspaceId,
    );
  }

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

  async getRunStatus(workspaceId: string, runId: string): Promise<RunStatus | null> {
    const run = this.tables.runs.find((r) => r.id === runId && r.workspaceId === workspaceId);
    return run ? run.status : null;
  }

  async getRunCampaign(workspaceId: string, runId: string): Promise<Campaign | null> {
    const run = this.tables.runs.find((r) => r.id === runId && r.workspaceId === workspaceId);
    if (!run) return null;
    return this.getCampaign(workspaceId, run.campaignId);
  }

  async getCompanyCore(
    workspaceId: string,
    companyId: string,
  ): Promise<{
    id: string;
    name: string;
    domain: string;
    status: CompanyStatus;
    hubspotEvidence: HubSpotEvidence | null;
  } | null> {
    const company = this.tables.companies.find(
      (c) => c.id === companyId && c.workspaceId === workspaceId,
    );
    if (!company) return null;
    return {
      id: company.id,
      name: company.name,
      domain: company.domain,
      status: company.status,
      hubspotEvidence: company.hubspotEvidence,
    };
  }

  async getCompanyEvidence(workspaceId: string, companyId: string): Promise<Evidence[]> {
    if (!this.companyInWorkspace(workspaceId, companyId)) return [];
    return clone(this.tables.evidence.filter((e) => e.companyId === companyId));
  }

  async reserveModelRequests(
    workspaceId: string,
    runId: string,
    count: number,
    cap: number,
  ): Promise<boolean> {
    const run = this.tables.runs.find((r) => r.id === runId && r.workspaceId === workspaceId);
    if (!run || run.status === "cancelled") return false;
    if (run.modelRequestsUsed + count > cap) return false;
    run.modelRequestsUsed += count;
    run.updatedAt = new Date().toISOString();
    return true;
  }

  async saveFindings(workspaceId: string, companyId: string, findings: Finding[]): Promise<void> {
    if (!this.companyInWorkspace(workspaceId, companyId)) return;
    // Replace semantics: a retried analysis never duplicates findings (check 5).
    this.tables.findings[companyId] = findings.map(clone);
  }

  async saveAccountPlan(workspaceId: string, companyId: string, plan: AccountPlan): Promise<void> {
    if (!this.companyInWorkspace(workspaceId, companyId)) return;
    this.tables.accountPlans = this.tables.accountPlans.filter((p) => p.companyId !== companyId);
    this.tables.accountPlans.push(clone(plan));
  }

  async saveCompanyScore(
    workspaceId: string,
    companyId: string,
    score: CompanyScore,
  ): Promise<void> {
    const company = this.tables.companies.find(
      (c) => c.id === companyId && c.workspaceId === workspaceId,
    );
    if (!company) return;
    company.score = clone(score);
    company.updatedAt = new Date().toISOString();
  }

  async recordAgentRun(
    workspaceId: string,
    runId: string,
    companyId: string,
    record: {
      role: AgentRole;
      status: AgentRunStatus;
      attempt: number;
      verdict?: ReviewerVerdict;
      error?: string;
      startedAt?: string;
      finishedAt?: string;
    },
  ): Promise<void> {
    // One durable row per (company, role): a retried specialist replaces its
    // previous record instead of duplicating it (check 5).
    this.tables.agentRuns = this.tables.agentRuns.filter(
      (a) => !(a.companyId === companyId && a.workspaceId === workspaceId && a.role === record.role),
    );
    this.tables.agentRuns.push({
      id: crypto.randomUUID(),
      runId,
      companyId,
      workspaceId,
      ...clone(record),
    });
  }

  async setExportStatus(
    workspaceId: string,
    exportId: string,
    update: { status: "ready" | "failed"; storageKey?: string; error?: string },
  ): Promise<void> {
    const record = this.tables.exports.find(
      (e) => e.id === exportId && e.workspaceId === workspaceId,
    );
    if (!record) return;
    record.status = update.status;
    record.storageKey = update.storageKey;
    record.error = update.error;
    if (update.status === "ready" || update.status === "failed") {
      record.completedAt = new Date().toISOString();
    }
  }

  async recordRunFailure(
    workspaceId: string,
    runId: string,
    failure: RunFailure,
  ): Promise<void> {
    const run = this.tables.runs.find((r) => r.id === runId && r.workspaceId === workspaceId);
    if (!run) return;
    run.failures.push(clone(failure));
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

  tables: InMemoryTables;

  constructor(tables: Partial<InMemoryTables> = {}) {
    this.tables = {
      workspaces: [],
      campaigns: [],
      runs: [],
      companies: [],
      evidence: [],
      findings: {},
      signals: [],
      captures: [],
      accountPlans: [],
      agentRuns: [],
      exports: [],
      settings: [],
      ...tables,
    };
  }

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

  async getCompanyAudit(
    workspaceId: string,
    companyId: string,
  ): Promise<{
    company: Company;
    evidence: Evidence[];
    findings: Finding[];
    signals: TechnologySignal[];
    captures: PageCapture[];
    accountPlan: AccountPlan | null;
  } | null> {
    const company = await this.getCompany(workspaceId, companyId);
    if (!company) return null;
    return {
      company,
      evidence: clone(this.tables.evidence.filter((e) => e.companyId === companyId)),
      findings: clone(this.tables.findings[companyId] ?? []),
      signals: clone(this.tables.signals.filter((s) => s.companyId === companyId)),
      captures: clone(this.tables.captures.filter((c) => c.companyId === companyId)),
      accountPlan:
        clone(this.tables.accountPlans.find((p) => p.companyId === companyId)) ?? null,
    };
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
