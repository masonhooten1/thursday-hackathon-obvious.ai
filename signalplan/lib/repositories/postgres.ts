import "server-only";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type {
  AccountPlan,
  Campaign,
  Company,
  Evidence,
  Export,
  ExportKind,
  Finding,
  PageCapture,
  Run,
  TechnologySignal,
  WorkspaceSettingsRecord,
} from "@/lib/contracts";
import { dedupeDomains } from "@/lib/contracts";
import { getPool } from "@/lib/data/db";
import type { CompanyAuditBundle, SignalPlanRepository } from "./types";

/**
 * Postgres persistence (Supabase Postgres in production, local Postgres in
 * dev). Every query filters by workspace_id — RLS is the second layer, not
 * the only one. Workers reach the same tables through the service-role
 * connection; this module is what authenticated API routes use.
 */

type Row = Record<string, unknown>;

function str(v: unknown): string {
  return typeof v === "string" ? v : String(v);
}

function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.map(str) : [];
}

function iso(v: unknown): string {
  return v instanceof Date ? v.toISOString() : new Date(str(v)).toISOString();
}

function mapCampaign(r: Row): Campaign {
  return {
    id: str(r.id),
    workspaceId: str(r.workspace_id),
    name: str(r.name),
    offer: (r.offer as Campaign["offer"]) ?? { headline: "", idealCustomerProfile: "" },
    searchQuery: (r.search_query as string | null) ?? undefined,
    limits: (r.limits as Campaign["limits"]) ?? undefined,
    status: str(r.status) as Campaign["status"],
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

function mapRun(r: Row): Run {
  return {
    id: str(r.id),
    campaignId: str(r.campaign_id),
    workspaceId: str(r.workspace_id),
    status: str(r.status) as Run["status"],
    idempotencyKey: str(r.idempotency_key),
    companiesTotal: Number(r.companies_total ?? 0),
    companiesReady: Number(r.companies_ready ?? 0),
    companiesFailed: Number(r.companies_failed ?? 0),
    modelRequestsUsed: Number(r.model_requests_used ?? 0),
    failures: (r.failures as Run["failures"]) ?? [],
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

function mapCompany(r: Row): Company {
  return {
    id: str(r.id),
    runId: str(r.run_id),
    campaignId: str(r.campaign_id),
    workspaceId: str(r.workspace_id),
    name: str(r.name),
    domain: str(r.domain),
    status: str(r.status) as Company["status"],
    hubspotEvidence: (r.hubspot_evidence as Company["hubspotEvidence"]) ?? null,
    score: (r.score as Company["score"]) ?? null,
    error: (r.error as string | null) ?? undefined,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

/** Exported for the worker repository's evidence reads (same row shape). */
export function mapEvidenceRow(r: Row): Evidence {
  return {
    id: str(r.id),
    companyId: str(r.company_id),
    url: str(r.url),
    capturedAt: iso(r.captured_at),
    method: str(r.method) as Evidence["method"],
    locator: (r.locator as string | null) ?? undefined,
    excerpt: str(r.excerpt),
    snapshotRef: (r.snapshot_ref as string | null) ?? undefined,
    limitations: strArray(r.limitations),
  };
}

function mapEvidence(r: Row): Evidence {
  return mapEvidenceRow(r);
}

function mapFinding(r: Row): Finding {
  return {
    id: str(r.id),
    category: str(r.category) as Finding["category"],
    observation: str(r.observation),
    evidenceIds: strArray(r.evidence_ids),
    hypothesis: str(r.hypothesis),
    recommendation: str(r.recommendation),
    confidence: str(r.confidence) as Finding["confidence"],
    validationNeeded: strArray(r.validation_needed),
    ownerRole: str(r.owner_role),
    effort: str(r.effort) as Finding["effort"],
    metric: str(r.metric),
  };
}

function mapSignal(r: Row): TechnologySignal {
  return {
    id: str(r.id),
    companyId: str(r.company_id),
    vendor: str(r.vendor),
    signature: str(r.signature),
    pageUrl: (r.page_url as string | null) ?? undefined,
    method: str(r.method) as TechnologySignal["method"],
    integrationStatus: str(r.integration_status) as TechnologySignal["integrationStatus"],
    detectedAt: iso(r.detected_at),
    locator: (r.locator as string | null) ?? undefined,
    excerpt: (r.excerpt as string | null) ?? undefined,
    conflictingPortalIds: strArray(r.conflicting_portal_ids),
  };
}

function mapCapture(r: Row): PageCapture {
  return {
    id: str(r.id),
    companyId: str(r.company_id),
    url: str(r.url),
    role: str(r.role) as PageCapture["role"],
    method: str(r.method) as PageCapture["method"],
    httpStatus: r.http_status == null ? undefined : Number(r.http_status),
    capturedAt: iso(r.captured_at),
    visibleText: (r.visible_text as string | null) ?? undefined,
    snapshotRef: (r.snapshot_ref as string | null) ?? undefined,
    links: strArray(r.links),
    forms: (r.forms as PageCapture["forms"]) ?? [],
    runtimeObservations: strArray(r.runtime_observations),
    error: (r.error as string | null) ?? undefined,
    limitations: strArray(r.limitations),
  };
}

function mapPlan(r: Row): AccountPlan {
  // Column values win over anything stored inside the jsonb content — the
  // indexed columns are the source of truth for identity and status.
  return {
    ...(r.content as AccountPlan),
    id: str(r.id),
    companyId: str(r.company_id),
    workspaceId: str(r.workspace_id),
    version: Number(r.version ?? 1),
    status: str(r.status) as AccountPlan["status"],
  };
}

function mapExport(r: Row): Export {
  return {
    id: str(r.id),
    companyId: str(r.company_id),
    workspaceId: str(r.workspace_id),
    kind: str(r.kind) as ExportKind,
    status: str(r.status) as Export["status"],
    storageKey: (r.storage_key as string | null) ?? undefined,
    error: (r.error as string | null) ?? undefined,
    createdAt: iso(r.created_at),
    completedAt: r.completed_at == null ? undefined : iso(r.completed_at),
  };
}

export class PostgresRepository implements SignalPlanRepository {
  constructor(private readonly client: () => { query: PoolClient["query"] } = getPool) {}

  async listWorkspaceIdsForUser(userId: string): Promise<string[]> {
    const { rows } = await this.client().query(
      "select workspace_id from workspace_members where user_id = $1",
      [userId],
    );
    return rows.map((r) => str(r.workspace_id));
  }

  async createCampaign(input: Campaign): Promise<Campaign> {
    const { rows } = await this.client().query(
      `insert into campaigns (id, workspace_id, name, offer, search_query, limits, status)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [
        input.id,
        input.workspaceId,
        input.name,
        JSON.stringify(input.offer),
        input.searchQuery ?? null,
        input.limits ? JSON.stringify(input.limits) : null,
        input.status,
      ],
    );
    void rows;
    return input;
  }

  async getCampaign(workspaceId: string, campaignId: string): Promise<Campaign | null> {
    const { rows } = await this.client().query(
      "select * from campaigns where id = $1 and workspace_id = $2",
      [campaignId, workspaceId],
    );
    return rows[0] ? mapCampaign(rows[0]) : null;
  }

  async listCampaigns(workspaceId: string): Promise<Campaign[]> {
    const { rows } = await this.client().query(
      "select * from campaigns where workspace_id = $1 order by created_at desc",
      [workspaceId],
    );
    return rows.map(mapCampaign);
  }

  async createRun(input: {
    campaign: Campaign;
    idempotencyKey: string;
    domains: string[];
    runId: string;
  }): Promise<{ run: Run; created: boolean }> {
    const client = this.client();
    const domains = dedupeDomains(input.domains);
    const { rows } = await client.query(
      `insert into runs (id, campaign_id, workspace_id, idempotency_key, companies_total)
       values ($1, $2, $3, $4, $5)
       on conflict (campaign_id, idempotency_key) do nothing
       returning id`,
      [input.runId, input.campaign.id, input.campaign.workspaceId, input.idempotencyKey, domains.length],
    );
    if (rows[0] == null) {
      const existing = await client.query(
        "select * from runs where campaign_id = $1 and idempotency_key = $2",
        [input.campaign.id, input.idempotencyKey],
      );
      return { run: mapRun(existing.rows[0]), created: false };
    }
    const runRow = await client.query("select * from runs where id = $1", [input.runId]);

    for (const domain of domains) {
      await client.query(
        `insert into companies (id, run_id, campaign_id, workspace_id, name, domain, status)
         values ($1, $2, $3, $4, $5, $6, 'queued')
         on conflict (campaign_id, domain) do update
           set run_id = excluded.run_id, status = 'queued', updated_at = now()`,
        [randomUUID(), input.runId, input.campaign.id, input.campaign.workspaceId, domain, domain],
      );
    }
    return { run: mapRun(runRow.rows[0]), created: true };
  }

  async getRun(workspaceId: string, runId: string): Promise<Run | null> {
    const { rows } = await this.client().query(
      "select * from runs where id = $1 and workspace_id = $2",
      [runId, workspaceId],
    );
    return rows[0] ? mapRun(rows[0]) : null;
  }

  async listRunCompanies(workspaceId: string, runId: string): Promise<Company[]> {
    const { rows } = await this.client().query(
      "select * from companies where run_id = $1 and workspace_id = $2 order by created_at",
      [runId, workspaceId],
    );
    return rows.map(mapCompany);
  }

  async cancelRun(workspaceId: string, runId: string): Promise<Run | null> {
    const { rows } = await this.client().query(
      `update runs set status = 'cancelled'
       where id = $1 and workspace_id = $2 and status not in ('completed', 'cancelled')
       returning *`,
      [runId, workspaceId],
    );
    if (rows[0]) {
      await this.client().query(
        "update companies set status = 'cancelled' where run_id = $1 and workspace_id = $2 and status = 'queued'",
        [runId, workspaceId],
      );
      return mapRun(rows[0]);
    }
    return this.getRun(workspaceId, runId);
  }

  async getCompany(workspaceId: string, companyId: string): Promise<Company | null> {
    const { rows } = await this.client().query(
      "select * from companies where id = $1 and workspace_id = $2",
      [companyId, workspaceId],
    );
    return rows[0] ? mapCompany(rows[0]) : null;
  }

  async getCompanyAudit(
    workspaceId: string,
    companyId: string,
  ): Promise<CompanyAuditBundle | null> {
    const company = await this.getCompany(workspaceId, companyId);
    if (!company) return null;
    const [evidence, findings, signals, captures, plans] = await Promise.all([
      this.client().query(
        "select * from evidence where company_id = $1 and workspace_id = $2 order by captured_at desc",
        [companyId, workspaceId],
      ),
      this.client().query(
        "select * from findings where company_id = $1 and workspace_id = $2",
        [companyId, workspaceId],
      ),
      this.client().query(
        "select * from technology_signals where company_id = $1 and workspace_id = $2 order by detected_at desc",
        [companyId, workspaceId],
      ),
      this.client().query(
        "select * from page_captures where company_id = $1 and workspace_id = $2 order by captured_at desc",
        [companyId, workspaceId],
      ),
      this.client().query(
        "select * from account_plans where company_id = $1 and workspace_id = $2 order by version desc limit 1",
        [companyId, workspaceId],
      ),
    ]);
    return {
      company,
      evidence: evidence.rows.map(mapEvidence),
      findings: findings.rows.map(mapFinding),
      signals: signals.rows.map(mapSignal),
      captures: captures.rows.map(mapCapture),
      accountPlan: plans.rows[0] ? mapPlan(plans.rows[0]) : null,
    };
  }

  async getOrCreateExport(
    workspaceId: string,
    companyId: string,
    kind: ExportKind,
  ): Promise<Export> {
    const client = this.client();
    const existing = await client.query(
      `select * from exports
       where company_id = $1 and workspace_id = $2 and kind = $3 and status <> 'failed'
       order by created_at desc limit 1`,
      [companyId, workspaceId, kind],
    );
    if (existing.rows[0]) return mapExport(existing.rows[0]);
    // The partial unique index collapses concurrent retries to one export.
    const inserted = await client.query(
      `insert into exports (id, company_id, workspace_id, kind, status)
       values ($1, $2, $3, $4, 'pending')
       on conflict (company_id, kind) where status <> 'failed' do nothing
       returning *`,
      [randomUUID(), companyId, workspaceId, kind],
    );
    if (inserted.rows[0]) return mapExport(inserted.rows[0]);
    const raced = await client.query(
      `select * from exports
       where company_id = $1 and workspace_id = $2 and kind = $3 and status <> 'failed'
       order by created_at desc limit 1`,
      [companyId, workspaceId, kind],
    );
    if (raced.rows[0]) return mapExport(raced.rows[0]);
    throw new Error("Export creation failed without a race — refusing to proceed.");
  }

  async getModelSettings(workspaceId: string): Promise<WorkspaceSettingsRecord | null> {
    const { rows } = await this.client().query(
      "select * from workspace_settings where workspace_id = $1",
      [workspaceId],
    );
    if (!rows[0]) return null;
    const r = rows[0];
    return {
      workspaceId: str(r.workspace_id),
      provider: (r.provider as WorkspaceSettingsRecord["provider"] | null) ?? null,
      encryptedKey: (r.api_key_encrypted as string | null) ?? null,
      keyLastFour: (r.key_last_four as string | null) ?? null,
      updatedAt: r.updated_at == null ? null : iso(r.updated_at),
    };
  }

  async saveModelSettings(workspaceId: string, record: WorkspaceSettingsRecord): Promise<void> {
    await this.client().query(
      `insert into workspace_settings (workspace_id, provider, api_key_encrypted, key_last_four, updated_at)
       values ($1, $2, $3, $4, $5)
       on conflict (workspace_id) do update
         set provider = excluded.provider,
             api_key_encrypted = excluded.api_key_encrypted,
             key_last_four = excluded.key_last_four,
             updated_at = excluded.updated_at`,
      [workspaceId, record.provider, record.encryptedKey, record.keyLastFour, record.updatedAt],
    );
  }
}
