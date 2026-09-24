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

/**
 * Workspace-scoped persistence interface for the API routes. The production
 * implementation writes through to Postgres (with RLS as the second layer —
 * every query already filters by workspace); tests run the same route logic
 * against an in-memory implementation.
 */
export interface CompanyAuditBundle {
  company: Company;
  evidence: Evidence[];
  findings: Finding[];
  signals: TechnologySignal[];
  captures: PageCapture[];
  accountPlan: AccountPlan | null;
}

export interface CreateRunResult {
  run: Run;
  /** False when an existing run with the same idempotency key was returned. */
  created: boolean;
}

export interface SignalPlanRepository {
  listWorkspaceIdsForUser(userId: string): Promise<string[]>;

  createCampaign(input: Campaign): Promise<Campaign>;
  getCampaign(workspaceId: string, campaignId: string): Promise<Campaign | null>;
  listCampaigns(workspaceId: string): Promise<Campaign[]>;

  /**
   * Idempotent run creation keyed by (campaignId, idempotencyKey): repeating
   * the same key returns the original run and must not create companies or
   * enqueue work twice (acceptance check 5).
   */
  createRun(input: {
    campaign: Campaign;
    idempotencyKey: string;
    domains: string[];
    runId: string;
  }): Promise<CreateRunResult>;
  getRun(workspaceId: string, runId: string): Promise<Run | null>;
  listRunCompanies(workspaceId: string, runId: string): Promise<Company[]>;
  cancelRun(workspaceId: string, runId: string): Promise<Run | null>;

  getCompany(workspaceId: string, companyId: string): Promise<Company | null>;
  getCompanyAudit(
    workspaceId: string,
    companyId: string,
  ): Promise<CompanyAuditBundle | null>;

  /** Get-or-create per (companyId, kind); a failed export is replaced. */
  getOrCreateExport(workspaceId: string, companyId: string, kind: ExportKind): Promise<Export>;

  getModelSettings(workspaceId: string): Promise<WorkspaceSettingsRecord | null>;
  saveModelSettings(workspaceId: string, record: WorkspaceSettingsRecord): Promise<void>;
}
