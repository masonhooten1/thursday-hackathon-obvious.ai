import type { Evidence, ModelAdapter } from "@/lib/contracts";
import type { ZodType, z } from "zod";
import {
  accountPlanContentSchema,
  funnelOutputSchema,
  type AccountPlanContent,
  type FunnelOutput,
  type OutboundOutput,
  type PlannerOutput,
  type PositioningOutput,
  type ReviewerClaim,
  type ReviewerOutput,
  outboundOutputSchema,
  plannerOutputSchema,
  positioningOutputSchema,
  reviewerOutputSchema,
} from "./schemas";
import {
  PLAN_WORD_BUDGET,
  funnelSystemPrompt,
  outboundSystemPrompt,
  plannerSystemPrompt,
  positioningSystemPrompt,
  reviewerSystemPrompt,
  writerSystemPrompt,
  type PromptContext,
} from "./prompts";

/**
 * Specialist runners over the frozen ModelAdapter contract (brief §Specialists
 * and their contracts) plus the write→review loop with its single revision
 * pass back to the writer. Pure orchestration — the adapter is injected, so
 * tests run the whole stack against the labeled mock with no credentials.
 */

export interface SpecialistBundle {
  ctx: PromptContext;
  evidence: Evidence[];
  adapter: ModelAdapter;
}

/**
 * The frozen ModelAdapter contract types its return through a generic
 * (`z.infer<S>`), which loses `.default()` requiredness at the call site.
 * Re-parsing with the concrete schema here is honest validation — the same
 * schema object the adapter already enforced — and recovers the output type.
 */
function validated<S extends ZodType>(schema: S, value: unknown): z.output<S> {
  return schema.parse(value);
}

export async function runPositioning(bundle: SpecialistBundle): Promise<PositioningOutput> {
  return validated(
    positioningOutputSchema,
    await bundle.adapter.complete({
      role: "positioning",
      system: positioningSystemPrompt(bundle.ctx),
      evidence: bundle.evidence,
      schema: positioningOutputSchema,
    }),
  );
}

export async function runFunnel(bundle: SpecialistBundle): Promise<FunnelOutput> {
  return validated(
    funnelOutputSchema,
    await bundle.adapter.complete({
      role: "funnel",
      system: funnelSystemPrompt(bundle.ctx),
      evidence: bundle.evidence,
      schema: funnelOutputSchema,
    }),
  );
}

export async function runOutbound(bundle: SpecialistBundle): Promise<OutboundOutput> {
  return validated(
    outboundOutputSchema,
    await bundle.adapter.complete({
      role: "outbound",
      system: outboundSystemPrompt(bundle.ctx),
      evidence: bundle.evidence,
      schema: outboundOutputSchema,
    }),
  );
}

export async function runPlanner(
  bundle: SpecialistBundle,
  upstream: { positioning: unknown; funnel: unknown; outbound: unknown },
): Promise<PlannerOutput> {
  return validated(
    plannerOutputSchema,
    await bundle.adapter.complete({
      role: "planner",
      system: plannerSystemPrompt(bundle.ctx, upstream),
      evidence: bundle.evidence,
      schema: plannerOutputSchema,
    }),
  );
}

export async function runWriter(
  bundle: SpecialistBundle,
  upstream: {
    positioning: unknown;
    funnel: unknown;
    outbound: unknown;
    planner: unknown;
  },
  revisionNotes?: string,
): Promise<AccountPlanContent> {
  return validated(
    accountPlanContentSchema,
    await bundle.adapter.complete({
      role: "writer",
      system: writerSystemPrompt(bundle.ctx, upstream, revisionNotes),
      evidence: bundle.evidence,
      schema: accountPlanContentSchema,
    }),
  );
}

export async function runReviewer(
  bundle: SpecialistBundle,
  draft: AccountPlanContent,
): Promise<ReviewerOutput> {
  return validated(
    reviewerOutputSchema,
    await bundle.adapter.complete({
      role: "reviewer",
      system: reviewerSystemPrompt(bundle.ctx, draft),
      evidence: bundle.evidence,
      schema: reviewerOutputSchema,
    }),
  );
}

export type { ReviewerClaim };

/** Total words across every string in the plan content — the budget check. */
export function countPlanWords(plan: AccountPlanContent): number {
  let words = 0;
  const count = (value: unknown): void => {
    if (typeof value === "string") {
      words += value.split(/\s+/).filter(Boolean).length;
    } else if (Array.isArray(value)) {
      value.forEach(count);
    } else if (value !== null && typeof value === "object") {
      Object.values(value).forEach(count);
    }
  };
  count(plan);
  return words;
}

export interface ReviewOutcome {
  /** The plan after deterministic enforcement of the final review. */
  plan: AccountPlanContent | null;
  review: ReviewerOutput;
  /** Refs removed by the reviewer or by unresolved-citation checks. */
  removedRefs: string[];
  /** How many writer passes were used (1 = no revision needed). */
  writerPasses: number;
  /** Reviewer verdicts observed across the loop. */
  verdicts: ReviewerOutput["verdict"][];
  /** Claims flagged needs_access — surfaced as validation questions. */
  needsAccess: ReviewerClaim[];
}

