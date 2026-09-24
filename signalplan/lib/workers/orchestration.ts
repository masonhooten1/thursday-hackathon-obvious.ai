import type { CompanyStatus, RunStatus } from "@/lib/contracts";

/**
 * Pure orchestration logic for the Trigger.dev tasks (spec §Company
 * lifecycle). Kept free of I/O so the state machine and failure-isolation
 * rules are unit-testable; the task files do the database and SDK work.
 */

/** Roll companies up into the run's terminal status. */
export function runStatusFromCompanies(statuses: CompanyStatus[]): RunStatus {
  if (statuses.length === 0) return "completed";
  const done = statuses.filter((s) => s === "ready" || s === "partial");
  if (done.length === statuses.length) return "completed";
  if (done.length > 0) return "partial";
  return "failed";
}

/**
 * Terminal company state after a pipeline stage failure (check 3: one blocked
 * domain, timeout, or failed specialist never fails the batch — the company
 * carries the failure). Not-yet-integrated seams are distinct from transient
 * failures, which the worker runtime retries.
 */
export function companyStatusAfterError(err: unknown): {
  status: "failed" | "blocked";
  retryable: boolean;
} {
  const name = err instanceof Error ? err.name : "";
  if (name === "SeamNotIntegratedError") return { status: "blocked", retryable: false };
  return { status: "failed", retryable: true };
}
