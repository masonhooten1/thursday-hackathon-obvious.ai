import "server-only";
import type { Evidence, HubSpotEvidence, PageCapture, TechnologySignal } from "@/lib/contracts";
import { getPool } from "@/lib/data/db";
import type { CollectorStore } from "./collect-company";

/**
 * Workspace-scoped persistence for collector output (spec §The four modules).
 * Workers run as the service role — RLS is bypassed by role grants — so every
 * statement still filters by workspace explicitly; service credentials must
 * never become an excuse for unscoped writes.
 */
export class PostgresCollectorStore implements CollectorStore {
  async savePageCaptures(workspaceId: string, companyId: string, captures: PageCapture[]): Promise<void> {
    if (captures.length === 0) return;
    const pool = getPool();
    for (const capture of captures) {
      await pool.query(
        `insert into page_captures
           (id, company_id, workspace_id, url, role, method, http_status, captured_at,
            visible_text, snapshot_ref, links, forms, runtime_observations, error, limitations)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, $13::jsonb, $14, $15::jsonb)
         on conflict (id) do update set
           visible_text = excluded.visible_text,
           snapshot_ref = excluded.snapshot_ref,
           error = excluded.error,
           limitations = excluded.limitations`,
        [
          capture.id,
          companyId,
          workspaceId,
          capture.url,
          capture.role,
          capture.method,
          capture.httpStatus ?? null,
          capture.capturedAt,
          capture.visibleText ?? null,
          capture.snapshotRef ?? null,
          JSON.stringify(capture.links),
          JSON.stringify(capture.forms),
          JSON.stringify(capture.runtimeObservations),
          capture.error ?? null,
          JSON.stringify(capture.limitations),
        ],
      );
    }
  }

  async saveTechnologySignals(workspaceId: string, companyId: string, signals: TechnologySignal[]): Promise<void> {
    if (signals.length === 0) return;
    const pool = getPool();
    for (const signal of signals) {
      await pool.query(
        `insert into technology_signals
           (id, company_id, workspace_id, vendor, signature, page_url, method,
            integration_status, detected_at, locator, excerpt, conflicting_portal_ids)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)
         on conflict (id) do nothing`,
        [
          signal.id,
          companyId,
          workspaceId,
          signal.vendor,
          signal.signature,
          signal.pageUrl ?? null,
          signal.method,
          signal.integrationStatus,
          signal.detectedAt,
          signal.locator ?? null,
          signal.excerpt ?? null,
          JSON.stringify(signal.conflictingPortalIds),
        ],
      );
    }
  }

  async saveEvidence(workspaceId: string, companyId: string, evidence: Evidence[]): Promise<void> {
    if (evidence.length === 0) return;
    const pool = getPool();
    for (const item of evidence) {
      await pool.query(
        `insert into evidence
           (id, company_id, workspace_id, url, captured_at, method, locator, excerpt, snapshot_ref, limitations)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
         on conflict (id) do nothing`,
        [
          item.id,
          companyId,
          workspaceId,
          item.url,
          item.capturedAt,
          item.method,
          item.locator ?? null,
          item.excerpt,
          item.snapshotRef ?? null,
          JSON.stringify(item.limitations),
        ],
      );
    }
  }

  async setCompanyHubspotEvidence(
    workspaceId: string,
    companyId: string,
    hubspotEvidence: HubSpotEvidence,
  ): Promise<void> {
    await getPool().query(
      "update companies set hubspot_evidence = $3, updated_at = now() where id = $1 and workspace_id = $2",
      [companyId, workspaceId, JSON.stringify(hubspotEvidence)],
    );
  }
}
