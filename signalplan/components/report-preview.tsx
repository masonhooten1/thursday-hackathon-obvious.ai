"use client";

import { useEffect, useState } from "react";
import type { AccountPlan, Finding } from "@/lib/contracts";
import type { DataSources } from "@/lib/data-source";
import { ErrorBanner } from "@/components/ui";

/**
 * Two-page report preview (brief §The two-page deliverable). Page 1: company
 * diagnosis, journey map, assessments, three prioritized opportunities,
 * 30-day roadmap. Page 2: proposed HubSpot workflow ("proposed design"),
 * seller outreach with draft-only editable copy, success measures, source
 * key, unknowns. Outreach edits live in component state — this prototype
 * does not persist copy edits, and the chip says so.
 */

const CATEGORY_LABEL: Record<Finding["category"], string> = {
  positioning: "Positioning",
  acquisition: "Acquisition",
  conversion: "Conversion",
  nurture: "Nurture",
  handoff: "Handoff",
  measurement: "Measurement",
};

export function ReportPreview({
  sources,
  companyId,
  onOpenEvidence,
}: {
  sources: DataSources;
  companyId: string;
  onOpenEvidence: () => void;
}) {
  const [plan, setPlan] = useState<AccountPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [drafts, setDrafts] = useState<Record<number, { subject: string; body: string }>>({});

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    sources.audit
      .getCompanyAudit(companyId)
      .then((bundle) => {
        if (!alive) return;
        setPlan(bundle?.accountPlan ?? null);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (!alive) return;
        setError(err instanceof Error ? err.message : "Loading the plan failed.");
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [sources, companyId]);

  if (loading) return <p className="muted small">Loading plan…</p>;
  if (error) return <ErrorBanner message={error} />;
  if (!plan) {
    return (
      <p className="muted small">
        No account plan yet — the plan appears here once analysis completes.
      </p>
    );
  }

  const d = plan.diagnosis;

  return (
    <div className="report-pages">
      <section className="report-page" aria-label="Report preview, page 1">
        <header className="report-page-head">
          <h3>Page 1 — Marketing diagnosis</h3>
          <span className="muted small">Scan date {new Date(d.scanDate).toLocaleDateString()}</span>
        </header>
        <dl className="fact-grid">
          <div>
            <dt>Company</dt>
            <dd>{d.company}</dd>
          </div>
          <div>
            <dt>Offer (from your setup)</dt>
            <dd>{d.offerSummary}</dd>
          </div>
          <div>
            <dt>Likely buyer</dt>
            <dd>{d.likelyBuyer}</dd>
          </div>
          <div>
            <dt>Business model</dt>
            <dd>{d.businessModel}</dd>
          </div>
        </dl>
        {d.uncertainty.length > 0 && (
          <div>
            <strong className="small">Uncertainty</strong>
            <ul className="small" style={{ margin: "4px 0", paddingLeft: 18 }}>
              {d.uncertainty.map((u, i) => (
                <li key={i}>{u}</li>
              ))}
            </ul>
          </div>
        )}

        <h4 className="small">Observed public journey</h4>
        <ol className="small" style={{ margin: "0 0 10px", paddingLeft: 18 }}>
          {d.journey.map((j, i) => (
            <li key={i}>
              <strong>{j.step}:</strong> {j.description}{" "}
              <button className="link small" onClick={onOpenEvidence}>
                {j.evidenceIds.length} evidence
              </button>
            </li>
          ))}
        </ol>

        <h4 className="small">Assessment</h4>
        <ul className="small" style={{ margin: "0 0 10px", paddingLeft: 18 }}>
          {d.assessments.map((a, i) => (
            <li key={i}>
              <span className="chip chip-blue">{CATEGORY_LABEL[a.category]}</span> {a.summary}{" "}
              {a.evidenceIds.length === 0 && <span className="muted">(requires access)</span>}
            </li>
          ))}
        </ul>

        <h4 className="small">Prioritized opportunities</h4>
        <ul className="small" style={{ margin: "0 0 10px", paddingLeft: 18 }}>
          {plan.opportunities.map((o) => (
            <li key={o.id} style={{ marginBottom: 6 }}>
              <strong>
                {o.priority}. {o.title}
              </strong>
              <div>{o.observation}</div>
              <div className="muted">
                Hypothesis: {o.hypothesis}{" "}
                <button className="link small" onClick={onOpenEvidence}>
                  evidence ({o.evidenceIds.length})
                </button>
              </div>
              <div>
                Proposed experiment: {o.proposedExperiment}
                {o.validationNeeded.length > 0 && (
                  <div className="muted">Validate: {o.validationNeeded.join("; ")}</div>
                )}
              </div>
            </li>
          ))}
        </ul>

        <h4 className="small">Proposed 30-day roadmap</h4>
        <table className="mini-table small">
          <thead>
            <tr>
              <th>Owner</th>
              <th>Experiment</th>
              <th>Metric</th>
              <th>Baseline</th>
            </tr>
          </thead>
          <tbody>
            {plan.roadmap30.map((r, i) => (
              <tr key={i}>
                <td>{r.owner}</td>
                <td>{r.experiment}</td>
                <td>{r.metric}</td>
                <td>{r.baseline ?? <span className="muted">establish first</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="report-page" aria-label="Report preview, page 2">
        <header className="report-page-head">
          <h3>Page 2 — HubSpot proposal and outreach</h3>
          <span className="chip chip-violet">{plan.hubspotProposal.label}</span>
        </header>

        <h4 className="small">Proposed workflow</h4>
        <div className="small" style={{ marginBottom: 10 }}>
          <div>
            <strong>Trigger:</strong> {plan.hubspotProposal.trigger}
          </div>
          {plan.hubspotProposal.conditions.length > 0 && (
            <div>
              <strong>Conditions:</strong> {plan.hubspotProposal.conditions.join("; ")}
            </div>
          )}
          <div>
            <strong>Actions:</strong>
            <ul style={{ margin: "2px 0", paddingLeft: 18 }}>
              {plan.hubspotProposal.actions.map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ul>
          </div>
          <div>
            <strong>Exit criteria:</strong> {plan.hubspotProposal.exitCriteria.join("; ")}
          </div>
          <div>
            <strong>Owner:</strong> {plan.hubspotProposal.owner} ·{" "}
            <strong>Measurement:</strong> {plan.hubspotProposal.measurement}
          </div>
          <div className="muted">
            Validate before implementing: {plan.hubspotProposal.prerequisites.join("; ")}
          </div>
        </div>

        <h4 className="small">Seller outreach (draft)</h4>
        <div className="row small" style={{ marginBottom: 6 }}>
          <span className="chip chip-amber">draft — edits are not persisted in this prototype</span>
        </div>
        <div className="small" style={{ marginBottom: 10 }}>
          <div>
            <strong>Approach:</strong> {plan.outreach.buyerRole}
          </div>
          <div>
            <strong>Discovery question:</strong> {plan.outreach.discoveryQuestion}
          </div>
          <div style={{ marginTop: 4 }}>
            <strong>Offer:</strong> {plan.outreach.offer}
          </div>
        </div>
        {plan.outreach.sequence.map((t) => {
          const draft = drafts[t.touch] ?? { subject: t.subject, body: t.body };
          return (
            <div key={t.touch} className="field" style={{ marginBottom: 8 }}>
              <label htmlFor={`touch-${t.touch}`}>Touch {t.touch}</label>
              <input
                id={`touch-${t.touch}`}
                type="text"
                value={draft.subject}
                onChange={(e) =>
                  setDrafts((prev) => ({
                    ...prev,
                    [t.touch]: { ...draft, subject: e.target.value },
                  }))
                }
              />
              <textarea
                aria-label={`Touch ${t.touch} body`}
                value={draft.body}
                onChange={(e) =>
                  setDrafts((prev) => ({ ...prev, [t.touch]: { ...draft, body: e.target.value } }))
                }
              />
            </div>
          );
        })}

        {plan.outreach.successMeasures.length > 0 && (
          <div className="small" style={{ marginBottom: 10 }}>
            <strong>Success measures:</strong> {plan.outreach.successMeasures.join("; ")} — no lift
            is promised before baseline data exists.
          </div>
        )}

        <div className="small" style={{ marginBottom: 6 }}>
          <strong>Unknowns to validate in discovery</strong>
          <ul style={{ margin: "4px 0", paddingLeft: 18 }}>
            {plan.unknowns.length === 0 && <li className="muted">None recorded.</li>}
            {plan.unknowns.map((u, i) => (
              <li key={i}>{u}</li>
            ))}
          </ul>
        </div>

        <div className="small muted" style={{ wordBreak: "break-all" }}>
          <strong>Source key:</strong> {plan.sourceKey}
        </div>
      </section>
    </div>
  );
}
