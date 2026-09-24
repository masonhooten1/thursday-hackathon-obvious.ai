import "server-only";
import { tasks, task } from "@trigger.dev/sdk/v3";
import { PostgresWorkerRepository } from "@/lib/repositories/worker";
import type { WorkerRepository } from "@/lib/repositories/worker";
import { runStatusFromCompanies } from "@/lib/workers/orchestration";

/**
 * run-batch (spec §System shape): validates the run, flips it to running,
 * fans out one run-company task per queued company, then leaves the terminal
 * rollup to the company jobs themselves — with three jobs in flight, the
 * batch task finishes long before the companies do, so any status it set
 * here would be a lie. Company-level failures never fail the batch — they
 * surface as run failures and a partial/failed run status (check 3).
 *
 * Resume-safe (check 5): only `queued` companies are enqueued, so a retried
 * batch task or a re-triggered run never duplicates work.
 */
export const runBatchTask = task({
  id: "run-batch",
  queue: { name: "batch", concurrencyLimit: 1 },
  run: async ({
    payload,
  }: {
    payload: { runId: string; workspaceId: string };
  }) => {
    return runBatch(payload, new PostgresWorkerRepository(), (company) =>
      tasks.trigger("run-company", {
        runId: payload.runId,
        workspaceId: payload.workspaceId,
        companyId: company.id,
        domain: company.domain,
      }),
    );
  },
});

/** Testable core: repository + enqueue are injected. */
export async function runBatch(
  payload: { runId: string; workspaceId: string },
  repo: WorkerRepository,
  enqueueCompany: (company: { id: string; domain: string }) => Promise<unknown>,
): Promise<{ runId: string; status: string; dispatched: number }> {
  const current = await repo.getRunStatus(payload.workspaceId, payload.runId);
  // A cancelled run is terminal: no re-dispatch from a stale callback.
  if (current === "cancelled") {
    return { runId: payload.runId, status: "cancelled", dispatched: 0 };
  }

  await repo.setRunStatus(payload.workspaceId, payload.runId, "running");
  const companies = await repo.getRunCompanies(payload.workspaceId, payload.runId);

  let dispatched = 0;
  for (const company of companies) {
    // Cancel guard while dispatching: an operator cancel mid-fan-out stops
    // further companies promptly.
    const status = await repo.getRunStatus(payload.workspaceId, payload.runId);
    if (status === "cancelled") break;
    if (company.status === "queued") {
      await enqueueCompany(company);
      dispatched += 1;
    }
  }

  await repo.refreshRunCounters(payload.workspaceId, payload.runId);
  const refreshed = await repo.getRunCompanies(payload.workspaceId, payload.runId);
  const rolled = runStatusFromCompanies(refreshed.map((c) => c.status));
  if (rolled !== "running") {
    // Everything already terminal (e.g. resume of a finished run): publish
    // the honest rollup. Otherwise the company jobs reap the run as they go.
    await repo.setRunStatus(payload.workspaceId, payload.runId, rolled);
  }
  return { runId: payload.runId, status: rolled, dispatched };
}
