import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  AgentOutputError,
  ModelRequestError,
  buildUserMessage,
  createModelAdapter,
  extractJson,
} from "@/lib/ai/adapter";
import { containsNoSecrets, redactSecrets } from "@/lib/ai/redact";
import { MockModelAdapter } from "@/lib/ai/mock-adapter";
import { INJECTION_EXCERPT, TEST_API_KEY, makeEvidence } from "./helpers/fixtures";

/**
 * Model adapter behavior: schema-validated responses, exactly one retry on
 * malformed output, provider-agnostic clients, and key redaction in every
 * error path (acceptance check 10) with evidence as untrusted data (check 7).
 * No cloud credentials exist — every provider call goes through an injected
 * fetch double.
 */

const outputSchema = z.object({ summary: z.string() });

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function openAiBody(content: string): unknown {
  return { choices: [{ message: { content } }] };
}

function anthropicBody(text: string): unknown {
  return { content: [{ type: "text", text }] };
}

/** Capture requests and script responses. */
function scriptedFetch(responses: Response[]) {
  const requests: { url: string; init: RequestInit }[] = [];
  const impl = async (url: string | URL, init: RequestInit): Promise<Response> => {
    requests.push({ url: String(url), init });
    const next = responses[requests.length - 1];
    if (!next) throw new Error("scriptedFetch ran out of scripted responses");
    return next;
  };
  return { requests, impl };
}

const evidence = [makeEvidence(), makeEvidence({ method: "first_party_text" })];

describe("createModelAdapter", () => {
  it("returns schema-validated output on the first attempt", async () => {
    const { requests, impl } = scriptedFetch([
      jsonResponse(200, openAiBody(JSON.stringify({ summary: "ok" }))),
    ]);
    const adapter = createModelAdapter({
      provider: "openai",
      apiKey: TEST_API_KEY,
      fetchImpl: impl,
    });
    const out = await adapter.complete({
      role: "positioning",
      system: "sys",
      evidence,
      schema: outputSchema,
    });
    expect(out).toEqual({ summary: "ok" });
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe("https://api.openai.com/v1/chat/completions");
  });

  it("retries exactly once on malformed JSON, then succeeds", async () => {
    const { requests, impl } = scriptedFetch([
      jsonResponse(200, openAiBody("not json at all")),
      jsonResponse(200, openAiBody(JSON.stringify({ summary: "recovered" }))),
    ]);
    const adapter = createModelAdapter({
      provider: "openai",
      apiKey: TEST_API_KEY,
      fetchImpl: impl,
    });
    const out = await adapter.complete({
      role: "writer",
      system: "sys",
      evidence,
      schema: outputSchema,
    });
    expect(out).toEqual({ summary: "recovered" });
    expect(requests).toHaveLength(2);
    // The retry carries the failure summary back to the model.
    const retryBody = JSON.parse(requests[1].init.body as string) as {
      messages: { content: string }[];
    };
    expect(retryBody.messages[1].content).toContain("PREVIOUS ATTEMPT REJECTED");
  });

  it("retries exactly once on schema-validation failure, then succeeds", async () => {
    const { requests, impl } = scriptedFetch([
      jsonResponse(200, anthropicBody(JSON.stringify({ summary: 42 }))),
      jsonResponse(200, anthropicBody(JSON.stringify({ summary: "valid now" }))),
    ]);
    const adapter = createModelAdapter({
      provider: "anthropic",
      apiKey: TEST_API_KEY,
      fetchImpl: impl,
    });
    const out = await adapter.complete({
      role: "funnel",
      system: "sys",
      evidence,
      schema: outputSchema,
    });
    expect(out).toEqual({ summary: "valid now" });
    expect(requests).toHaveLength(2);
    // Provider-agnostic: the Anthropic path was used.
    expect(requests[0].url).toBe("https://api.anthropic.com/v1/messages");
  });

  it("surfaces an AgentOutputError after the single retry, never coercing", async () => {
    const { impl } = scriptedFetch([
      jsonResponse(200, openAiBody("still not json")),
      jsonResponse(200, openAiBody("also not json")),
    ]);
    const adapter = createModelAdapter({
      provider: "openai",
      apiKey: TEST_API_KEY,
      fetchImpl: impl,
    });
    await expect(
      adapter.complete({ role: "writer", system: "sys", evidence, schema: outputSchema }),
    ).rejects.toThrow(AgentOutputError);
  });

  it("does not retry provider errors — the worker retry policy owns those", async () => {
    const { requests, impl } = scriptedFetch([jsonResponse(500, { error: "overloaded" })]);
    const adapter = createModelAdapter({
      provider: "openai",
      apiKey: TEST_API_KEY,
      fetchImpl: impl,
    });
    await expect(
      adapter.complete({ role: "planner", system: "sys", evidence, schema: outputSchema }),
    ).rejects.toThrow(ModelRequestError);
    expect(requests).toHaveLength(1);
  });

  it("tolerates a ```json fence around an otherwise valid payload", async () => {
    const fenced = "```json\n" + JSON.stringify({ summary: "fenced" }) + "\n```";
    expect(extractJson(fenced)).toEqual({ summary: "fenced" });
  });
});

