/**
 * Integration seams for the module tasks that build on this foundation.
 * The orchestration (state machine, failure isolation, counters) is real and
 * tested; the collector and model calls are plugged in by the collector and
 * intelligence tasks. Nothing here fabricates evidence or results — a
 * not-yet-integrated seam marks work blocked, never done.
 */
import "server-only";

export class SeamNotIntegratedError extends Error {
  constructor(readonly seam: string) {
    super(`${seam} module is not yet integrated.`);
    this.name = "SeamNotIntegratedError";
  }
}

export type CompanyWork = { companyId: string; domain: string };

export type CollectorSeam = (company: CompanyWork) => Promise<void>;

export function realCollectorSeam(): CollectorSeam {
  return async () => {
    throw new SeamNotIntegratedError("collector");
  };
}
