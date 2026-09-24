import type { Campaign, Company, CreateCampaignInput, CreateRunInput, Export, ExportKind, ModelSettingsMetadata, Run } from "@/lib/contracts";
import type { CompanyAuditBundle } from "@/lib/repositories/types";

/**
 * The exact company shape GET /api/runs/:id returns (app/api/_handlers/
 * run-status.ts) — the board renders only what that endpoint provides. Live
 * mode has no strongest-opportunity or review status until the intelligence
 * module lands; those columns stay empty rather than invented.
 */
export interface RunStatusCompany {
  id: string;
  name: string;
  domain: string;
  status: Company["status"];
  hubspotEvidence: Company["hubspotEvidence"];
  score: Company["score"];
}

export interface RunStatusPayload {
  run: Run;
  companies: RunStatusCompany[];
}

export interface RunStatusSource {
  getRunStatus(runId: string): Promise<RunStatusPayload>;
  cancelRun(runId: string): Promise<Run>;
}

export interface AuditSource {
  getCompanyAudit(companyId: string): Promise<CompanyAuditBundle | null>;
}

export interface ExportSource {
  /** Get-or-create per (companyId, kind) — the server owns dedup. */
  requestExport(companyId: string, kind: ExportKind): Promise<Export>;
}

export interface SettingsSource {
  get(): Promise<ModelSettingsMetadata>;
  save(provider: ModelSettingsMetadata["provider"], apiKey: string): Promise<ModelSettingsMetadata>;
}

/** Campaign + run creation (POST /api/campaigns, POST /api/campaigns/:id/runs). */
export interface CampaignSource {
  createCampaign(input: CreateCampaignInput): Promise<Campaign>;
  createRun(campaignId: string, input: CreateRunInput): Promise<Run>;
}

export interface DataSources {
  provenance: "live" | "fixture";
  campaign: CampaignSource;
  runStatus: RunStatusSource;
  audit: AuditSource;
  export: ExportSource;
  settings: SettingsSource;
}
