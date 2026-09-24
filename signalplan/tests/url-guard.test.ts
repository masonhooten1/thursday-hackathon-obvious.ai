import { describe, expect, it } from "vitest";
import {
  BlockedDestinationError,
  assertPublicAddress,
  assertPublicUrl,
  guardedFetch,
  isBlockedIpv4,
  isBlockedIpv6,
} from "@/workers/collector/url-guard";

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    if (err instanceof BlockedDestinationError) return err.code;
    throw err;
  }
  throw new Error("expected the call to be blocked");
}

describe("assertPublicUrl — structural blocks (check 8)", () => {
  it("blocks loopback and this-network IPv4 literals", () => {
    expect(codeOf(() => assertPublicUrl("http://127.0.0.1/"))).toBe("IP_LITERAL_NOT_ALLOWED");
    expect(codeOf(() => assertPublicUrl("http://127.1.2.3/"))).toBe("IP_LITERAL_NOT_ALLOWED");
    expect(codeOf(() => assertPublicUrl("http://0.0.0.0/"))).toBe("IP_LITERAL_NOT_ALLOWED");
  });

  it("blocks RFC1918 private IPv4 literals", () => {
    expect(codeOf(() => assertPublicUrl("http://10.1.2.3/"))).toBe("IP_LITERAL_NOT_ALLOWED");
    expect(codeOf(() => assertPublicUrl("http://172.16.0.1/"))).toBe("IP_LITERAL_NOT_ALLOWED");
    expect(codeOf(() => assertPublicUrl("http://172.31.255.255/"))).toBe("IP_LITERAL_NOT_ALLOWED");
    expect(codeOf(() => assertPublicUrl("http://192.168.1.1/"))).toBe("IP_LITERAL_NOT_ALLOWED");
  });

  it("blocks link-local and cloud-metadata addresses", () => {
    expect(codeOf(() => assertPublicUrl("http://169.254.169.254/latest/meta-data/"))).toBe(
      "IP_LITERAL_NOT_ALLOWED",
    );
    expect(isBlockedIpv4("169.254.169.254")).toBe(true);
  });

  it("blocks loopback, link-local, and unique-local IPv6 forms", () => {
    expect(codeOf(() => assertPublicUrl("http://[::1]/"))).toBe("IP_LITERAL_NOT_ALLOWED");
    expect(codeOf(() => assertPublicUrl("http://[fe80::1]/"))).toBe("IP_LITERAL_NOT_ALLOWED");
    expect(codeOf(() => assertPublicUrl("http://[fc00::1]/"))).toBe("IP_LITERAL_NOT_ALLOWED");
    expect(codeOf(() => assertPublicUrl("http://[fd12:3456::1]/"))).toBe("IP_LITERAL_NOT_ALLOWED");
    expect(codeOf(() => assertPublicUrl("http://[::ffff:127.0.0.1]/"))).toBe("IP_LITERAL_NOT_ALLOWED");
    expect(isBlockedIpv6("::ffff:10.0.0.5")).toBe(true);
  });

  it("blocks reserved hostnames and internal pseudo-TLDs", () => {
    expect(codeOf(() => assertPublicUrl("http://localhost/"))).toBe("RESERVED_HOST");
    expect(codeOf(() => assertPublicUrl("http://metadata.google.internal/"))).toBe("RESERVED_HOST");
    expect(codeOf(() => assertPublicUrl("https://acme.internal/"))).toBe("RESERVED_TLD");
    expect(codeOf(() => assertPublicUrl("https://acme.local/"))).toBe("RESERVED_TLD");
    expect(codeOf(() => assertPublicUrl("https://acme.localhost/"))).toBe("RESERVED_TLD");
  });

  it("blocks non-http schemes, embedded credentials, and non-standard ports", () => {
    expect(codeOf(() => assertPublicUrl("file:///etc/passwd"))).toBe("NOT_HTTP_S");
    expect(codeOf(() => assertPublicUrl("ftp://example.com/"))).toBe("NOT_HTTP_S");
    expect(codeOf(() => assertPublicUrl("https://user:pass@example.com/"))).toBe("CREDENTIALS_IN_URL");
    expect(codeOf(() => assertPublicUrl("https://example.com:8080/"))).toBe("PORT_NOT_ALLOWED");
  });

  it("allows public destinations", () => {
    expect(assertPublicUrl("https://example.com/path").hostname).toBe("example.com");
    expect(assertPublicUrl("http://example.com/").protocol).toBe("http:");
    expect(assertPublicUrl("https://192.0.2.0.example.com/").hostname).toBe("192.0.2.0.example.com");
  });
});

