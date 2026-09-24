"use client";

import type { Export, ExportKind, ModelSettingsMetadata, Run } from "@/lib/contracts";
import { apiFetch } from "@/lib/api-client";
import type { CompanyAuditBundle } from "@/lib/repositories/types";
import type { DataSources, RunStatusPayload } from "@/lib/data-source";
import {
  advanceFixtureRun,
  cancelFixtureRun,
} from "@/lib/fixture-ticker";
import {
  FIXTURE_CAMPAIGN_ID,
  FIXTURE_RUN_ID,
  fixtureAuditBundles,
  fixtureCampaign,
  fixtureCompanies,
  fixtureRun,
} from "@/fixtures";

/**
 * Source selection. Fixture preview is an explicit operator choice — the
 * `sp_preview` cookie set from the sign-in screen — never a silent fallback
 * for failed live calls. A live-data failure renders an error state, because
 * quietly substituting synthetic data for a failed scan would violate the
 * brief's labeling rules.
 */
export function isFixturePreview(): boolean {
  if (typeof document === "undefined") return false;
  return document.cookie.includes(`${"sp_preview"}=fixtures`);
}

export function selectSources(): DataSources {
  return isFixturePreview() ? fixtureSources : liveSources;
}

// ── Live sources (authenticated API) ────────────────────────────────────────

export const liveSources: DataSources = {
  provenance: "live",
  campaign: {
    createCampaign: (input) =>
      apiFetch<Campaign>("/api/campaigns", { method: "POST", body: input }),
    createRun: (campaignId, input) =>
      apiFetch<{ run: Run }>(`/api/campaigns/${encodeURIComponent(campaignId)}/runs`, {
        method: "POST",
        body: input,
      }).then((r) => r.run),
  },
  runStatus: {
    getRunStatus: (runId) =>
      apiFetch<RunStatusPayload>(`/api/runs/${encodeURIComponent(runId)}`),
    cancelRun: (runId) =>
      apiFetch<{ run: Run }>(`/api/runs/${encodeURIComponent(runId)}/cancel`, {
        method: "POST",
        body: {},
      }).then((r) => r.run),
  },
  audit: {
    getCompanyAudit: (companyId) =>
      apiFetch<CompanyAuditBundle | null>(`/api/companies/${encodeURIComponent(companyId)}/audit`),
  },
  export: {
    requestExport: (companyId, kind) =>
      apiFetch<Export>(`/api/companies/${encodeURIComponent(companyId)}/export`, {
        method: "POST",
        body: { kind },
      }),
  },
  settings: {
    get: () => apiFetch<ModelSettingsMetadata>("/api/settings"),
    save: (provider, apiKey) =>
      apiFetch<ModelSettingsMetadata>("/api/settings", {
        method: "POST",
        body: { provider, apiKey },
      }),
  },
};

// ── Fixture sources ─────────────────────────────────────────────────────────

interface FixtureState {
  payload: RunStatusPayload;
}

/**
 * Module-level fixture run state: the ticker advances it on every poll so the
 * board visibly progresses through the state machine during a demo, while
 * terminal companies (failed, blocked, cancelled, ready, partial) stay put.
 */
const state: FixtureState = {
  payload: {
    run: structuredClone(fixtureRun),
    companies: fixtureCompanies.map((c) => ({
      id: c.id,
      name: c.name,
      domain: c.domain,
      status: c.status,
      hubspotEvidence: c.hubspotEvidence,
      score: c.score,
    })),
  },
};

export function resetFixtureRun(): void {
  state.payload = {
    run: structuredClone(fixtureRun),
    companies: fixtureCompanies.map((c) => ({
      id: c.id,
      name: c.name,
      domain: c.domain,
      status: c.status,
      hubspotEvidence: c.hubspotEvidence,
      score: c.score,
    })),
  };
}

export const fixtureSources: DataSources = {
  provenance: "fixture",
  campaign: {
    createCampaign: async () => {
      // The fixture campaign is fixed by construction; a distinct name in the
      // setup form is cosmetic. The returned campaign is never persisted.
      return structuredClone(fixtureCampaign);
    },
    createRun: async (_campaignId, input) => {
      // Starting a fixture run rewinds the ticker state; the submitted domain
      // list is echoed into companiesTotal for the operator's sanity check.
      resetFixtureRun();
      if (input.domains.length !== fixtureCompanies.length) {
        // The fixture run has a fixed company set; a differing batch is fine —
        // the board shows the fixture companies regardless — but the run
        // header reflects what the operator actually submitted.
        state.payload = {
          ...state.payload,
          run: { ...state.payload.run, companiesTotal: input.domains.length },
        };
      }
      return structuredClone(state.payload.run);
    },
  },
  runStatus: {
    getRunStatus: async (runId) => {
      if (runId !== FIXTURE_RUN_ID) {
        throw new Error("Unknown fixture run — the fixture preview uses the built-in demo run.");
      }
      state.payload = advanceFixtureRun(state.payload);
      return structuredClone(state.payload);
    },
    cancelRun: async (runId) => {
      if (runId !== FIXTURE_RUN_ID) {
        throw new Error("Unknown fixture run — the fixture preview uses the built-in demo run.");
      }
      state.payload = cancelFixtureRun(state.payload);
      return structuredClone(state.payload.run);
    },
  },
  audit: {
    getCompanyAudit: async (companyId) => {
      const bundle = fixtureAuditBundles[companyId];
      return bundle ? structuredClone(bundle) : null;
    },
  },
  export: {
    // Fixture exports resolve immediately and are clearly labeled; the CSV
    // download in fixture mode is generated client-side from fixture data.
    requestExport: async (companyId, kind) => {
      const created: Export = {
        id: crypto.randomUUID(),
        companyId,
        workspaceId: fixtureCampaign.workspaceId,
        kind,
        status: "ready",
        storageKey: `fixtures/exports/${companyId}-${kind}`,
        createdAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      };
      return created;
    },
  },
  settings: {
    get: async () => ({ provider: null, keyLastFour: null, updatedAt: null }),
    save: async () => {
      throw new Error(
        "Fixture preview — model keys are saved server-side only in a live session.",
      );
    },
  },
};

export const FIXTURE_CAMPAIGN_REF = { id: FIXTURE_CAMPAIGN_ID, campaign: fixtureCampaign };