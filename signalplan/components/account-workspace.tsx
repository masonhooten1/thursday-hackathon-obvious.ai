"use client";

import { useCallback, useEffect, useState } from "react";
import type { Export, ExportKind } from "@/lib/contracts";
import type { CompanyAuditBundle } from "@/lib/repositories/types";
import type { DataSources } from "@/lib/data-source";
import { Button, Card, ErrorBanner, Spinner } from "@/components/ui";
import { HubspotChip, ReviewChip, StatusChip, VintageChip } from "@/components/chips";
import { scanVintage } from "@/lib/vintage";
import { ReportPreview } from "@/components/report-preview";

/**
 * Account workspace (brief §Interface item 3 + review/export item 4):
 * evidence, public journey, proposed process, recommendations, unknowns, plan
 * preview, and export controls. Every claim links to evidence via the drawer;
 * exports go through the authorized create-or-retrieve endpoint so retrying a
 * click never duplicates an export.
 */

function ExportControls({
  sources,
  companyId,
  disabled,
}: {
  sources: DataSources;
  companyId: string;
  disabled: boolean;
}) {
  const [exports, setExports] = useState<Record<ExportKind, Export | null>>({
    pdf: null,
    csv: null,
  });
  const [inFlight, setInFlight] = useState<ExportKind | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function requestExport(kind: ExportKind) {
    if (inFlight) return;
    setInFlight(kind);
    setError(null);
    try {
      const exp = await sources.export.requestExport(companyId, kind);
      setExports((prev) => ({ ...prev, [kind]: exp }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export request failed.");
    } finally {
      setInFlight(null);
    }
  }

  return (
    <div className="export-controls">
      <div className="row">
        <Button
          variant="primary"
          disabled={disabled || inFlight !== null}
          onClick={() => void requestExport("pdf")}
        >
          {inFlight === "pdf" ? "Requesting…" : "Export PDF"}
        </Button>
        <Button
          variant="ghost"
          disabled={disabled || inFlight !== null}
          onClick={() => void requestExport("csv")}
        >
          {inFlight === "csv" ? "Requesting…" : "Export CSV"}
        </Button>
      </div>
      {error && <ErrorBanner message={error} />}
      {(exports.pdf || exports.csv) && (
        <div className="small" style={{ marginTop: 6 }}>
          {(["pdf", "csv"] as const).map((kind) => {
            const exp = exports[kind];
            if (!exp) return null;
            return (
              <div key={kind} className="row small" style={{ marginBottom: 2 }}>
                <span className={`chip ${exp.status === "ready" ? "chip-green" : exp.status === "failed" ? "chip-red" : "chip-amber"}`}>
                  {kind.toUpperCase()} · {exp.status}
                </span>
                {exp.storageKey && (
                  <code className="muted" style={{ wordBreak: "break-all" }}>
                    private:{exp.storageKey}
                  </code>
                )}
                {exp.error && <span style={{ color: "var(--danger)" }}>{exp.error}</span>}
              </div>
            );
          })}
          <div className="muted">Downloads use short-lived signed URLs after authorization.</div>
        </div>
      )}
    </div>
  );
}

export function AccountWorkspace({
  sources,
  companyId,
  onOpenEvidence,
  onBack,
}: {
  sources: DataSources;
  companyId: string;
  onOpenEvidence: () => void;
  onBack: () => void;
}) {
  const [bundle, setBundle] = useState<CompanyAuditBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    sources.audit
      .getCompanyAudit(companyId)
      .then((b) => {
        setBundle(b);
        setLoading(false);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Loading the workspace failed.");
        setLoading(false);
      });
  }, [sources, companyId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <Spinner label="Loading workspace…" />;
  if (error)
    return (
      <div>
        <ErrorBanner message={error} />
        <Button variant="ghost" onClick={load}>
          Retry
        </Button>
      </div>
    );
  if (!bundle) return <p className="muted small">No audit data exists for this company yet.</p>;

  const { company, evidence, signals, accountPlan: plan } = bundle;
  const planStatus = plan?.status ?? null;

  return (
    <div>
      <div className="row" style={{ marginBottom: 10 }}>
        <Button variant="ghost" onClick={onBack}>
          ← Back to board
        </Button>
        <Button variant="ghost" onClick={onOpenEvidence}>
          Evidence drawer
        </Button>
      </div>

      <Card
        title={`${company.name} — account workspace`}
        action={
          <div className="row">
            <StatusChip status={company.status} />
            <HubspotChip evidence={company.hubspotEvidence} withNote />
            <VintageChip vintage={scanVintage(evidence.map((e) => ({ limitations: e.limitations, capturedAt: e.capturedAt })), new Date())} />
          </div>
        }
      >
        <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
          <div className="small muted">
            <a href={`https://${company.domain}`} target="_blank" rel="noreferrer">
              {company.domain}
            </a>{" "}
            · Review status: <ReviewChip status={planStatus} /> · {evidence.length} evidence records
            · {signals.length} technology signals
          </div>
          <ExportControls sources={sources} companyId={companyId} disabled={!plan} />
        </div>
        {!plan && (
          <p className="small muted" style={{ marginTop: 6 }}>
            Exports unlock once an account plan exists.
          </p>
        )}
      </Card>

      <Card title="Report preview (two-page deliverable)">
        <ReportPreview sources={sources} companyId={companyId} onOpenEvidence={onOpenEvidence} />
      </Card>
    </div>
  );
}
