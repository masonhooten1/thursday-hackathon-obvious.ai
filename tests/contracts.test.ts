import { describe, expect, it } from "vitest";
import {
  createCampaignInputSchema,
  createRunInputSchema,
  evidenceSchema,
  findingSchema,
  modelSettingsMetadataSchema,
  parsePublicDomain,
  publicIntegrationStatusSchema,
  runSchema,
  saveSettingsInputSchema,
} from "@/lib/contracts";
import { randomUUID } from "node:crypto";

function validEvidence() {
  return {
    id: randomUUID(),
    companyId: randomUUID(),
    url: "https://example.com/pricing",
    capturedAt: new Date().toISOString(),
    method: "html",
    excerpt: "Request a demo form embeds hbspt.forms.create",
    limitations: [],
  };
}

describe("evidenceSchema", () => {
  it("accepts a well-formed evidence record", () => {
    const parsed = evidenceSchema.parse(validEvidence());
    expect(parsed.method).toBe("html");
  });

  it("rejects a missing limitations array", () => {
    const bad = validEvidence() as Record<string, unknown>;
    delete bad.limitations;
    expect(evidenceSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a non-ISO capturedAt", () => {
    expect(
      evidenceSchema.safeParse({ ...validEvidence(), capturedAt: "yesterday" })
        .success,
    ).toBe(false);
  });

  it("rejects an unknown method", () => {
    expect(
      evidenceSchema.safeParse({ ...validEvidence(), method: "guessing" }).success
    ).toBe(false);
  });
});

describe("findingSchema", () => {
  it("accepts a finding with empty evidenceIds (reviewer-rejected shape)", () => {
    const finding = {
      id: randomUUID(),
      category: "conversion",
      observation: "The demo form asks for eleven fields.",
      evidenceIds: [],
      hypothesis: "A shorter form may reduce drop-off.",
      recommendation: "Proposed: two-step form.",
      confidence: "medium",
      validationNeeded: ["Current lead-quality baseline"],
      ownerRole: "Marketing Ops",
      effort: "small",
      metric: "form completion rate (baseline first)",
    };
    expect(findingSchema.parse(finding).evidenceIds).toEqual([]);
  });

  it("rejects an invalid category", () => {
    expect(
      findingSchema.safeParse({
        id: randomUUID(),
        category: "vibes",
        observation: "x",
        evidenceIds: [],
        hypothesis: "x",
        recommendation: "x",
        confidence: "high",
        validationNeeded: [],
        ownerRole: "x",
        effort: "small",
        metric: "x",
      }).success,
    ).toBe(false);
  });
});

describe("hubspot statuses", () => {
  it("exposes exactly the four public integration statuses", () => {
    expect(publicIntegrationStatusSchema.options).toEqual([
      "observed",
      "probable",
      "not_observed",
      "scan_incomplete",
    ]);
  });
});

describe("campaign input", () => {
  it("accepts partial limits (defaults are applied when the campaign is stored)", () => {
    const input = createCampaignInputSchema.parse({
      name: "AI outbound batch",
      offer: { headline: "Marketing consulting", idealCustomerProfile: "HubSpot B2B" },
      limits: { maxCompanies: 10 },
    });
    expect(input.limits).toEqual({ maxCompanies: 10 });
  });
});

describe("run input", () => {
  it("accepts 1-25 domains", () => {
    expect(createRunInputSchema.safeParse({ domains: ["example.com"] }).success).toBe(true);
    expect(
      createRunInputSchema.safeParse({ domains: Array.from({ length: 26 }, () => "a.com") })
        .success,
    ).toBe(false);
  });
});

describe("settings contracts", () => {
  it("GET metadata never carries key material", () => {
    const meta = modelSettingsMetadataSchema.parse({
      provider: "openai",
      keyLastFour: "abcd",
      updatedAt: new Date().toISOString(),
    });
    expect(JSON.stringify(meta)).not.toContain("apiKey");
    expect(JSON.stringify(meta)).not.toContain("encryptedKey");
  });

  it("save input requires provider and key", () => {
    expect(
      saveSettingsInputSchema.safeParse({ provider: "openai", apiKey: "sk-12345678" }).success,
    ).toBe(true);
    expect(saveSettingsInputSchema.safeParse({ provider: "openai" }).success).toBe(false);
  });
});

describe("run contract", () => {
  it("requires a minimum-length idempotency key", () => {
    const base = {
      id: randomUUID(),
      campaignId: randomUUID(),
      workspaceId: randomUUID(),
      status: "queued",
      companiesTotal: 0,
      companiesReady: 0,
      companiesFailed: 0,
      modelRequestsUsed: 0,
      failures: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    expect(runSchema.safeParse({ ...base, idempotencyKey: "short" }).success).toBe(false);
    expect(runSchema.safeParse({ ...base, idempotencyKey: "idem-key-1234567890" }).success).toBe(
      true,
    );
  });
});

describe("parsePublicDomain — acceptance check 8 (intake half)", () => {
  it("accepts bare domains and pasted URLs", () => {
    expect(parsePublicDomain("example.com")).toEqual({ ok: true, domain: "example.com" });
    expect(parsePublicDomain("https://example.com/pricing?x=1")).toEqual({
      ok: true,
      domain: "example.com",
    });
    expect(parsePublicDomain("WWW.Example.COM.")).toEqual({
      ok: true,
      domain: "www.example.com",
    });
  });

  it("blocks loopback, private, link-local, and metadata destinations", () => {
    for (const host of [
      "localhost",
      "127.0.0.1",
      "10.1.2.3",
      "172.16.0.9",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.169.254",
      "0.0.0.0",
      "100.64.0.1",
      "::1",
      "fe80::1",
      "fd00::1",
      "::ffff:192.168.0.1",
    ]) {
      const result = parsePublicDomain(host);
      expect(result.ok, host).toBe(false);
      if (!result.ok) {
        expect(
          ["IP_LITERAL_NOT_ALLOWED", "PRIVATE_OR_LOCAL_ADDRESS", "RESERVED_TLD"],
          host,
        ).toContain(result.code);
      }
    }
  });

  it("blocks reserved pseudo-TLDs", () => {
    for (const host of ["foo.localhost", "bar.internal", "baz.local", "demo.test"]) {
      expect(parsePublicDomain(host).ok, host).toBe(false);
    }
  });

  it("rejects malformed input", () => {
    expect(parsePublicDomain("   ").ok).toBe(false);
    expect(parsePublicDomain("not a domain").ok).toBe(false);
    // A pasted URL with a port normalizes to its hostname — the collector
    // talks to the site over 80/443.
    expect(parsePublicDomain("https://example.com:8443/")).toEqual({
      ok: true,
      domain: "example.com",
    });
  });
});
