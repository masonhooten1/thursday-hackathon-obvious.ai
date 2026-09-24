import "server-only";
import { task } from "@trigger.dev/sdk/v3";
import { PostgresWorkerRepository } from "@/lib/repositories/worker";
import type { WorkerRepository } from "@/lib/repositories/worker";
import { realCollectorSeam } from "./seams";
import type { CollectorSeam } from "./seams";
import { companyStatusAfterError } from "@/lib/workers/orchestration";
import type { CompanyStatus } from "@/lib/contracts";

/**
 * run-company — one company's pipeline: queued → collecting → analyzing →
 * drafting → reviewing → ready (spec §Company lifecycle). Bounded by the
 * "company-jobs" queue (3 in flight by default — brief §Execution settings).
 *
 * Failure isolation (check 3): a blocked domain, timeout, or failed
 * specialist marks THIS company failed (retried by the worker runtime for
 * transient errors) or blocked (not integrated / external factor) — the
 * batch continues.
 */
export const runCompanyTask = task({
  id: "run-company",
  queue: { name: "company-jobs", concurrencyLimit: 3 },
  run: async ({
    payload,
  }: {
    payload: { runId: string; workspaceId: string; companyId: string; domain: string };
  }) =>
    runCompany(payload, new PostgresWorkerRepository(), realCollectorSeam()),
});

/** Testable core: repository and collector are injected. */
export async function runCompany(
  payload: { runId: string; workspaceId: string; companyId: string; domain: string },
  repo: WorkerRepository,
  collector: CollectorSeam,
): Promise<{ companyId: string; status: CompanyStatus }> {
  const { workspaceId, companyId, runId, domain } = payload;
  await repo.setCompanyStatus(workspaceId, companyId, "collecting");

  try {
    // The collector: bounded page selection, guarded HTML fetch, selective
    // render, network capture, and signature detection, persisted
    // workspace-scoped (workers/collector).
    await collector({ companyId, domain, workspaceId });
  } catch (err) {
    const { status, retryable } = companyStatusAfterError(err);
    await repo.setCompanyStatus(workspaceId, companyId, status, {
      error: err instanceof Error ? err.message : String(err),
    });
    await repo.recordRunFailure(workspaceId, runId, {
      companyId,
      stage: status,
      error: err instanceof Error ? err.message : String(err),
    });
    await repo.refreshRunCounters(workspaceId, runId);
    if (retryable) {
      // Rethrow so the Trigger.dev retry policy (maxAttempts: 3) applies;
      // the company row already carries the failure for the live board.
      throw err;
    }
    return { companyId, status };
  }

  // The collector, intelligence, and interface tasks integrate their stages
  // here. Until they land, a collected company is marked blocked with an
  // honest reason — never silently "ready".
  await repo.setCompanyStatus(workspaceId, companyId, "blocked", {
    error: "Analysis stages are not yet integrated (intelligence module pending).",
  });
  await repo.recordRunFailure(workspaceId, runId, {
    companyId,
    stage: "blocked",
    error: "Analysis stages are not yet integrated (intelligence module pending).",
  });
  await repo.refreshRunCounters(workspaceId, runId);
  return { companyId, status: "blocked" };
}