/**
 * Enforce claim→evidence resolution deterministically: an opportunity whose
 * evidence ids do not ALL resolve into the bundle is removed no matter what
 * the reviewer said (check 4 — the model never gets the final word on
 * support).
 */
export function unresolvedClaimRefs(
  plan: AccountPlanContent,
  knownEvidenceIds: ReadonlySet<string>,
): string[] {
  const refs: string[] = [];
  for (const opportunity of plan.opportunities) {
    if (opportunity.evidenceIds.some((id) => !knownEvidenceIds.has(id))) {
      refs.push(`opportunity:${opportunity.id}`);
    }
  }
  for (const assessment of plan.diagnosis.assessments) {
    if (assessment.evidenceIds.some((id) => !knownEvidenceIds.has(id))) {
      refs.push(`assessment:${assessment.category}`);
    }
  }
  return refs;
}

/** Apply reviewer claims + deterministic removals; returns the surviving plan. */
export function applyReviewerDecisions(
  plan: AccountPlanContent,
  review: ReviewerOutput,
  knownEvidenceIds: ReadonlySet<string>,
): { plan: AccountPlanContent | null; removedRefs: string[] } {
  const unresolved = new Set(unresolvedClaimRefs(plan, knownEvidenceIds));
  const unsupportedRefs = new Set(
    review.claims.filter((c) => c.status === "unsupported").map((c) => c.ref),
  );
  const removedRefs: string[] = [];

  const opportunities = plan.opportunities.filter((o) => {
    const removed =
      unsupportedRefs.has(`opportunity:${o.id}`) || unresolved.has(`opportunity:${o.id}`);
    if (removed) removedRefs.push(`opportunity:${o.id}`);
    return !removed;
  });
  const assessments = plan.diagnosis.assessments.filter((a) => {
    const removed =
      unsupportedRefs.has(`assessment:${a.category}`) || unresolved.has(`assessment:${a.category}`);
    if (removed) removedRefs.push(`assessment:${a.category}`);
    return !removed;
  });

  // The plan schema requires at least one opportunity; a plan stripped to
  // nothing is returned as null so the pipeline can mark the company partial
  // instead of storing an empty shell.
  if (opportunities.length === 0) return { plan: null, removedRefs };

  return {
    plan: {
      ...plan,
      opportunities,
      diagnosis: { ...plan.diagnosis, assessments },
    },
    removedRefs,
  };
}

export interface DraftReviewOptions {
  /** Total writer passes allowed — initial draft plus at most one revision. */
  maxWriterPasses?: number;
}

/**
 * Write → review → (at most one) revise → review → enforce. The loop is the
 * brief's "revise loop back to the writer": the reviewer's verdict either
 * stands, sends one round of revision notes to the writer, or strips
 * unsupported claims. Either way the process terminates deterministically.
 */
export async function draftWithReview(
  bundle: SpecialistBundle,
  upstream: {
    positioning: unknown;
    funnel: unknown;
    outbound: unknown;
    planner: unknown;
  },
  opts: DraftReviewOptions = {},
): Promise<ReviewOutcome> {
  const maxPasses = opts.maxWriterPasses ?? 2; // initial pass + one revision
  const knownEvidenceIds = new Set(bundle.evidence.map((e) => e.id));
  const verdicts: ReviewerOutput["verdict"][] = [];
  const removedRefs: string[] = [];
  const needsAccess: ReviewerClaim[] = [];

  let writerPasses = 0;
  let plan = await runWriter(bundle, upstream);
  writerPasses += 1;

  // Budget enforcement rides the same single revision pass: the writer is
  // told the count and asked to constrain — never truncated silently.
  let budgetNote: string | undefined;
  const words = countPlanWords(plan);
  if (words > PLAN_WORD_BUDGET.max) {
    budgetNote = `The plan is ${words} words; constrain it to ${PLAN_WORD_BUDGET.min}–${PLAN_WORD_BUDGET.max} total words while keeping every evidence citation.`;
  }

  for (let pass = writerPasses; pass <= maxPasses; pass += 1) {
    const isFinalPass = pass === maxPasses;
    const review = await runReviewer(bundle, plan);
    verdicts.push(review.verdict);
    needsAccess.push(...review.claims.filter((c) => c.status === "needs_access"));

    const decided = applyReviewerDecisions(plan, review, knownEvidenceIds);
    removedRefs.push(...decided.removedRefs);

    if (isFinalPass) {
      return { plan: decided.plan, review, removedRefs, writerPasses, verdicts, needsAccess };
    }

    if (review.verdict === "revise" || budgetNote) {
      const notes = [review.verdict === "revise" ? review.revisionNotes : "", budgetNote ?? ""]
        .filter(Boolean)
        .join(" ");
      plan = await runWriter(bundle, upstream, notes);
      writerPasses += 1;
      budgetNote = undefined; // budget was addressed in this revision
      continue;
    }

    // supported / unsupported / needs_access end the loop after enforcement.
    return { plan: decided.plan, review, removedRefs, writerPasses, verdicts, needsAccess };
  }

  // Unreachable: the for-loop returns on its final iteration.
  throw new Error("draftWithReview exhausted passes without a verdict.");
}
