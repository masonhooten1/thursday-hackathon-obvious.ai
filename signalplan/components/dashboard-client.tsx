"use client";

import { useEffect, useMemo, useState } from "react";
import type { AccountPlan } from "@/lib/contracts";
import type { CompanyAuditBundle } from "@/lib/repositories/types";
import type { DataSources } from "@/lib/data-source";
import { boardRows } from "@/lib/board-rows";
import { useRunStatus } from "@/lib/use-run-status";
import { signOut } from "@/lib/auth-browser";
import { CampaignSetup } from "@/components/campaign-setup";
import { ResearchBoard } from "@/components/research-board";
import { AccountWorkspace } from "@/components/account-workspace";
import { EvidenceDrawer } from "@/components/evidence-drawer";
import { Button, ErrorBanner } from "@/components/ui";
import { ProvenanceChip } from "@/components/chips";

/**
 * Dashboard orchestrator. Owns view state and the run id (persisted in
 * sessionStorage so closing the browser never loses a run — reconnecting
 * resumes polling, brief §Stack). Audit bundles are fetched once per company
 * when it can plausibly have one and cached for the board's plan/vintage
 * columns; the board itself never invents cells for missing plans.
 */

const RUN_ID_KEY = "signalplan:activeRunId";

type View = "setup" | "board" | "company";

export function DashboardClient({ sources }: { sources: DataSources }) {
  const [runId, setRunId] = useState<string | null>(null);
  const [view, setView] = useState<View>("setup");
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);
  const [evidenceCompanyId, setEvidenceCompanyId] = useState<string | null>(null);
  const [bundles, setBundles] = useState<Record<string, CompanyAuditBundle>>({});
  const [bundleError, setBundleError] = useState<string | null>(null);

  // Resume an interrupted session: a stored run id re-arms polling.
  useEffect(() => {
    const stored = window.sessionStorage.getItem(RUN_ID_KEY);
    if (stored) {
      setRunId(stored);
      setView("board");
    }
  }, []);

  const status = useRunStatus(sources, view === "setup" ? null : runId);

  // Cache audit bundles for companies that can have one. Live bundles appear
  // once the pipeline lands; fixture mode serves them immediately.
  useEffect(() => {
    const payload = status.payload;
    if (!payload) return;
    const eligible = payload.companies.filter(
      (c) => !bundles[c.id] && (c.status === "ready" || c.status === "partial"),
    );
    if (eligible.length === 0) return;
    let alive = true;
    setBundleError(null);
    Promise.all(
      eligible.map((c) =>
        sources.audit
          .getCompanyAudit(c.id)
          .then((b) => (b ? ([c.id, b] as const) : null))
          .catch((err: unknown) => {
            // Surface the first failure; other bundles still load.
            if (alive) {
              setBundleError(
                (prev) =>
                  prev ??
                  (err instanceof Error ? err.message : "Loading a company audit failed."),
              );
            }
            return null;
          }),
      ),
    ).then((results) => {
      if (!alive) return;
      setBundles((prev) => {
        const next = { ...prev };
        for (const r of results) if (r) next[r[0]] = r[1];
        return next;
      });
    });
    return () => {
      alive = false;
    };
  }, [status.payload, bundles, sources]);

  const rows = useMemo(() => {
    if (!status.payload) return [];
    const plans: Record<string, AccountPlan | null> = {};
    const evidenceByCompany: Record<string, { limitations: string[]; capturedAt: string }[]> = {};
    for (const [id, b] of Object.entries(bundles)) {
      plans[id] = b.accountPlan;
      evidenceByCompany[id] = b.evidence.map((e) => ({
        limitations: e.limitations,
        capturedAt: e.capturedAt,
      }));
    }
    return boardRows(status.payload, {
      accountPlans: plans,
      evidenceByCompany,
      provenance: sources.provenance,
    });
  }, [status.payload, bundles, sources.provenance]);

  function onRunStarted(newRunId: string) {
    window.sessionStorage.setItem(RUN_ID_KEY, newRunId);
    setRunId(newRunId);
    setBundles({});
    setView("board");
  }

  return (
    <div className="dashboard">
      <header className="app-header">
        <div className="row">
          <strong>SignalPlan</strong>
          <ProvenanceChip provenance={sources.provenance} />
        </div>
        <Button variant="ghost" onClick={() => void signOut()}>
          Sign out
        </Button>
      </header>

      {view === "setup" && (
        <CampaignSetup sources={sources} onRunStarted={onRunStarted} />
      )}

      {view === "board" && status.loading && <p className="muted small">Loading run…</p>}

      {view === "board" && !status.loading && !status.payload && (
        <ErrorBanner
          message={
            status.error ?? "This run could not be loaded. Start a new run from campaign setup."
          }
        />
      )}

      {view === "board" && status.payload && (
        <>
          {status.error && (
            <ErrorBanner
              message={`${status.error} — showing the last known board state.`}
            />
          )}
          {bundleError && (
            <ErrorBanner message={`${bundleError} — some plan columns may be empty.`} />
          )}
          <ResearchBoard
            rows={rows}
            runStatus={status.payload.run.status}
            onCancel={() => void status.cancel()}
            cancelInFlight={status.cancelInFlight}
            refreshing={status.refreshing}
            onRefresh={() => void status.refreshNow()}
            lastCheckedAt={status.lastCheckedAt}
            onOpenCompany={(id) => {
              setSelectedCompanyId(id);
              setView("company");
            }}
            onOpenEvidence={(id) => setEvidenceCompanyId(id)}
          />
          <div className="row" style={{ marginTop: 10 }}>
            <Button variant="ghost" onClick={() => setView("setup")}>
              + New campaign run
            </Button>
          </div>
        </>
      )}

      {view === "company" && selectedCompanyId && (
        <AccountWorkspace
          sources={sources}
          companyId={selectedCompanyId}
          onOpenEvidence={() => setEvidenceCompanyId(selectedCompanyId)}
          onBack={() => setView("board")}
        />
      )}

      {evidenceCompanyId && (
        <EvidenceDrawer
          sources={sources}
          companyId={evidenceCompanyId}
          onClose={() => setEvidenceCompanyId(null)}
        />
      )}
    </div>
  );
}
