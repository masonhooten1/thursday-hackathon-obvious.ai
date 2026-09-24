"use client";

import { useMemo, useRef, useState } from "react";
import type { DataSources } from "@/lib/data-source";
import { parseIntakeCsv, parseIntakeText, type IntakeResult } from "@/lib/intake";
import { Button, Card, ErrorBanner } from "@/components/ui";
import { ProvenanceChip } from "@/components/chips";

/**
 * Campaign setup (brief §Interface item 1): offer, ICP, URL/CSV intake with
 * limits, start. Client-side intake parsing only shapes feedback — the API
 * re-validates authoritatively. The run-creation idempotency key is generated
 * once per mounted form so a double-click or a retry of the same submission
 * reuses the key instead of duplicating companies or charges.
 */

export function CampaignSetup({
  sources,
  onRunStarted,
}: {
  sources: DataSources;
  onRunStarted: (runId: string) => void;
}) {
  const [name, setName] = useState("AI outbound audit");
  const [headline, setHeadline] = useState("");
  const [idealCustomerProfile, setIcp] = useState("");
  const [differentiators, setDifferentiators] = useState("");
  const [proofPoints, setProofPoints] = useState("");
  const [exclusions, setExclusions] = useState("");
  const [callToAction, setCta] = useState("");
  const [intakeText, setIntakeText] = useState("");
  const [csvMode, setCsvMode] = useState(false);
  const [limits, setLimits] = useState({ maxCompanies: 25, maxModelRequests: 8 });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Stable across re-submissions of this form instance (see doc comment).
  const idempotencyKey = useRef<string>(crypto.randomUUID());

  const intake: IntakeResult = useMemo(
    () => (csvMode ? parseIntakeCsv(intakeText) : parseIntakeText(intakeText)),
    [intakeText, csvMode],
  );

  async function onCsv(file: File) {
    const text = await file.text();
    // Replace, not append: the file is the operator's newest intent.
    setCsvMode(true);
    setIntakeText(text);
  }

  const list = (v: string) =>
    v
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);

  const offerInvalid = !headline.trim() || !idealCustomerProfile.trim();
  const domainCount = intake.validDomains.length;
  const canSubmit = !offerInvalid && domainCount >= 1 && domainCount <= 25 && !submitting;

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const campaign = await sources.campaign.createCampaign({
        name,
        offer: {
          headline: headline.trim(),
          idealCustomerProfile: idealCustomerProfile.trim(),
          differentiators: list(differentiators),
          proofPoints: list(proofPoints),
          exclusions: list(exclusions),
          ...(callToAction.trim() ? { callToAction: callToAction.trim() } : {}),
        },
        limits: { maxCompanies: limits.maxCompanies, maxModelRequests: limits.maxModelRequests },
      });
      const run = await sources.campaign.createRun(campaign.id, {
        domains: intake.validDomains,
        idempotencyKey: idempotencyKey.current,
      });
      onRunStarted(run.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Starting the run failed.");
    } finally {
      setSubmitting(false);
    }
  }

  const invalidItems = intake.items.filter((i) => i.error);

  return (
    <Card title="Campaign setup" action={<ProvenanceChip provenance={sources.provenance} />}>
      <div className="grid-2">
        <div>
          <div className="field">
            <label htmlFor="camp-name">Campaign name</label>
            <input id="camp-name" type="text" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="camp-offer">Your offer (headline)</label>
            <textarea
              id="camp-offer"
              value={headline}
              onChange={(e) => setHeadline(e.target.value)}
              placeholder="e.g. Funnel and automation audit for HubSpot teams adopting AI outbound"
            />
          </div>
          <div className="field">
            <label htmlFor="camp-icp">Ideal customer profile</label>
            <textarea
              id="camp-icp"
              value={idealCustomerProfile}
              onChange={(e) => setIcp(e.target.value)}
              placeholder="e.g. B2B AI software companies with a demo-led sales motion and a public HubSpot integration"
            />
          </div>
          <div className="field">
            <label htmlFor="camp-diff">Differentiators (one per line)</label>
            <textarea
              id="camp-diff"
              value={differentiators}
              onChange={(e) => setDifferentiators(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="camp-proof">Proof points (one per line)</label>
            <textarea id="camp-proof" value={proofPoints} onChange={(e) => setProofPoints(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="camp-excl">Exclusions (one per line)</label>
            <textarea id="camp-excl" value={exclusions} onChange={(e) => setExclusions(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="camp-cta">Preferred call to action (optional)</label>
            <input id="camp-cta" type="text" value={callToAction} onChange={(e) => setCta(e.target.value)} />
          </div>
        </div>

        <div>
          <div className="field">
            <label htmlFor="camp-urls">Company domains (paste, or upload CSV — 1–25)</label>
            <textarea
              id="camp-urls"
              value={intakeText}
              onChange={(e) => {
                setCsvMode(false);
                setIntakeText(e.target.value);
              }}
              placeholder={"compa.ai\ncrescendo.ai\nhttps://hex.tech"}
            />
            <div className="row small muted" style={{ marginTop: 6 }}>
              <label htmlFor="camp-csv" className="small" style={{ margin: 0 }}>
                or upload CSV:
              </label>
              <input
                id="camp-csv"
                type="file"
                accept=".csv,text/csv"
                style={{ maxWidth: 220 }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void onCsv(f);
                }}
              />
            </div>
          </div>

          <div className="row small" style={{ marginBottom: 10 }}>
            <span className="chip chip-green">{domainCount} valid</span>
            {invalidItems.length > 0 && (
              <span className="chip chip-red">{invalidItems.length} rejected</span>
            )}
          </div>

          {invalidItems.length > 0 && (
            <div
              className="card"
              style={{ background: "var(--surface-2)", padding: 10, marginBottom: 10 }}
            >
              <strong className="small">Rejected candidates</strong>
              <ul className="small muted" style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                {invalidItems.slice(0, 8).map((i, n) => (
                  <li key={`${i.raw}-${n}`}>
                    <code>{i.raw}</code> — {i.error}
                  </li>
                ))}
                {invalidItems.length > 8 && <li>… and {invalidItems.length - 8} more</li>}
              </ul>
            </div>
          )}

          <div className="field">
            <label htmlFor="camp-max-companies">Max companies (1–25)</label>
            <input
              id="camp-max-companies"
              type="number"
              min={1}
              max={25}
              value={limits.maxCompanies}
              onChange={(e) =>
                setLimits((l) => ({
                  ...l,
                  maxCompanies: Number(e.target.value) || l.maxCompanies,
                }))
              }
            />
          </div>
          <div className="field">
            <label htmlFor="camp-max-model">Global model-request cap (BYOK)</label>
            <input
              id="camp-max-model"
              type="number"
              min={1}
              max={50}
              value={limits.maxModelRequests}
              onChange={(e) =>
                setLimits((l) => ({
                  ...l,
                  maxModelRequests: Number(e.target.value) || l.maxModelRequests,
                }))
              }
            />
          </div>

          {error && <ErrorBanner message={error} />}

          <div className="row" style={{ marginTop: 12 }}>
            <Button variant="primary" disabled={!canSubmit} onClick={() => void submit()}>
              {submitting ? "Starting…" : "Start audit run"}
            </Button>
            {offerInvalid && <span className="small muted">Offer and ICP are required.</span>}
            {!offerInvalid && domainCount === 0 && (
              <span className="small muted">Add at least one valid domain.</span>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}
