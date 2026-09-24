import { describe, expect, it } from "vitest";
import { classifyRole, isFirstParty, normalizePageUrl, selectPages } from "@/workers/collector/page-selection";

const DOMAIN = "example.com";

function classify(path: string): string | null {
  return classifyRole(new URL(`https://example.com${path}`));
}

describe("isFirstParty", () => {
  it("accepts the domain, its www form, and its subdomains", () => {
    expect(isFirstParty(new URL("https://example.com/x"), DOMAIN)).toBe(true);
    expect(isFirstParty(new URL("https://www.example.com/x"), DOMAIN)).toBe(true);
    expect(isFirstParty(new URL("https://app.example.com/x"), DOMAIN)).toBe(true);
    expect(isFirstParty(new URL("https://docs.example.com/"), DOMAIN)).toBe(true);
  });

  it("rejects other hosts and lookalikes", () => {
    expect(isFirstParty(new URL("https://other.com/"), DOMAIN)).toBe(false);
    expect(isFirstParty(new URL("https://example.com.evil.io/"), DOMAIN)).toBe(false);
    expect(isFirstParty(new URL("https://notexample.com/"), DOMAIN)).toBe(false);
  });
});

describe("normalizePageUrl", () => {
  it("strips fragments and tracking params", () => {
    expect(normalizePageUrl("https://example.com/pricing?utm_source=x#Plans")).toBe(
      "https://example.com/pricing",
    );
    expect(normalizePageUrl("https://example.com/contact?fbclid=1.23", "https://example.com/")).toBe(
      "https://example.com/contact",
    );
  });

  it("resolves relative links against the base and rejects non-http(s)", () => {
    expect(normalizePageUrl("/demo", "https://example.com/home")).toBe("https://example.com/demo");
    expect(normalizePageUrl("javascript:void(0)", "https://example.com/")).toBeNull();
    expect(normalizePageUrl("not a url")).toBeNull();
  });
});

describe("classifyRole", () => {
  it("assigns each role from the brief's six-page menu", () => {
    expect(classify("/")).toBe("home");
    expect(classify("/product")).toBe("product");
    expect(classify("/features")).toBe("product");
    expect(classify("/pricing")).toBe("pricing");
    expect(classify("/plans")).toBe("pricing");
    expect(classify("/contact")).toBe("demo_contact");
    expect(classify("/contact-us/")).toBe("demo_contact");
    expect(classify("/demo")).toBe("demo_contact");
    expect(classify("/book-a-call")).toBe("demo_contact");
    expect(classify("/customers")).toBe("customer_proof");
    expect(classify("/case-studies")).toBe("customer_proof");
    expect(classify("/integrations/hubspot")).toBe("integration_use_case");
    expect(classify("/use-cases/sales")).toBe("integration_use_case");
  });

  it("returns null for pages outside the menu — never invents a role", () => {
    expect(classify("/blog/hubspot-tips")).toBeNull();
    expect(classify("/careers")).toBeNull();
    expect(classify("/about")).toBeNull();
  });
});

describe("selectPages", () => {
  const homeLinks = [
    "https://example.com/product",
    "https://example.com/pricing",
    "https://example.com/contact",
    "https://example.com/customers",
    "https://example.com/integrations/hubspot",
    "https://example.com/blog",
    "https://example.com/careers",
    "https://twitter.com/example",
    "https://example.com/?utm_source=home",
  ];

  it("selects home plus one page per role in priority order, bounded by six, from discovered links only", () => {
    const selected = selectPages({ domain: DOMAIN, homeUrl: "https://example.com/", links: homeLinks });
    expect(selected).toHaveLength(6);
    expect(selected.map((c) => c.url)).toEqual([
      "https://example.com/",
      "https://example.com/pricing",
      "https://example.com/contact",
      "https://example.com/product",
      "https://example.com/integrations/hubspot",
      "https://example.com/customers",
    ]);
    const urls = selected.map((c) => c.url);
    expect(new Set(urls).size).toBe(urls.length);
    expect(urls.every((u) => isFirstParty(new URL(u), DOMAIN))).toBe(true);
  });

  it("never exceeds the limit even with many candidate links", () => {
    const many = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => `https://example.com/demo?x=${n}`);
    const selected = selectPages({ domain: DOMAIN, homeUrl: "https://example.com/", links: many });
    expect(selected.length).toBeLessThanOrEqual(6);
  });

  it("keeps an explicitly discovered subdomain page", () => {
    const selected = selectPages({
      domain: DOMAIN,
      homeUrl: "https://example.com/",
      links: ["https://docs.example.com/integrations/hubspot"],
    });
    expect(selected.map((c) => c.url)).toEqual([
      "https://example.com/",
      "https://docs.example.com/integrations/hubspot",
    ]);
  });

  it("selects only home when nothing else is classifiable", () => {
    const selected = selectPages({
      domain: DOMAIN,
      homeUrl: "https://example.com/",
      links: ["https://example.com/about", "https://example.com/careers"],
    });
    expect(selected.map((c) => c.url)).toEqual(["https://example.com/"]);
  });
});
