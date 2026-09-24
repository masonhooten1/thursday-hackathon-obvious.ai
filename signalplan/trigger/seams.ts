/**
 * Integration seams for the module tasks that build on this foundation.
 * The orchestration (state machine, failure isolation, counters) is real and
 * tested; the collector is wired by the collector task and model calls remain
 * the intelligence task's seam. Nothing here fabricates evidence or results —
 * a not-yet-integrated seam marks work blocked, never done.
 */
import "server-only";
import { collectCompany, defaultCollectorOptions } from "@/workers/collector";
import type { CollectorCompany } from "@/workers/collector";

export class SeamNotIntegratedError extends Error {
  constructor(readonly seam: string) {
    super(`${seam} module is not yet integrated.`);
    this.name = "SeamNotIntegratedError";
  }
}

export type CompanyWork = CollectorCompany;

export type CollectorSeam = (company: CompanyWork) => Promise<void>;

/**
 * The real collector: bounded page selection, guarded HTML pass, selective
 * rendering, network-event capture, and signature detection, persisted
 * workspace-scoped. Blocking errors (SSRF guard, Postgres) propagate to the
 * company job's failure handling; per-page failures are captured as
 * limitations inside the collector.
 */
export function realCollectorSeam(): CollectorSeam {
  const options = defaultCollectorOptions();
  return async (company) => {
    await collectCompany(company, options);
  };
}
