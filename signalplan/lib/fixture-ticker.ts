import type { CompanyStatus, Run, RunStatus } from "@/lib/contracts";
import { runStatusFromCompanies } from "@/lib/workers/orchestration";
import type { RunStatusPayload } from "@/lib/data-source";

/**
 * Pure fixture-run ticker. Each poll tick advances every non-terminal company
 * one stage through the brief's state machine (queued → collecting →
 * analyzing → drafting → reviewing → ready). Failed, blocked, cancelled, and
 * partial companies stay exactly where they are — one company's failure never
 * advances or blocks another (acceptance check 3, mirrored at UI level).
 *
 * Run rollup reuses the orchestration module's runStatusFromCompanies so the
 * fixture board's semantics match the real worker's, not a parallel
 * implementation. Cancelled runs are terminal here because the fixture
 * source's cancelRun set them explicitly.
 */

const ADVANCEMENT: Partial<Record<CompanyStatus, CompanyStatus>> = {
  queued: "collecting",
  collecting: "analyzing",
  analyzing: "drafting",
  drafting: "reviewing",
  reviewing: "ready",
};

const TERMINAL_COMPANY_STATUSES: CompanyStatus[] = [
  "ready",
  "partial",
  "failed",
  "blocked",
  "cancelled",
];

const TERMINAL_RUN_STATUSES: RunStatus[] = ["completed", "failed", "cancelled", "partial"];

export function isTerminalRunStatus(status: RunStatus): boolean {
  return TERMINAL_RUN_STATUSES.includes(status);
}

export function isTerminalCompanyStatus(status: CompanyStatus): boolean {
  return TERMINAL_COMPANY_STATUSES.includes(status);
}

/**
 * Advance the payload one tick. Never mutates the input; the fixture source
 * stores the returned state.
 */
export function advanceFixtureRun(payload: RunStatusPayload): RunStatusPayload {
  if (isTerminalRunStatus(payload.run.status)) return payload;

  const companies = payload.companies.map((c) => {
    if (isTerminalCompanyStatus(c.status)) return c;
    const next = ADVANCEMENT[c.status];
    return next ? { ...c, status: next } : c;
  });

  const statuses = companies.map((c) => c.status);
  const run: Run = {
    ...payload.run,
    companiesReady: companies.filter((c) => c.status === "ready").length,
    companiesFailed: companies.filter((c) =>
      ["failed", "partial", "blocked", "cancelled"].includes(c.status),
    ).length,
    modelRequestsUsed: Math.min(payload.run.modelRequestsUsed + 1, 8),
    status: runStatusFromCompanies(statuses),
  };
  return { run, companies };
}

/**
 * Cancel: the run stops and every queued company is cancelled; in-flight
 * stages stay as they are (matching the repository's cancel semantics —
 * workers honour cancellation at their own checkpoints).
 */
export function cancelFixtureRun(payload: RunStatusPayload): RunStatusPayload {
  if (isTerminalRunStatus(payload.run.status)) return payload;
  return {
    run: { ...payload.run, status: "cancelled" },
    companies: payload.companies.map((c) =>
      c.status === "queued" ? { ...c, status: "cancelled" as const } : c,
    ),
  };
}