describe("assertPublicAddress — DNS resolution blocks (check 8)", () => {
  it("blocks resolved private and metadata addresses", () => {
    expect(() => assertPublicAddress("10.0.0.1")).toThrow(BlockedDestinationError);
    expect(() => assertPublicAddress("169.254.169.254")).toThrow(BlockedDestinationError);
    expect(() => assertPublicAddress("fe80::1")).toThrow(BlockedDestinationError);
    expect(() => assertPublicAddress("::1")).toThrow(BlockedDestinationError);
  });

  it("allows public addresses", () => {
    expect(() => assertPublicAddress("93.184.216.34")).not.toThrow();
  });
});

describe("guardedFetch — redirect chains (check 8)", () => {
  const dns = (map: Record<string, string[]>) => async (host: string) => {
    const hit = map[host];
    if (!hit) throw new Error(`unexpected lookup: ${host}`);
    return hit;
  };

  function redirectResponse(location: string, status = 302): Response {
    return new Response(null, { status, headers: { location } });
  }

  it("follows public redirects and returns the final response", async () => {
    const calls: string[] = [];
    const response = await guardedFetch("https://example.com/start", {
      resolveDns: dns({
        "example.com": ["93.184.216.34"],
        "www.example.com": ["93.184.216.34"],
      }),
      fetchImpl: async (input) => {
        calls.push(String(input));
        if (calls.length === 1) return redirectResponse("https://www.example.com/final");
        return new Response("<html>ok</html>", { status: 200 });
      },
    });
    expect(response.status).toBe(200);
    expect(calls).toEqual(["https://example.com/start", "https://www.example.com/final"]);
  });

  it("blocks a redirect to a private address before fetching it", async () => {
    const fetched: string[] = [];
    await expect(
      guardedFetch("https://example.com/", {
        resolveDns: dns({
          "example.com": ["93.184.216.34"],
          "169.254.169.254": [], // never reached — structural block fires first
        }),
        fetchImpl: async (input) => {
          fetched.push(String(input));
          return redirectResponse("http://169.254.169.254/latest/meta-data/");
        },
      }),
    ).rejects.toMatchObject({ code: "IP_LITERAL_NOT_ALLOWED" });
    expect(fetched).toHaveLength(1); // only the public first hop was fetched
  });

  it("blocks a public hostname whose DNS resolves into RFC1918 space", async () => {
    await expect(
      guardedFetch("https://rebind.evil.com/", {
        resolveDns: dns({ "rebind.evil.com": ["192.168.0.10"] }),
        fetchImpl: async () => {
          throw new Error("fetch must not be reached");
        },
      }),
    ).rejects.toMatchObject({ code: "RESOLVED_TO_PRIVATE_ADDRESS" });
  });

  it("blocks a redirect chain that exceeds the bounded hop count", async () => {
    await expect(
      guardedFetch("https://example.com/loop", {
        resolveDns: dns({ "example.com": ["93.184.216.34"] }),
        fetchImpl: async () => redirectResponse("https://example.com/loop"),
        maxRedirects: 2,
      }),
    ).rejects.toMatchObject({ code: "REDIRECT_LIMIT" });
  });

  it("blocks a relative redirect resolving to a private literal", async () => {
    await expect(
      guardedFetch("https://example.com/x", {
        resolveDns: dns({ "example.com": ["93.184.216.34"] }),
        fetchImpl: async () => redirectResponse("//10.0.0.9/admin"),
      }),
    ).rejects.toMatchObject({ code: "IP_LITERAL_NOT_ALLOWED" });
  });
});
