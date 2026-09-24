import { createHash } from "node:crypto";
import type { CampaignConfig } from "./schemas";

/**
 * AdsClient — the one seam between StayRadar and Google Ads (spec
 * art_XasJ5Kw8, "AdsClient — mock now, live later, one swap").
 *
 * `MockGoogleAdsClient` is the shipping path: deterministic, no network, no
 * credentials. It records every payload it accepts and returns a stable
 * synthetic resource name derived from the payload's hash — the same config
 * always gets the same resource name, so tests and demos are reproducible.
 *
 * The live implementation (`LiveGoogleAdsClient`) is a later swap at this
 * interface. It needs, and only then:
 *   1. a Google Ads developer token (human-approved, days-long process),
 *   2. an OAuth2 refresh token + manager/customer id, stored via the project
 *      secrets flow — never in code,
 *   3. a retry/backoff wrapper around the REST/gRPC surface.
 * Nothing in the campaign config changes when that swap lands: the export
 * path (JSON/CSV for Google Ads Editor) remains the handoff workflow until
 * then.
 */
export interface AdsClient {
  /** Short id recorded on stored configs, e.g. "mock". */
  readonly clientName: string;
  createCampaign(config: CampaignConfig): Promise<{ resourceName: string }>;
}

interface MockSubmission {
  config: CampaignConfig;
  resourceName: string;
  sequence: number;
}

const MOCK_CUSTOMER_ID = "mock-0001";

export class MockGoogleAdsClient implements AdsClient {
  readonly clientName = "mock";

  private submissions: MockSubmission[] = [];
  private sequence = 0;

  async createCampaign(config: CampaignConfig): Promise<{ resourceName: string }> {
    const digest = createHash("sha256").update(JSON.stringify(config)).digest("hex").slice(0, 12);
    const resourceName = `customers/${MOCK_CUSTOMER_ID}/campaigns/${digest}`;
    this.sequence += 1;
    // Deep-copy so later mutations of the caller's object cannot rewrite history.
    this.submissions.push(structuredClone({ config, resourceName, sequence: this.sequence }));
    return { resourceName };
  }

  /** Recorded payloads — a deep copy; mutating it cannot corrupt the log. */
  getSubmissions(): MockSubmission[] {
    return structuredClone(this.submissions);
  }

  reset(): void {
    this.submissions = [];
    this.sequence = 0;
  }
}

/**
 * Default client for request paths. Today that is always the mock; when the
 * live client exists it will activate here based on stored credentials only —
 * the call sites never change.
 */
export function getAdsClient(): AdsClient {
  return new MockGoogleAdsClient();
}