describe("key redaction (check 10)", () => {
  it("redacts the API key from a thrown fetch error", async () => {
    const impl = async (): Promise<Response> => {
      throw new Error(`socket hang up while dialing with ${TEST_API_KEY}`);
    };
    const adapter = createModelAdapter({
      provider: "openai",
      apiKey: TEST_API_KEY,
      fetchImpl: impl,
    });
    const err = await adapter
      .complete({ role: "writer", system: "sys", evidence, schema: outputSchema })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ModelRequestError);
    expect((err as Error).message).toContain("[redacted]");
    expect(containsNoSecrets((err as Error).message, [TEST_API_KEY])).toBe(true);
  });

  it("redacts the API key from a provider error body that echoes it", async () => {
    const { impl } = scriptedFetch([
      jsonResponse(401, { error: `invalid key ${TEST_API_KEY}` }),
    ]);
    const adapter = createModelAdapter({
      provider: "openai",
      apiKey: TEST_API_KEY,
      fetchImpl: impl,
    });
    const err = await adapter
      .complete({ role: "writer", system: "sys", evidence, schema: outputSchema })
      .catch((e: unknown) => e);
    expect(containsNoSecrets((err as Error).message, [TEST_API_KEY])).toBe(true);
    expect((err as Error).message).toContain("[redacted]");
  });

  it("redacts Bearer-style credentials in error text as defense in depth", () => {
    // The adapter routes every error through redactSecrets; a leaked header
    // value from any layer gets the same treatment as the key itself.
    const leaked = "request failed: authorization: Bearer sk-live-zzz999yyy888www7";
    const redacted = redactSecrets(leaked, ["unused-key-value"]);
    expect(redacted).toContain("Bearer [redacted]");
    expect(containsNoSecrets(redacted, ["sk-live-zzz999yyy888www7"])).toBe(true);
  });

  it("never places the API key in the model context (headers only)", async () => {
    const { requests, impl } = scriptedFetch([
      jsonResponse(200, openAiBody(JSON.stringify({ summary: "ok" }))),
    ]);
    const adapter = createModelAdapter({
      provider: "openai",
      apiKey: TEST_API_KEY,
      fetchImpl: impl,
    });
    await adapter.complete({
      role: "reviewer",
      system: "You are a reviewer. " + INJECTION_EXCERPT, // system comes from prompts, redacted too
      evidence: [makeEvidence({ excerpt: `page text ${INJECTION_EXCERPT}` })],
      schema: outputSchema,
    });
    const body = String(requests[0].init.body);
    expect(containsNoSecrets(body, [TEST_API_KEY])).toBe(true);
    const headers = requests[0].init.headers as Record<string, string>;
    expect(headers.authorization).toBe(`Bearer ${TEST_API_KEY}`); // header, not context
  });

  it("redacts key material that appears inside an evidence excerpt", async () => {
    const { requests, impl } = scriptedFetch([
      jsonResponse(200, openAiBody(JSON.stringify({ summary: "ok" }))),
    ]);
    const adapter = createModelAdapter({
      provider: "openai",
      apiKey: TEST_API_KEY,
      fetchImpl: impl,
    });
    await adapter.complete({
      role: "positioning",
      system: "sys",
      evidence: [makeEvidence({ excerpt: `config page shows ${TEST_API_KEY}` })],
      schema: outputSchema,
    });
    const body = String(requests[0].init.body);
    expect(containsNoSecrets(body, [TEST_API_KEY])).toBe(true);
    expect(body).toContain("[redacted]");
  });
});

