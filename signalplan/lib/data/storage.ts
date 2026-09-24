import "server-only";

/**
 * Private storage for report PDFs and page-capture snapshots, via the
 * Supabase Storage REST API (spec §Vercel + Supabase: private bucket).
 *
 * Credential-free fallback (repo pattern): without SUPABASE_URL (or the
 * browser-public NEXT_PUBLIC_SUPABASE_URL) + SUPABASE_SERVICE_ROLE_KEY both
 * functions return null and never throw — call sites degrade to the honest
 * labeled states ("Private storage is not configured" in print-export,
 * "snapshot storage unavailable" in the collector). Throwing is reserved for
 * real upload failures, which surface as a `failed` export / capture
 * limitation instead of a silently lost artifact.
 *
 * Uploads use POST with the `x-upsert` header so a retried export (same
 * exportId — getOrCreateExport guarantees replace-not-duplicate) overwrites
 * its object instead of colliding.
 */

/** Supabase Storage REST object endpoint for a bucket-relative key. */
function objectUrl(cfg: StorageConfig, key: string): string {
  return `${cfg.baseUrl}/storage/v1/object/${cfg.bucket}/${key}`;
}

interface StorageConfig {
  baseUrl: string;
  serviceKey: string;
  bucket: string;
}

export const DEFAULT_STORAGE_BUCKET = "exports";

function storageConfig(): StorageConfig | null {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  const bucket = process.env.SUPABASE_STORAGE_BUCKET?.trim() || DEFAULT_STORAGE_BUCKET;
  return { baseUrl: url.replace(/\/+$/, ""), serviceKey, bucket };
}

async function uploadObject(
  cfg: StorageConfig,
  key: string,
  body: string | Uint8Array,
  contentType: string,
): Promise<void> {
  const res = await fetch(objectUrl(cfg, key), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.serviceKey}`,
      "Content-Type": contentType,
      "x-upsert": "true",
    },
    // Copy into a fresh view: a Buffer's backing pool is not a valid fetch
    // body view, and this yields a clean Uint8Array<ArrayBuffer> for BodyInit.
    body: typeof body === "string" ? body : new Uint8Array(body),
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 200);
    throw new Error(`Supabase Storage upload failed (${res.status}): ${detail}`);
  }
}

/**
 * Store a rendered PDF for an export row and return its storage key.
 * Returns null when storage is unconfigured (never throws for that).
 */
export async function putPdf(
  workspaceId: string,
  exportId: string,
  pdf: Uint8Array,
): Promise<string | null> {
  const cfg = storageConfig();
  if (!cfg) return null;
  const key = `workspaces/${encodeURIComponent(workspaceId)}/exports/${encodeURIComponent(exportId)}.pdf`;
  await uploadObject(cfg, key, pdf, "application/pdf");
  return key;
}

/**
 * Store a page-capture snapshot's extracted text and return its storage key.
 * Returns null when storage is unconfigured (never throws for that).
 */
export async function putSnapshot(
  workspaceId: string,
  companyId: string,
  captureId: string,
  content: string,
): Promise<string | null> {
  const cfg = storageConfig();
  if (!cfg) return null;
  const key = `workspaces/${encodeURIComponent(workspaceId)}/companies/${encodeURIComponent(companyId)}/captures/${encodeURIComponent(captureId)}.txt`;
  await uploadObject(cfg, key, content, "text/plain; charset=utf-8");
  return key;
}
