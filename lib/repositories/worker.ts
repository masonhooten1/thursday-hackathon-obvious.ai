import "server-only";
import type { CompanyStatus, RunFailure, RunStatus } from "@/lib/contracts";
import type { PoolClient } from "pg";
import { getPool } from "@/lib/data/db";

/**
 * Mutations workers need. Workers run as the service role — RLS is bypassed
 * by role grants — so every method still filters by workspace explicitly;
 * service credentials must never become an excuse for unscoped writes.
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
