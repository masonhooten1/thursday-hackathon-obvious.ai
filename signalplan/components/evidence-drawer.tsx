"use client";

import { useEffect, useState } from "react";
import type { CompanyAuditBundle } from "@/lib/repositories/types";
import type { DataSources } from "@/lib/data-source";
import { Button, ErrorBanner, Spinner } from "@/components/ui";
import { HubspotChip, VintageChip } from "@/components/chips";
import { scanVintage } from "@/lib/vintage";

/**
 * Evidence drawer (brief §Interface: expandable evidence cards with URLs,
 * excerpts, timestamps, and collection limitations; the reviewer can
 * immediately distinguish fresh scans, cached evidence, incomplete scans).
 * Data comes from the authenticated audit endpoint or the fixture bundle —
 * never invented.
 */

const METHOD_LABEL: Record<string, string> = {
  html: "HTML",
  rendered_dom: "Rendered DOM",
  network: "Network",
  first_party_text: "First-party text",
};

export function EvidenceDrawer({
  sources,
  companyId,
  onClose,
}: {
  sources: DataSources;
  companyId: string;
  onClose: () => void;
}) {
  const [bundle, setBundle] = useState<CompanyAuditBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    setBundle(null);
    sources.audit
      .getCompanyAudit(companyId)
      .then((b) => {
        if (!alive) return;
        setBundle(b);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (!alive) return;
        setError(err instanceof Error ? err.message : "Loading evidence failed.");
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [sources, companyId]);

  const now = new Date();
  const evidence = bundle?.evidence ?? [];

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} aria-hidden />
      <aside
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Evidence drawer"
      >
        <div className="drawer-head">
          <h2>
            Evidence — {bundle ? bundle.company.name : "loading"}
          </h2>
          <Button onClick={onClose} aria-label="Close evidence drawer">
            Close
          </Button>
        </div>
        <div className="drawer-body">
          {loading && <Spinner label="Loading evidence…" />}
          {error && <ErrorBanner message={error} />}
          {!loading && !error && !bundle && (
            <p className="muted small">No audit bundle exists for this company yet.</p>
          )}
          {bundle && (
            <>
              <div className="row">
                <HubspotChip evidence={bundle.company.hubspotEvidence} withNote />
                <VintageChip
                  vintage={scanVintage(evidence.map((e) => ({ limitations: e.limitations, capturedAt: e.capturedAt })), now)}
                />
              </div>

              <div>
                <h3 className="small" style={{ margin: "4px 0" }}>
                  Evidence records ({evidence.length})
                </h3>
                {evidence.length === 0 && (
                  <p className="muted small">No evidence captured yet.</p>
                )}
                {evidence.map((e) => (
                  <div key={e.id} className="evidence-card" style={{ marginBottom: 8 }}>
                    <div className="row small">
                      <span className="chip chip-blue">{METHOD_LABEL[e.method] ?? e.method}</span>
                      <span className="muted">{new Date(e.capturedAt).toLocaleString()}</span>
                    </div>
                    <a href={e.url} target="_blank" rel="noreferrer" className="small">
                      {e.url}
                    </a>
                    {e.locator && (
                      <code className="small muted" style={{ wordBreak: "break-all" }}>
                        {e.locator}
                      </code>
                    )}
                    <blockquote>{e.excerpt}</blockquote>
                    {e.limitations.length > 0 && (
                      <div className="row">
                        {e.limitations.map((l, i) => (
                          <span key={i} className="chip chip-amber">
                            {l}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {bundle.signals.length > 0 && (
                <div>
                  <h3 className="small" style={{ margin: "4px 0" }}>
                    Technology signals ({bundle.signals.length})
                  </h3>
                  {bundle.signals.map((s) => (
                    <div key={s.id} className="evidence-card" style={{ marginBottom: 8 }}>
                      <div className="row small">
                        <strong>{s.vendor}</strong>
                        <VintageChip
                          vintage={
                            s.integrationStatus === "scan_incomplete"
                              ? "incomplete"
                              : s.integrationStatus === "observed"
                                ? "fresh"
                                : null
                          }
                        />
                      </div>
                      <code className="small muted" style={{ wordBreak: "break-all" }}>
                        {s.signature}
                      </code>
                    </div>
                  ))}
                </div>
              )}

              {bundle.captures.length > 0 && (
                <div>
                  <h3 className="small" style={{ margin: "4px 0" }}>
                    Collected pages ({bundle.captures.length})
                  </h3>
                  <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
                    {bundle.captures.map((p) => (
                      <li key={p.id}>
                        <code>{p.url}</code>{" "}
                        <span className="muted">
                          · {p.role} · {p.method}
                          {p.httpStatus ? ` · HTTP ${p.httpStatus}` : ""}
                        </span>
                        {p.error && <div className="small" style={{ color: "var(--danger)" }}>{p.error}</div>}
                        {p.limitations.length > 0 && (
                          <div className="row" style={{ marginTop: 2 }}>
                            {p.limitations.map((l, i) => (
                              <span key={i} className="chip chip-amber">
                                {l}
                              </span>
                            ))}
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      </aside>
    </>
  );
}
