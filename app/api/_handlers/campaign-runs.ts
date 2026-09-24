import { randomUUID } from "node:crypto";
import {
  createRunInputSchema,
  parsePublicDomain,
  runSchema,
} from "@/lib/contracts";
import {
  errorResponse,
  jsonResponse,
  workspaceGuard,
  type RouteContext,
  type RouteDeps,
} from "./shared";

/**
 * POST /api/campaigns/:id/runs — validate domains, create the run
 * idempotently, enqueue worker work. Acceptance checks 5 (idempotency) and 8
 * (intake validation) start here.
 */
export function createCampaignRunsRoutes(deps: RouteDeps) {
  async function POST(req: Request, ctx: RouteContext): Promise<Response> {
    const guard = await workspaceGuard(req, deps);
    if (!guard.ok) return errorResponse(guard.status, guard.message);

    const { id: campaignId } = await ctx.params;
    const campaign = await deps.repository.getCampaign(guard.workspaceId, campaignId);
    if (!campaign) return errorResponse(404, "Campaign not found.");

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return errorResponse(400, "Request body must be JSON.");
    }
    const parsed = createRunInputSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse(400, "Validation failed.", parsed.error.issues);
    }

    // The idempotency key is required (header per HTTP convention, or in the
    // body). Repeated clicks with the same key must return the original run
    // without creating companies or enqueueing work again.
    const idempotencyKey = req.headers.get("idempotency-key") ?? parsed.data.idempotencyKey;
    if (!idempotencyKey || idempotencyKey.trim().length < 8) {
      return errorResponse(
        400,
        "An idempotency key of at least 8 characters is required (Idempotency-Key header or body.idempotencyKey).",
      );
    }

    const intake: { domain: string; error?: string }[] = [];
    const valid: string[] = [];
    for (const raw of parsed.data.domains) {
      const result = parsePublicDomain(raw);
      if (result.ok) {
        valid.push(result.domain);
        intake.push({ domain: result.domain });
      } else {
        intake.push({ domain: raw, error: result.message });
      }
    }
    if (valid.length === 0) {
      return errorResponse(400, "No submittable domains.", intake);
    }

    const { run, created } = await deps.repository.createRun({
      campaign,
      idempotencyKey: idempotencyKey.trim(),
      domains: valid,
      runId: randomUUID(),
    });

    if (!created) {
      // Idempotent replay: the original run wins, nothing is enqueued twice.
      return jsonResponse({ run, idempotentReplay: true, intake }, 200);
    }

    if (deps.enqueueRun) {
      try {
        await deps.enqueueRun(run.id);
      } catch (err) {
        // The run is durably queued in the database; enqueue failure is
        // surfaced so the operator can re-trigger without recreating work.
        console.error("Run enqueuing failed — run stays queued in the database.", err);
        return jsonResponse({ run, intake, enqueueError: "Worker enqueue failed; run is queued." }, 202);
      }
    }
    const fullRun = runSchema.parse(run);
    return jsonResponse({ run: fullRun, intake }, 202);
  }

  return { POST };
}