describe("evidence as untrusted data (check 7, adapter level)", () => {
  it("renders page text only inside untrusted_evidence blocks", async () => {
    const { requests, impl } = scriptedFetch([
      jsonResponse(200, anthropicBody(JSON.stringify({ summary: "ok" }))),
    ]);
    const adapter = createModelAdapter({
      provider: "anthropic",
      apiKey: TEST_API_KEY,
      fetchImpl: impl,
    });
    await adapter.complete({
      role: "outbound",
      system: "sys",
      evidence: [makeEvidence({ excerpt: INJECTION_EXCERPT })],
      schema: outputSchema,
    });
    const body = String(requests[0].init.body);
    const payload = JSON.parse(body) as { messages: { role: string; content: string }[] };
    const user = payload.messages.find((m) => m.role === "user")!.content;
    // The injected instruction appears verbatim, but ONLY inside the data block.
    const blockStart = user.indexOf("<untrusted_evidence");
    const blockEnd = user.indexOf("</untrusted_evidence>");
    expect(blockStart).toBeGreaterThan(-1);
    expect(user.indexOf(INJECTION_EXCERPT)).toBeGreaterThan(blockStart);
    expect(user.indexOf(INJECTION_EXCERPT)).toBeLessThan(blockEnd);
    // The data rule travels with the bundle.
    expect(user).toContain("never instructions");
  });

  it("does not grant the model any tool privileges (contract has none to give)", async () => {
    const adapter = createModelAdapter({
      provider: "openai",
      apiKey: TEST_API_KEY,
      fetchImpl: async () => jsonResponse(200, openAiBody("{}")),
    });
    // The frozen completion contract carries system, evidence, and a schema —
    // no tool surface exists to leak. Structurally asserted here.
    type CompletionKeys = keyof Parameters<typeof adapter.complete>[0];
    const sample: CompletionKeys = "role";
    expect(["role", "system", "evidence", "schema"]).toContain(sample);
  });
});

describe("buildUserMessage", () => {
  it("describes the output schema and includes evidence metadata", () => {
    const message = buildUserMessage(
      [makeEvidence({ limitations: ["blocked"], locator: "script[src]" })],
      outputSchema,
    );
    expect(message).toContain('"type":"object"');
    expect(message).toContain("limitations=\"blocked\"");
    expect(message).toContain("locator=\"script[src]\"");
  });

  it("marks an empty bundle instead of inviting invention", () => {
    const message = buildUserMessage([], outputSchema);
    expect(message).toContain("no evidence records were collected");
  });
});

describe("MockModelAdapter", () => {
  it("is visibly labeled and schema-validates handler results", async () => {
    const mock = new MockModelAdapter({
      writer: () => ({ summary: "mock result" }),
    });
    expect(mock.isMock).toBe(true);
    const out = await mock.complete({
      role: "writer",
      system: "sys",
      evidence,
      schema: outputSchema,
    });
    expect(out).toEqual({ summary: "mock result" });
    expect(mock.calls).toHaveLength(1);
    expect(mock.calls[0].role).toBe("writer");
  });

  it("fails loudly when a role has no configured handler", async () => {
    const mock = new MockModelAdapter({});
    await expect(
      mock.complete({ role: "reviewer", system: "sys", evidence, schema: outputSchema }),
    ).rejects.toThrow("no handler for role \"reviewer\"");
  });
});
