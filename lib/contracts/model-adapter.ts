import type { z } from "zod";
import type { Evidence } from "./evidence";

/**
 * BYOK model adapter contract (spec §The BYOK addition). Every specialist call
 * is schema-validated; a malformed model response is retried once, then
 * surfaced as an agentRun failure — never silently coerced. Tool privileges
 * stay OUT of prompts; fetched evidence text is data, never instructions.
 */
export type ModelRole =
  | "positioning"
  | "funnel"
  | "outbound"
  | "planner"
  | "writer"
  | "reviewer";

export interface ModelCompletionOptions<T> {
  role: ModelRole;
  system: string;
  evidence: Evidence[];
  schema: z.ZodType<T>;
}

export interface ModelAdapter {
  complete<T>(opts: ModelCompletionOptions<T>): Promise<T>;
}
