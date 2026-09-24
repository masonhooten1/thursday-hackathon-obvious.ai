import "server-only";
import { randomUUID } from "node:crypto";
import type {
  AccountPlan,
  AgentRole,
  AgentRunStatus,
  Campaign,
  CompanyScore,
  CompanyStatus,
  Evidence,
  Finding,
  HubSpotEvidence,
  ReviewerVerdict,
  RunFailure,
  RunStatus,
} from "@/lib/contracts";
import { campaignLimitsInputSchema, sellerOfferInputSchema } from "@/lib/contracts";
import type { PoolClient } from "pg";
import { getPool } from "@/lib/data/db";
import { mapEvidenceRow } from "./postgres";

/**
 * Mutations and reads the worker tasks need. Workers run as the service role
 * — RLS is bypassed by role grants — so every method still filters by
 * workspace explicitly; service credentials must never become an excuse for
 * unscoped writes.
 */
export interface WorkerRepository {
  getRunCompanies(workspaceId: string, runId: string): Promise<
    { id: string; domain: string; name: string; status: CompanyStatus }[]
  >;
  setCompanyStatus(
    workspaceId: string,
    companyId: string,
    status: CompanyStatus,
    opts?: { error?: string },
  ): Promise<void>;
  setRunStatus(workspaceId: string, runId: string, status: RunStatus): Promise<void>;
  getRunStatus(workspaceId: string, runId: string): Promise<RunStatus | null>;
  getRunCampaign(workspaceId: string, runId: string): Promise<Campaign | null>;
  getCompanyCore(
    workspaceId: string,
    companyId: string,
  ): Promise<{
    id: string;
    name: string;
    domain: string;
    status: CompanyStatus;
    hubspotEvidence: HubSpotEvidence | null;
  } | null>;
  getCompanyEvidence(workspaceId: string, companyId: string): Promise<Evidence[]>;
  /**
   * Atomically reserve `count` model requests against the run's cap. False
   * means the reservation would exceed the cap (or the run is cancelled) —
   * never an overage, never a race.
   */
  reserveModelRequests(
    workspaceId: string,
    runId: string,
    count: number,
    cap: number,
  ): Promise<boolean>;
  /** Replace the company's findings — idempotent under retry (check 5). */
  saveFindings(workspaceId: string, companyId: string, findings: Finding[]): Promise<void>;
  /** Replace the company's active account plan — idempotent under retry. */
  saveAccountPlan(workspaceId: string, companyId: string, plan: AccountPlan): Promise<void>;
  saveCompanyScore(
    workspaceId: string,
    companyId: string,
    score: CompanyScore,
  ): Promise<void>;
  /**
   * One durable row per (company, role): a retried specialist replaces its
   * previous record instead of duplicating it.
   */
  recordAgentRun(
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
  ): Promise<void>;
  setExportStatus(
    workspaceId: string,
    exportId: string,
    update: { status: "ready" | "failed"; storageKey?: string; error?: string },
  ): Promise<void>;
  recordRunFailure(
    workspaceId: string,
    runId: string,
    failure: RunFailure,
  ): Promise<void>;
  refreshRunCounters(workspaceId: string, runId: string): Promise<void>;
}

export class PostgresWorkerRepository implements WorkerRepository {
  constructor(private readonly client: () => { query: PoolClient["query"] } = getPool) {}

  async getRunCompanies(workspaceId: string, runId: string) {
    const { rows } = await this.client().query(
      "select id, domain, name, status from companies where run_id = $1 and workspace_id = $2 order by created_at",
      [runId, workspaceId],
    );
    return rows.map((r) => ({
      id: String(r.id),
      domain: String(r.domain),
      name: String(r.name),
      status: String(r.status) as CompanyStatus,
    }));
  }

  async setCompanyStatus(
    workspaceId: string,
    companyId: string,
    status: CompanyStatus,
    opts?: { error?: string },
  ): Promise<void> {
    await this.client().query(
      "update companies set status = $3, error = $4, updated_at = now() where id = $1 and workspace_id = $2",
      [companyId, workspaceId, status, opts?.error ?? null],
    );
  }

  async setRunStatus(workspaceId: string, runId: string, status: RunStatus): Promise<void> {
    await this.client().query(
      "update runs set status = $3, updated_at = now() where id = $1 and workspace_id = $2",
      [runId, workspaceId, status],
    );
  }

  async getRunStatus(workspaceId: string, runId: string): Promise<RunStatus | null> {
    const { rows } = await this.client().query(
      "select status from runs where id = $1 and workspace_id = $2",
      [runId, workspaceId],
    );
    return rows[0] ? (String(rows[0].status) as RunStatus) : null;
  }

