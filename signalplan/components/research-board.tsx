"use client";

import { useMemo, useState } from "react";
import type { Finding } from "@/lib/contracts";
import type { BoardRow } from "@/lib/board-rows";
import { Button, Card, EmptyState } from "@/components/ui";
import {
  HubspotChip,
  ReviewChip,
  RUN_STATUS_LABEL,
  StatusChip,
  VintageChip,
} from "@/components/chips";

/**
 * Live research board (brief §Interface item 2): companies, status, HubSpot
 * evidence, strongest opportunity, review status, score reasons, scan
 * vintage. Filterable by HubSpot evidence, opportunity theme (the plan's
 * assessment categories), and review status. Rows open the account
 * workspace; the evidence button opens the drawer without navigating.
 */

type HubspotValue = NonNullable<BoardRow["company"]["hubspotEvidence"]>["publicIntegration"];
type HubspotFilter = "all" | HubspotValue | "unchecked";

const OPPORTUNITY_THEME_LABEL: Record<Finding["category"], string> = {
  positioning: "Positioning",
  acquisition: "Acquisition",
  conversion: "Conversion",
  nurture: "Nurture",
  handoff: "Handoff",
  measurement: "Measurement",
};

export function ResearchBoard({
  rows,
  runStatus,
  onCancel,
  cancelInFlight,
  refreshing,
  onRefresh,
  lastCheckedAt,
  onOpenCompany,
  onOpenEvidence,
}: {
  rows: BoardRow[];
  runStatus: string;
  onCancel: () => void;
  cancelInFlight: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  lastCheckedAt: string | null;
  onOpenCompany: (companyId: string) => void;
  onOpenEvidence: (companyId: string) => void;
}) {
  const [hubspot, setHubspot] = useState<HubspotFilter>("all");
  const [theme, setTheme] = useState<"all" | Finding["category"]>("all");
  const [review, setReview] = useState<string>("all");

  const themes = useMemo(() => {
    const present = new Set<Finding["category"]>();
    for (const row of rows) for (const c of row.assessmentCategories) present.add(c);
    return [...present];
  }, [rows]);

  const reviewValues = useMemo(() => {
    const present = new Set<string>();
    for (const r of rows) if (r.reviewStatus) present.add(r.reviewStatus);
    return [...present];
  }, [rows]);

  const filtered = rows.filter((r) => {
    if (hubspot !== "all") {
      const value = r.company.hubspotEvidence?.publicIntegration ?? "unchecked";
      if (value !== hubspot) return false;
    }
    if (theme !== "all" && !r.assessmentCategories.includes(theme)) return false;
    if (review !== "all" && (r.reviewStatus ?? "none") !== review) return false;
    return true;
  });

  const cancellable = runStatus === "queued" || runStatus === "running";

  return (
    <Card
      title={`Research board — ${RUN_STATUS_LABEL[runStatus as keyof typeof RUN_STATUS_LABEL] ?? runStatus}`}
      action={
        <div className="row">
          <Button variant="ghost" onClick={onRefresh} disabled={refreshing}>
            {refreshing ? "Refreshing…" : "Refresh"}
          </Button>
          <Button variant="danger" onClick={onCancel} disabled={!cancellable || cancelInFlight}>
            {cancelInFlight ? "Cancelling…" : "Cancel run"}
          </Button>
        </div>
      }
    >
      <div className="row small muted" style={{ marginBottom: 10 }}>
        <span>
          Last checked: {lastCheckedAt ? new Date(lastCheckedAt).toLocaleTimeString() : "—"}
        </span>
      </div>

      <div className="row" style={{ marginBottom: 12 }}>
        <select
          aria-label="Filter by HubSpot evidence"
          value={hubspot}
          onChange={(e) => setHubspot(e.target.value as HubspotFilter)}
          style={{ width: "auto" }}
        >
          <option value="all">HubSpot evidence: all</option>
          <option value="observed">HubSpot observed</option>
          <option value="probable">HubSpot probable</option>
          <option value="not_observed">Not observed</option>
          <option value="scan_incomplete">Scan incomplete</option>
          <option value="unchecked">Not yet checked</option>
        </select>
        <select
          aria-label="Filter by opportunity theme"
          value={theme}
          onChange={(e) => setTheme(e.target.value as typeof theme)}
          style={{ width: "auto" }}
        >
          <option value="all">Theme: all</option>
          {themes.map((t) => (
            <option key={t} value={t}>
              {OPPORTUNITY_THEME_LABEL[t]}
            </option>
          ))}
        </select>
        <select
          aria-label="Filter by review status"
          value={review}
          onChange={(e) => setReview(e.target.value)}
          style={{ width: "auto" }}
        >
          <option value="all">Review status: all</option>
          {reviewValues.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
          <option value="none">No plan yet</option>
        </select>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title={
            rows.length === 0 ? "No companies in this run yet" : "No companies match the filters"
          }
          hint={rows.length === 0 ? "Start a run from campaign setup." : undefined}
        />
      ) : (
        <div className="table-wrap">
          <table className="board">
            <thead>
              <tr>
                <th>Company</th>
                <th>Status</th>
                <th>HubSpot evidence</th>
                <th>Strongest opportunity</th>
                <th>Review</th>
                <th>Score</th>
                <th>Scan</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => (
                <BoardRowView
                  key={row.company.id}
                  row={row}
                  onOpenCompany={onOpenCompany}
                  onOpenEvidence={onOpenEvidence}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function BoardRowView({
  row,
  onOpenCompany,
  onOpenEvidence,
}: {
  row: BoardRow;
  onOpenCompany: (companyId: string) => void;
  onOpenEvidence: (companyId: string) => void;
}) {
  const c = row.company;
  const score = c.score;
  return (
    <tr className="clickable" onClick={() => onOpenCompany(c.id)} title={`Open ${c.name} workspace`}>
      <td>
        <strong>{c.name}</strong>
        <div className="small muted">{c.domain}</div>
      </td>
      <td>
        <StatusChip status={c.status} />
      </td>
      <td>
        <HubspotChip evidence={c.hubspotEvidence} />
        {c.hubspotEvidence?.publicIntegration === "not_observed" && (
          <div className="small muted">not observed ≠ does not use</div>
        )}
      </td>
      <td>{row.strongestOpportunity ?? <span className="muted small">—</span>}</td>
      <td>
        <ReviewChip status={row.reviewStatus} />
      </td>
      <td className="score-cell">
        {score && score.total !== null ? (
          <>
            <strong>{score.total}</strong>
            <span className="muted small"> / 100</span>
            <div className="score-bar" aria-hidden>
              <span style={{ width: `${Math.min(100, Math.max(0, score.total))}%` }} />
            </div>
            <details className="small muted">
              <summary>reasons</summary>
              <ul style={{ margin: "4px 0 0", paddingLeft: 16 }}>
                {score.reasons.map((r, i) => (
                  <li key={i}>{r.reason}</li>
                ))}
              </ul>
            </details>
          </>
        ) : (
          <span className="muted small">not scored yet</span>
        )}
      </td>
      <td>
        <VintageChip vintage={row.scanVintage} />
      </td>
      <td onClick={(e) => e.stopPropagation()}>
        <Button variant="ghost" onClick={() => onOpenEvidence(c.id)}>
          Evidence
        </Button>
      </td>
    </tr>
  );
}
