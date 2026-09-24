"use client";

import type { AccountPlan, Company, PublicIntegrationStatus, RunStatus } from "@/lib/contracts";
import type { DataProvenance, EvidenceVintage } from "@/lib/vintage";

/**
 * Status labeling chips (brief §Interface: the reviewer must immediately
 * distinguish fresh scans, cached evidence, incomplete scans, and synthetic
 * demonstrations). Every chip is a pure function of the value it labels.
 */

const COMPANY_STATUS_LABEL: Record<Company["status"], string> = {
  queued: "Queued",
  collecting: "Collecting",
  analyzing: "Analyzing",
  drafting: "Drafting",
  reviewing: "Reviewing",
  ready: "Ready",
  partial: "Partial",
  failed: "Failed",
  blocked: "Blocked",
  cancelled: "Cancelled",
};

const COMPANY_STATUS_TONE: Record<Company["status"], string> = {
  queued: "chip-gray",
  collecting: "chip-blue",
  analyzing: "chip-violet",
  drafting: "chip-teal",
  reviewing: "chip-amber",
  ready: "chip-green",
  partial: "chip-amber",
  failed: "chip-red",
  blocked: "chip-gray",
  cancelled: "chip-gray",
};

export function StatusChip({ status }: { status: Company["status"] }) {
  return (
    <span className={`chip ${COMPANY_STATUS_TONE[status]}`}>{COMPANY_STATUS_LABEL[status]}</span>
  );
}

export const RUN_STATUS_LABEL: Record<RunStatus, string> = {
  queued: "Queued",
  running: "Running",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
  partial: "Partial",
};

const HUBSPOT_LABEL: Record<PublicIntegrationStatus, string> = {
  observed: "HubSpot observed",
  probable: "HubSpot probable",
  not_observed: "Not observed",
  scan_incomplete: "Scan incomplete",
};

const HUBSPOT_TONE: Record<PublicIntegrationStatus, string> = {
  observed: "chip-green",
  probable: "chip-teal",
  not_observed: "chip-gray",
  scan_incomplete: "chip-amber",
};

/**
 * Public integration evidence chip. The note variants separate "uses HubSpot
 * as its internal CRM" from "public integration observed" — the chip only
 * ever describes the latter, and a negative is qualified accordingly. A null
 * evidence object means the check has not run yet, which is unlabeled data,
 * not a negative result.
 */
export function HubspotChip({
  evidence,
  withNote = false,
}: {
  evidence: Company["hubspotEvidence"];
  withNote?: boolean;
}) {
  if (!evidence) return <span className="chip chip-gray">Not yet checked</span>;
  return (
    <span className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
      <span className={`chip ${HUBSPOT_TONE[evidence.publicIntegration]}`}>
        {HUBSPOT_LABEL[evidence.publicIntegration]}
      </span>
      {withNote &&
        (evidence.publicIntegration === "not_observed" ? (
          <span className="muted small" title={evidence.note ?? undefined}>
            not observed ≠ does not use
          </span>
        ) : evidence.publicIntegration === "scan_incomplete" ? (
          <span className="muted small" title={evidence.note ?? undefined}>
            {evidence.note}
          </span>
        ) : null)}
    </span>
  );
}

const VINTAGE_LABEL: Record<EvidenceVintage, string> = {
  fresh: "Fresh scan",
  cached: "Cached",
  incomplete: "Incomplete scan",
};

const VINTAGE_TONE: Record<EvidenceVintage, string> = {
  fresh: "chip-green",
  cached: "chip-amber",
  incomplete: "chip-gray",
};

export function VintageChip({ vintage }: { vintage: EvidenceVintage | null }) {
  if (!vintage) return <span className="muted small">—</span>;
  return <span className={`chip ${VINTAGE_TONE[vintage]}`}>{VINTAGE_LABEL[vintage]}</span>;
}

export function ProvenanceChip({ provenance }: { provenance: DataProvenance }) {
  return provenance === "fixture" ? (
    <span className="chip chip-violet">Fixture data</span>
  ) : (
    <span className="chip chip-green">Live data</span>
  );
}

export const PROVENANCE_BANNER_LABEL: Record<DataProvenance, string> = {
  fixture: "Fixture data — synthetic demonstration, not a scan. Nothing here was collected from a real website.",
  live: "Live data — collected from public websites during this campaign.",
};

const REVIEW_LABEL: Record<AccountPlan["status"], string> = {
  draft: "Draft",
  review: "In review",
  ready: "Review ready",
  exported: "Exported",
};

const REVIEW_TONE: Record<AccountPlan["status"], string> = {
  draft: "chip-gray",
  review: "chip-amber",
  ready: "chip-blue",
  exported: "chip-teal",
};

export function ReviewChip({ status }: { status: AccountPlan["status"] | null }) {
  if (!status) return <span className="muted small">—</span>;
  return <span className={`chip ${REVIEW_TONE[status]}`}>{REVIEW_LABEL[status]}</span>;
}