  async getRunCampaign(workspaceId: string, runId: string): Promise<Campaign | null> {
    const { rows } = await this.client().query(
      `select c.* from campaigns c
       join runs r on r.campaign_id = c.id
       where r.id = $1 and r.workspace_id = $2`,
      [runId, workspaceId],
    );
    if (!rows[0]) return null;
    const r = rows[0];
    return {
      id: String(r.id),
      workspaceId: String(r.workspace_id),
      name: String(r.name),
      // Re-validate at the boundary: a row written outside the API handler
      // (seed, migration) must still come back with contract defaults — the
      // prompt builder reads the optional array fields unconditionally.
      offer: sellerOfferInputSchema.parse(
        r.offer ?? { headline: "", idealCustomerProfile: "" },
      ),
      searchQuery: (r.search_query as string | null) ?? undefined,
      limits: campaignLimitsInputSchema.parse(r.limits ?? {}),
      status: String(r.status) as Campaign["status"],
      createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
      updatedAt: r.updated_at instanceof Date ? r.updated_at.toISOString() : String(r.updated_at),
    };
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
    const { rows } = await this.client().query(
      "select id, name, domain, status, hubspot_evidence from companies where id = $1 and workspace_id = $2",
      [companyId, workspaceId],
    );
    if (!rows[0]) return null;
    const r = rows[0];
    return {
      id: String(r.id),
      name: String(r.name),
      domain: String(r.domain),
      status: String(r.status) as CompanyStatus,
      hubspotEvidence: (r.hubspot_evidence as HubSpotEvidence | null) ?? null,
    };
  }

  async getCompanyEvidence(workspaceId: string, companyId: string): Promise<Evidence[]> {
    const { rows } = await this.client().query(
      "select * from evidence where company_id = $1 and workspace_id = $2 order by captured_at",
      [companyId, workspaceId],
    );
    return rows.map(mapEvidenceRow);
  }

  async reserveModelRequests(
    workspaceId: string,
    runId: string,
    count: number,
    cap: number,
  ): Promise<boolean> {
    const { rows } = await this.client().query(
      `update runs set model_requests_used = model_requests_used + $3, updated_at = now()
       where id = $1 and workspace_id = $2
         and status <> 'cancelled'
         and model_requests_used + $3 <= $4
       returning model_requests_used`,
      [runId, workspaceId, count, cap],
    );
    return rows.length > 0;
  }

  async saveFindings(workspaceId: string, companyId: string, findings: Finding[]): Promise<void> {
    const client = this.client();
    // Replace semantics: a retried analysis never duplicates findings (check 5).
    await client.query("delete from findings where company_id = $1 and workspace_id = $2", [
      companyId,
      workspaceId,
    ]);
    for (const finding of findings) {
      await client.query(
        `insert into findings
           (id, company_id, workspace_id, category, observation, evidence_ids, hypothesis,
            recommendation, confidence, validation_needed, owner_role, effort, metric)
         values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10::jsonb, $11, $12, $13)`,
        [
          finding.id,
          companyId,
          workspaceId,
          finding.category,
          finding.observation,
          JSON.stringify(finding.evidenceIds),
          finding.hypothesis,
          finding.recommendation,
          finding.confidence,
          JSON.stringify(finding.validationNeeded),
          finding.ownerRole,
          finding.effort,
          finding.metric,
        ],
      );
    }
  }

  async saveAccountPlan(workspaceId: string, companyId: string, plan: AccountPlan): Promise<void> {
    const client = this.client();
    await client.query("delete from account_plans where company_id = $1 and workspace_id = $2", [
      companyId,
      workspaceId,
    ]);
    await client.query(
      `insert into account_plans (id, company_id, workspace_id, version, status, content)
       values ($1, $2, $3, $4, $5, $6::jsonb)`,
      [plan.id, companyId, workspaceId, plan.version, plan.status, JSON.stringify(plan)],
    );
  }

  async saveCompanyScore(
    workspaceId: string,
    companyId: string,
    score: CompanyScore,
  ): Promise<void> {
    await this.client().query(
      "update companies set score = $3, updated_at = now() where id = $1 and workspace_id = $2",
      [companyId, workspaceId, JSON.stringify(score)],
    );
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
    const client = this.client();
    await client.query(
      "delete from agent_runs where company_id = $1 and workspace_id = $2 and role = $3",
      [companyId, workspaceId, record.role],
    );
    await client.query(
      `insert into agent_runs
         (id, run_id, company_id, workspace_id, role, status, attempt, verdict, error, started_at, finished_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        randomUUID(),
        runId,
        companyId,
        workspaceId,
        record.role,
        record.status,
        record.attempt,
        record.verdict ?? null,
        record.error ?? null,
        record.startedAt ?? null,
        record.finishedAt ?? null,
      ],
    );
  }

  async setExportStatus(
    workspaceId: string,
    exportId: string,
    update: { status: "ready" | "failed"; storageKey?: string; error?: string },
  ): Promise<void> {
    await this.client().query(
      `update exports set status = $3, storage_key = $4, error = $5,
         completed_at = case when $3 in ('ready', 'failed') then now() else completed_at end
       where id = $1 and workspace_id = $2`,
      [exportId, workspaceId, update.status, update.storageKey ?? null, update.error ?? null],
    );
  }

  async recordRunFailure(
    workspaceId: string,
    runId: string,
    failure: RunFailure,
  ): Promise<void> {
    await this.client().query(
      `update runs
       set failures = failures || $3::jsonb, updated_at = now()
       where id = $1 and workspace_id = $2`,
      [runId, workspaceId, JSON.stringify([failure])],
    );
  }

  async refreshRunCounters(workspaceId: string, runId: string): Promise<void> {
    await this.client().query(
      `update runs set
         companies_ready = (select count(*) from companies where run_id = runs.id and status = 'ready'),
         companies_failed = (select count(*) from companies where run_id = runs.id and status in ('failed', 'partial', 'blocked', 'cancelled')),
         updated_at = now()
       where id = $1 and workspace_id = $2`,
      [runId, workspaceId],
    );
  }
}
