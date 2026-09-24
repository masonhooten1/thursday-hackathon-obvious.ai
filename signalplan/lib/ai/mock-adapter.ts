import type { z } from "zod";
import type { Evidence } from "@/lib/contracts";
import type { ModelAdapter, ModelCompletionOptions, ModelRole } from "@/lib/contracts";
import { buildUserMessage } from "./adapter";

/**
 * MOCK MODEL ADAPTER — visibly labeled development and test double (brief
 * §Stack and implementation split: "Use a mock adapter for independent
 * development, visibly labeled"). Never wire this into a production path:
 * production resolves adapters only through `createModelAdapter`.
 *
 * Results are still run through the caller's Zod schema so a bad fixture
 * fails loudly instead of poisoning a downstream agent with invalid data.
 * Every call is recorded (`calls`) so tests can assert on the prompts that
 * were actually built — including what page text landed where.
 */

export interface MockModelCall {
  role: ModelRole;
  system: string;
  user: string;
  evidence: Evidence[];
}

export type MockHandler = (call: MockModelCall, callIndex: number) => unknown;

export class MockModelAdapter implements ModelAdapter {
  /** Visible label — tests and dev tooling assert on this. */
  readonly isMock = true as const;
  readonly calls: MockModelCall[] = [];

  private readonly handlers: Partial<Record<ModelRole, MockHandler>>;

  constructor(handlers: Partial<Record<ModelRole, MockHandler>> = {}) {
    this.handlers = handlers;
  }

  async complete<T>(opts: ModelCompletionOptions<T>): Promise<T> {
    const callIndex = this.calls.length;
    this.calls.push({
      role: opts.role,
      system: opts.system,
      user: buildUserMessage(opts.evidence, opts.schema),
      evidence: opts.evidence,
    });
    const handler = this.handlers[opts.role];
    if (!handler) {
      throw new Error(
        `MockModelAdapter (MOCK) has no handler for role "${opts.role}" — configure one so ` +
          "a test never falls through to a real model call.",
      );
    }
    const result = handler(this.calls[callIndex], callIndex);
    return opts.schema.parse(result) as T;
  }
}
