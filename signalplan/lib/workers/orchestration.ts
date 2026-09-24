import type { CompanyStatus, RunStatus } from "@/lib/contracts";

/**
 * Pure orchestration logic for the Trigger.dev tasks (spec §Company
 * lifecycle). Kept free of I/O so the state machine and failure-isolation
 * rules are unit-testable; the task files do the database and SDK work.
 */

const COMPANY_STATUSES_IN_FLIGHT: readonly CompanyStatus[] = [
  "queued",
  "collecting",
  "analyzing",
  "drafting",
  "reviewing",
];

/** Roll companies up into the run's terminal status (in-flight aware). */
export function runStatusFromCompanies(statuses: CompanyStatus[]): RunStatus {
  if (statuses.length === 0) return "completed";
  if (statuses.some((s) => COMPANY_STATUSES_IN_FLIGHT.includes(s))) return "running";
  if (statuses.every((s) => s === "cancelled")) return "cancelled";
  const done = statuses.filter((s) => s === "ready" || s === "partial");
  if (done.length === statuses.length) return "completed";
  if (done.length > 0) return "partial";
  return "failed";
}

/**
 * Terminal company state after a pipeline stage failure (check 3: one blocked
 * domain, timeout, or failed specialist never fails the batch — the company
 * carries the failure). Not-yet-integrated seams and spend-the-budget
 * conditions are distinct from transient failures, which the worker runtime
 * retries.
 */
export function companyStatusAfterError(err: unknown): {
  status: "failed" | "blocked";
  retryable: boolean;
} {
  const name = err instanceof Error ? err.name : "";
  if (name === "SeamNotIntegratedError") return { status: "blocked", retryable: false };
  if (name === "ModelUnavailableError") return { status: "blocked", retryable: false };
  if (name === "ModelBudgetExhaustedError") return { status: "blocked", retryable: false };
  return { status: "failed", retryable: true };
}

/**
 * The company job records a run failure for every non-retryable terminal
 * state; retryable ones are recorded by the runtime's final attempt so a
 * transient failure does not spam the operator's run log.
 */
export function shouldRecordRunFailure(retryable: boolean, isFinalAttempt: boolean): boolean {
  return !retryable || isFinalAttempt;
}
