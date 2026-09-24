/**
 * Integration seams for the Trigger.dev tasks. Everything real here: the
 * collector, the BYOK model adapter resolved from encrypted workspace
 * settings, and the run's model-request budget. Nothing fabricates evidence
 * or results — a missing key or unconfigured storage degrades to honest,
 * labeled states, never to invented output.
 */
import "server-only";
import { collectCompany, defaultCollectorOptions } from "@/workers/collector";
import type { CollectorCompany } from "@/workers/collector";
import { analyzeCompany, ModelUnavailableError } from "@/lib/workers/analysis";
import type { AnalysisOutcome } from "@/lib/workers/analysis";
import { createModelAdapter } from "@/lib/ai/adapter";
import type { ModelAdapter } from "@/lib/contracts";
import { decryptSecret } from "@/lib/data/encryption";
import { putSnapshot } from "@/lib/data/storage";
import { getPool } from "@/lib/data/db";
import type { WorkerRepository } from "@/lib/repositories/worker";

export class SeamNotIntegratedError extends Error {
  constructor(readonly seam: string) {
    super(`${seam} module is not yet integrated.`);
    this.name = "SeamNotIntegratedError";
  }
}

export type CompanyWork = CollectorCompany;

export type CollectorSeam = (company: CompanyWork) => Promise<void>;

export interface AnalysisSeamInput {
  workspaceId: string;
  runId: string;
  companyId: string;
  domain: string;
  name: string;
  /** Attempt number for agent-run records (Trigger.dev ctx.attempt.number). */
  attempt: number;
}

export type AnalysisSeam = (
  input: AnalysisSeamInput,
  repo: WorkerRepository,
) => Promise<AnalysisOutcome>;

interface SettingsRow {
  provider: string | null;
  encrypted_key: string | null;
}

/**
 * The real collector: bounded page selection, guarded HTML pass, selective
 * rendering, network-event capture, and signature detection, persisted
 * workspace-scoped. Snapshots go to private storage when configured;
 * otherwise evidence carries the honest "snapshot storage unavailable"
 * limitation. Blocking errors (SSRF guard, Postgres) propagate to the
 * company job's failure handling; per-page failures are captured as
 * limitations inside the collector.
 */
export function realCollectorSeam(): CollectorSeam {
  const options = {
    ...defaultCollectorOptions(),
    snapshotStore: {
      put: (
        workspaceId: string,
        companyId: string,
        captureId: string,
        content: string,
      ) => putSnapshot(workspaceId, companyId, captureId, content),
    },
  };
  return async (company) => {
    await collectCompany(company, options);
  };
}

/**
 * Resolve the BYOK adapter from the workspace's encrypted settings (spec
 * §The BYOK addition): the key is decrypted server-side, used only inside the
 * adapter, and never returned to a client or placed in model context. No key
 * configured → ModelUnavailableError, which the company job turns into an
 * honest `blocked` state with the deterministic (collection) results intact.
 */
async function resolveAdapter(workspaceId: string): Promise<ModelAdapter> {
  const pool = getPool();
  const { rows } = await pool.query<SettingsRow>(
    "select provider, encrypted_key from workspace_settings where workspace_id = $1",
    [workspaceId],
  );
  const row = rows[0];
  if (!row?.provider || !row.encrypted_key) {
    throw new ModelUnavailableError(
      "No model key configured for this workspace — deterministic collection results are kept; analysis stages are blocked until a key is saved in settings.",
    );
  }
  const apiKey = decryptSecret(row.encrypted_key);
  return createModelAdapter({ provider: row.provider as "openai" | "anthropic", apiKey });
}

/**
 * The real analysis stage: shared evidence bundle, three parallel analysts,
 * planner, then the writer/reviewer loop — every model call gated through the
 * run's atomic request budget (brief §Execution settings: cap of 8).
 */
export function realAnalysisSeam(): AnalysisSeam {
  return async (input, repo) => {
    const campaign = await repo.getRunCampaign(input.workspaceId, input.runId);
    if (!campaign) throw new SeamNotIntegratedError("Run context");
    const core = await repo.getCompanyCore(input.workspaceId, input.companyId);
    if (!core) throw new SeamNotIntegratedError("Company context");
    const evidence = await repo.getCompanyEvidence(input.workspaceId, input.companyId);

    const adapter = await resolveAdapter(input.workspaceId);
    const cap = campaign.limits.maxModelRequests;

    return analyzeCompany(
      {
        workspaceId: input.workspaceId,
        runId: input.runId,
        companyId: input.companyId,
        domain: input.domain,
        companyName: core.name,
        campaign: { offer: campaign.offer, limits: campaign.limits },
        evidence,
        hubspotEvidence: core.hubspotEvidence,
      },
      {
        adapter,
        attempt: input.attempt,
        reserveModelRequest: () =>
          repo.reserveModelRequests(input.workspaceId, input.runId, 1, cap),
        recordAgentRun: (record) =>
          repo.recordAgentRun(input.workspaceId, input.runId, input.companyId, record),
      },
    );
  };
}
