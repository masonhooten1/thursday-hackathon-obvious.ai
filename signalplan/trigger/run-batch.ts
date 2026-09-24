import "server-only";
import { tasks, task } from "@trigger.dev/sdk/v3";
import { PostgresWorkerRepository } from "@/lib/repositories/worker";
import type { WorkerRepository } from "@/lib/repositories/worker";
import { runStatusFromCompanies } from "@/lib/workers/orchestration";

/**
 * run-batch (spec §System shape): validates the run, flips it to running,
 * fans out one run-company task per queued company, then rolls the terminal
 * states back into the run. Company-level failures never fail the batch —
 * they surface as run failures and a partial/failed run status.
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
): Promise<{ runId: string; status: string }> {
  await repo.setRunStatus(payload.workspaceId, payload.runId, "running");
  const companies = await repo.getRunCompanies(payload.workspaceId, payload.runId);
  for (const company of companies) {
    if (company.status === "queued") {
      await enqueueCompany(company);
    }
  }
  // Terminal states arrive as companies finish; the run row is reaped here
  // for the simple synchronous case and by run-company on every transition.
  await repo.refreshRunCounters(payload.workspaceId, payload.runId);
  const refreshed = await repo.getRunCompanies(payload.workspaceId, payload.runId);
  await repo.setRunStatus(
    payload.workspaceId,
    payload.runId,
    runStatusFromCompanies(refreshed.map((c) => c.status)),
  );
  return { runId: payload.runId, status: "dispatched" };
}
