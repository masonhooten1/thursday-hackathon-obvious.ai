import "server-only";

/**
 * API-route bridge to the Trigger.dev batch task. When TRIGGER_SECRET_KEY is
 * absent (credential-free development), enqueueing is a logged no-op: the run
 * stays durably queued in Postgres and nothing pretends to have dispatched —
 * the same code path is used the moment real credentials exist.
 */
export async function enqueueRun(workspaceId: string, runId: string): Promise<void> {
  if (!process.env.TRIGGER_SECRET_KEY) {
    console.warn(
      `[trigger] TRIGGER_SECRET_KEY not configured — run ${runId} stays queued in the database.`,
    );
    return;
  }
  const { tasks } = await import("@trigger.dev/sdk");
  await tasks.trigger("run-batch", { runId, workspaceId });
}
