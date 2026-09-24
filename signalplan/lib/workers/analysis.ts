import { randomUUID } from "node:crypto";
import type {
  Campaign,
  CompanyScore,
  Evidence,
  Finding,
  HubSpotEvidence,
  ModelAdapter,
} from "@/lib/contracts";
import type { AgentRole, AgentRunStatus, ReviewerVerdict } from "@/lib/contracts";
import {
  draftWithReview,
  runFunnel,
  runOutbound,
  runPlanner,
  runPositioning,
} from "@/lib/ai/specialists";
import type {
  AccountPlanContent,
  FindingDraft,
  LevelJudgement,
  ReviewerOutput,
} from "@/lib/ai/schemas";
import type { PromptContext } from "@/lib/ai/prompts";
import { rankCompany, type RankedCompany } from "@/lib/ai/ranking";

/**
 * The company analysis stage (brief §Specialists and their contracts, wired
 * per spec §The four modules — Intelligence). Runs the three analysts in
 * parallel on the shared evidence bundle, the HubSpot planner on their
 * outputs, then the write→review loop — every model call gated through the
 * run's global model-request budget (brief §Execution settings: cap of 8).
 *
 * Pure orchestration: the adapter, the budget gate, and the agent-run
 * recorder are injected, so the whole stage is testable against the labeled
 * mock adapter with no credentials. No model output is trusted structurally —
 * every result is schema-validated by the adapter, and the reviewer plus
 * deterministic enforcement decide what survives into the plan.
 */

/** Raised when the run's model-request cap is spent — retrying cannot help. */
export class ModelBudgetExhaustedError extends Error {
  readonly name = "ModelBudgetExhaustedError";
  constructor(
    readonly role: string,
    readonly partialFindings: Finding[] = [],
  ) {
    super(
      `Model-request budget exhausted before the "${role}" stage — ` +
        "deterministic results are persisted; model stages are marked blocked.",
    );
    this.name = "ModelBudgetExhaustedError";
  }
}

/** Raised when no model key is configured — model stages blocked, never faked. */
export class ModelUnavailableError extends Error {
  readonly name = "ModelUnavailableError";
  constructor(reason: string) {
    super(reason);
    this.name = "ModelUnavailableError";
  }
}

