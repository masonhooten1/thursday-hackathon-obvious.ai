import "server-only";
import { randomUUID } from "node:crypto";
import { task } from "@trigger.dev/sdk/v3";
import { PostgresWorkerRepository } from "@/lib/repositories/worker";
import type { WorkerRepository } from "@/lib/repositories/worker";
import { realCollectorSeam, realAnalysisSeam } from "./seams";
import type { AnalysisSeam, CollectorSeam } from "./seams";
import {
  companyStatusAfterError,
  runStatusFromCompanies,
  shouldRecordRunFailure,
} from "@/lib/workers/orchestration";
import type { CompanyStatus, RunStatus } from "@/lib/contracts";

/**
 * run-company — one company's pipeline: queued → collecting → analyzing →
 * drafting → reviewing → ready (spec §Company lifecycle). Bounded by the
 * "company-jobs" queue (3 in flight by default — brief §Execution settings).
 *
 * Failure isolation (check 3): a blocked domain, timeout, or failed
 * specialist marks THIS company failed (retried by the worker runtime for
 * transient errors) or blocked (not integrated / missing key / budget spent)
 * — the batch continues.
 *
 * Durability (check 11): every transition is a database write, and cancel
 * checkpoints between stages stop work promptly once the operator cancels —
 * closing the browser changes nothing.
 */
export const runCompanyTask = task({
  id: "run-company",
  queue: { name: "company-jobs", concurrencyLimit: 3 },
  run: async ({
    payload,
    ctx,
  }: {
    payload: { runId: string; workspaceId: string; companyId: string; domain: string };
    ctx: { attempt: { number: number } };
  }) =>
    runCompany(
      payload,
      new PostgresWorkerRepository(),
      realCollectorSeam(),
      realAnalysisSeam(),
      ctx.attempt.number,
    ),
});

/** Testable core: repository, collector, and analysis are injected. */
export async function runCompany(
  payload: {
    runId: string;
    workspaceId: string;
    companyId: string;
    domain: string;
  },
  repo: WorkerRepository,
  collector: CollectorSeam,
  analysis: AnalysisSeam,
  attempt = 1,
): Promise<{ companyId: string; status: CompanyStatus }> {
  const { workspaceId, companyId, runId, domain } = payload;

  // Cancel checkpoint: stop before any work if the operator cancelled.
  if (await runCancelled(repo, workspaceId, runId)) {
    await repo.setCompanyStatus(workspaceId, companyId, "cancelled");
    await finishCompany(repo, workspaceId, runId);
    return { companyId, status: "cancelled" };
  }

  await repo.setCompanyStatus(workspaceId, companyId, "collecting");

  try {
    // The collector: bounded page selection, guarded HTML fetch, selective
    // render, network capture, and signature detection, persisted
    // workspace-scoped (workers/collector).
    await collector({ companyId, domain, workspaceId });
  } catch (err) {
    return await failCompany(repo, payload, err, attempt);
  }

  // Cancel checkpoint before the (more expensive) model stages.
  if (await runCancelled(repo, workspaceId, runId)) {
    await repo.setCompanyStatus(workspaceId, companyId, "cancelled");
    await finishCompany(repo, workspaceId, runId);
    return { companyId, status: "cancelled" };
  }

  await repo.setCompanyStatus(workspaceId, companyId, "analyzing");

  try {
    const outcome = await analysis(
      { workspaceId, runId, companyId, domain, name: "", attempt },
      repo,
    );
    if (outcome.planContent) {
      // The writer's content schema plus identity fields (frozen contract).
      // A partial plan lands in "review" — human eyes before export.
      await repo.saveAccountPlan(workspaceId, companyId, {
        ...outcome.planContent,
        id: randomUUID(),
        companyId,
        workspaceId,
        version: 1,
        status: outcome.status === "ready" ? "ready" : "review",
      });
    }
    await repo.saveFindings(workspaceId, companyId, outcome.findings);
    if (outcome.score) {
      await repo.saveCompanyScore(workspaceId, companyId, outcome.score);
    }
    await repo.setCompanyStatus(workspaceId, companyId, outcome.status, {
      error: outcome.notes.join(" ") || undefined,
    });
  } catch (err) {
    return await failCompany(repo, payload, err, attempt);
  }

  await finishCompany(repo, workspaceId, runId);
  const final = await repo.getCompanyCore(workspaceId, companyId);
  return { companyId, status: final?.status ?? "ready" };
}

async function runCancelled(
  repo: WorkerRepository,
  workspaceId: string,
  runId: string,
): Promise<boolean> {
  const status = await repo.getRunStatus(workspaceId, runId);
  return status === "cancelled";
}

/**
 * Persist one company's terminal failure (check 3: the batch carries on).
 * Retryable errors are rethrown so the Trigger.dev retry policy applies; the
 * run-failure record is written only on the final attempt so a transient
 * blip does not spam the operator's run log.
 */
async function failCompany(
  repo: WorkerRepository,
  payload: { runId: string; workspaceId: string; companyId: string; domain: string },
  err: unknown,
  attempt: number,
): Promise<{ companyId: string; status: CompanyStatus }> {
  const { workspaceId, companyId, runId } = payload;
  const message = err instanceof Error ? err.message : String(err);
  const { status, retryable } = companyStatusAfterError(err);
  // Trigger.dev default maxAttempts is 3 (attempts 0,1,2).
  const isFinalAttempt = !retryable || attempt >= 2;

  await repo.setCompanyStatus(workspaceId, companyId, status, { error: message });
  if (shouldRecordRunFailure(retryable, isFinalAttempt)) {
    await repo.recordRunFailure(workspaceId, runId, {
      companyId,
      stage: status,
      error: message,
    });
  }
  await finishCompany(repo, workspaceId, runId);
  if (retryable) throw err;
  return { companyId, status };
}

/**
 * Roll the companies' states up into the run row (check 11: a reconnected
 * browser sees progressed state without any worker-side memory). A cancelled
 * run keeps its terminal status — in-flight companies were flipped to
 * `cancelled` at their own checkpoints.
 */
async function finishCompany(
  repo: WorkerRepository,
  workspaceId: string,
  runId: string,
): Promise<RunStatus | null> {
  await repo.refreshRunCounters(workspaceId, runId);
  const current = await repo.getRunStatus(workspaceId, runId);
  if (current === "cancelled" || current === "completed") return current;
  const companies = await repo.getRunCompanies(workspaceId, runId);
  const next = runStatusFromCompanies(companies.map((c) => c.status));
  await repo.setRunStatus(workspaceId, runId, next);
  return next;
}