export interface AgentRunRecord {
  role: AgentRole;
  status: AgentRunStatus;
  attempt: number;
  verdict?: ReviewerVerdict;
  error?: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface AnalysisPorts {
  adapter: ModelAdapter;
  attempt: number;
  /**
   * Atomically reserve one model request against the run cap. False = the
   * cap is spent; the stage raises ModelBudgetExhaustedError.
   */
  reserveModelRequest: () => Promise<boolean>;
  recordAgentRun?: (record: AgentRunRecord) => Promise<void>;
}

export interface AnalysisInput {
  workspaceId: string;
  runId: string;
  companyId: string;
  domain: string;
  companyName: string;
  campaign: Pick<Campaign, "offer" | "limits">;
  evidence: Evidence[];
  hubspotEvidence: HubSpotEvidence | null;
}

export interface AnalysisOutcome {
  status: "ready" | "partial";
  planContent: AccountPlanContent | null;
  findings: Finding[];
  score: CompanyScore | null;
  /** Honest stage notes — persisted alongside the plan, never hidden. */
  notes: string[];
  writerPasses: number;
  verdicts: ReviewerOutput["verdict"][];
  removedRefs: string[];
}

/**
 * Wrap any adapter with the run's budget gate: every model request reserves
 * one slot atomically before it can fire, so the cap is a hard ceiling even
 * across parallel specialists and retries (brief: "a per-run cost ceiling").
 * The gate throws ModelBudgetExhaustedError — a non-retryable condition the
 * company job turns into an honest `blocked` state.
 */
export function budgetGateAdapter(
  adapter: ModelAdapter,
  reserve: () => Promise<boolean>,
): ModelAdapter {
  return {
    async complete(opts) {
      const reserved = await reserve();
      if (!reserved) throw new ModelBudgetExhaustedError(opts.role);
      return adapter.complete(opts);
    },
  };
}

/** Record one specialist execution durably (running → terminal) when a recorder is wired. */
async function withAgentRun<T>(
  ports: AnalysisPorts,
  role: AgentRole,
  run: () => Promise<T>,
): Promise<T> {
  const startedAt = new Date().toISOString();
  await ports.recordAgentRun?.({
    role,
    status: "running",
    attempt: ports.attempt,
    startedAt,
  });
  try {
    const value = await run();
    await ports.recordAgentRun?.({
      role,
      status: "succeeded",
      attempt: ports.attempt,
      startedAt,
      finishedAt: new Date().toISOString(),
    });
    return value;
  } catch (err) {
    await ports.recordAgentRun?.({
      role,
      status: "failed",
      attempt: ports.attempt,
      error: err instanceof Error ? err.message : String(err),
      startedAt,
      finishedAt: new Date().toISOString(),
    });
    throw err;
  }
}

/** Result of one specialist execution that is allowed to fail without cancelling siblings. */
type Attempt<T> = { ok: true; value: T } | { ok: false; error: unknown };

/**
 * Independent specialists run concurrently; a failed one does not cancel its
 * siblings (brief §Runtime architecture: "a failed optional competitor-research
 * task should not cancel the rest of the account"). Each result stays typed.
 */
async function attempt<T>(
  role: AgentRole,
  ports: AnalysisPorts,
  run: () => Promise<T>,
): Promise<Attempt<T>> {
  try {
    return { ok: true, value: await withAgentRun(ports, role, run) };
  } catch (error) {
    return { ok: false, error };
  }
}

/** Pipeline-assigned finding ids; drafts citing unknown evidence are dropped (check 4 shape). */
export function findingsFromDrafts(
  drafts: FindingDraft[],
  knownEvidenceIds: ReadonlySet<string>,
): Finding[] {
  return drafts
    .filter((draft) => draft.evidenceIds.length > 0 && draft.evidenceIds.every((id) => knownEvidenceIds.has(id)))
    .map((draft) => ({ ...draft, id: randomUUID() }));
}

const UNKNOWN_JUDGEMENT: LevelJudgement = {
  level: "unknown",
  reason: "Specialist output unavailable — unknown is not scored (no invented points).",
};

/** Map the ranking components onto the persisted CompanyScore shape. */
export function scoreFromRanking(ranked: RankedCompany): CompanyScore {
  const pointsFor = (component: RankedCompany["components"][number]["component"]): number | null =>
    ranked.components.find((c) => c.component === component)?.points ?? null;
  return {
    icpFit: pointsFor("icp_fit"),
    evidenceQuality: pointsFor("evidence_quality"),
    opportunityRelevance: pointsFor("opportunity_relevance"),
    proposalFeasibility: pointsFor("feasibility"),
    total: ranked.score,
    reasons: ranked.components.map((c) => ({
      component:
        c.component === "feasibility"
          ? ("proposal_feasibility" as const)
          : c.component,
      reason: c.reason,
    })),
  };
}

/**
 * The full analysis stage for one company. Throws:
 * - ModelUnavailableError — no usable adapter (model stages blocked)
 * - ModelBudgetExhaustedError — run cap spent (carries findings-so-far)
 * - Error — transient specialist failure; the worker runtime retries the job
 */
export async function analyzeCompany(
  input: AnalysisInput,
  ports: AnalysisPorts,
): Promise<AnalysisOutcome> {
  const ctx: PromptContext = {
    companyName: input.companyName,
    domain: input.domain,
    offer: input.campaign.offer,
    hubspotEvidence: input.hubspotEvidence,
  };
  const bundle = { ctx, evidence: input.evidence, adapter: ports.adapter };
  const knownEvidenceIds = new Set(input.evidence.map((e) => e.id));
  const notes: string[] = [];

  // Analysts in parallel — three gated model requests (brief §Runtime
  // architecture). A failed analyst does not cancel its siblings; each
  // result keeps its own type.
  const [positioning, funnel, outbound] = await Promise.all([
    attempt("positioning", ports, () => runPositioning(bundle)),
    attempt("funnel", ports, () => runFunnel(bundle)),
    attempt("outbound", ports, () => runOutbound(bundle)),
  ]);

  for (const analyst of [
    { name: "positioning", outcome: positioning },
    { name: "funnel", outcome: funnel },
    { name: "outbound", outcome: outbound },
  ] as const) {
    if (!analyst.outcome.ok) {
      notes.push(
        `${analyst.name} analyst failed this attempt: ${
          analyst.outcome.error instanceof Error
            ? analyst.outcome.error.message
            : String(analyst.outcome.error)
        }`,
      );
    }
  }

  // Positioning is the diagnosis source (likely buyer, business model) —
  // without it the writer cannot produce an honest plan. Retry the job.
  if (!positioning.ok) {
    throw new Error("positioning analyst failed — the diagnosis cannot be drafted without it");
  }

  // Collect findings drafts from the surviving analyst outputs.
  const analystDrafts = [
    ...positioning.value.findings,
    ...(funnel.ok ? funnel.value.frictionFindings : []),
    ...(outbound.ok ? outbound.value.findings : []),
  ];
  const findingsSoFar = findingsFromDrafts(analystDrafts, knownEvidenceIds);

  // Planner: one gated model request over the surviving analyst outputs.
  const planner = await withAgentRun(ports, "planner", () =>
    runPlanner(bundle, {
      positioning: positioning.value,
      funnel: funnel.ok ? funnel.value : null,
      outbound: outbound.ok ? outbound.value : null,
    }),
  ).catch((err) => {
    // Attach findings-so-far so a budget block keeps the deterministic work.
    if (err instanceof ModelBudgetExhaustedError) {
      throw new ModelBudgetExhaustedError(err.role, findingsSoFar);
    }
    throw err;
  });

  // Writer + reviewer with at most one revision — gated calls inside. The
  // writer record covers the write→review loop; the reviewer's final verdict
  // is recorded separately.
  const review = await withAgentRun(ports, "writer", () =>
    draftWithReview(bundle, {
      positioning: positioning.value,
      funnel: funnel.ok ? funnel.value : null,
      outbound: outbound.ok ? outbound.value : null,
      planner,
    }),
  ).catch((err) => {
    if (err instanceof ModelBudgetExhaustedError) {
      throw new ModelBudgetExhaustedError(err.role, findingsSoFar);
    }
    throw err;
  });

  const finalVerdict = review.verdicts[review.verdicts.length - 1];
  await ports.recordAgentRun?.({
    role: "reviewer",
    status: review.plan === null ? "failed" : "succeeded",
    attempt: ports.attempt,
    verdict: finalVerdict,
    finishedAt: new Date().toISOString(),
  });

  const findings = findingsFromDrafts(
    [...analystDrafts, ...planner.findings],
    knownEvidenceIds,
  );

  const score = scoreFromRanking(
    rankCompany({
      companyId: input.companyId,
      evidence: input.evidence,
      hubspotStatus: input.hubspotEvidence
        ? { publicIntegration: input.hubspotEvidence.publicIntegration }
        : null,
      icpFit: positioning.value.icpFit,
      offerAlignment: outbound.ok ? outbound.value.offerAlignment : UNKNOWN_JUDGEMENT,
      feasibility: planner.feasibility,
    }),
  );

  if (review.plan === null) {
    notes.push("The reviewer stripped every opportunity — no plan was persisted; company marked partial.");
  }
  if (review.removedRefs.length > 0) {
    notes.push(`Removed unsupported claims: ${review.removedRefs.join(", ")}.`);
  }

  return {
    status: review.plan === null ? "partial" : "ready",
    planContent: review.plan,
    findings,
    score,
    notes,
    writerPasses: review.writerPasses,
    verdicts: review.verdicts,
    removedRefs: review.removedRefs,
  };
}
