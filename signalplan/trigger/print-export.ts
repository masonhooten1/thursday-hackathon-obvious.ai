import "server-only";
import { task } from "@trigger.dev/sdk/v3";
import { printHtmlToPdf } from "@/workers/reports/print";
import type { PdfBytes } from "@/workers/reports/print";
import { PostgresWorkerRepository } from "@/lib/repositories/worker";
import type { WorkerRepository } from "@/lib/repositories/worker";
import { putPdf } from "@/lib/data/storage";

/**
 * print-export — renders the fixed two-page plan template to PDF inside the
 * worker (brief §Stack), persists the bytes in private storage, and flips the
 * Export row to `ready` with its storage key. Every state lands in the
 * database (check 11): the operator can leave, reconnect, and find the export
 * ready, failed, or still pending — never silently lost. A failed export is
 * rethrown so the retry policy applies; `getOrCreateExport` guarantees a
 * retry replaces, not duplicates (check 5).
 */
export const printExportTask = task({
  id: "print-export",
  queue: { name: "exports", concurrencyLimit: 2 },
  run: async ({ payload }: { payload: { exportId: string; workspaceId: string; html: string } }) =>
    printExportCore(
      payload,
      printHtmlToPdf,
      new PostgresWorkerRepository(),
      (exportId, bytes) => putPdf(payload.workspaceId, exportId, bytes),
    ),
});

/** Testable core: the print function, repository, and storage are injected. */
export async function printExportCore(
  payload: { exportId: string; workspaceId: string; html: string },
  print: (html: string) => Promise<PdfBytes>,
  repo: WorkerRepository,
  store: (exportId: string, pdf: PdfBytes) => Promise<string | null>,
): Promise<{ exportId: string; byteLength: number; storageKey: string | null }> {
  try {
    const pdf = await print(payload.html);
    const storageKey = await store(payload.exportId, pdf);
    if (!storageKey) {
      // A "ready" export nobody can download would be a lie — say why.
      throw new Error(
        "Private storage is not configured; the PDF was rendered but cannot be stored or downloaded.",
      );
    }
    await repo.setExportStatus(payload.workspaceId, payload.exportId, {
      status: "ready",
      storageKey,
    });
    return { exportId: payload.exportId, byteLength: pdf.byteLength, storageKey };
  } catch (err) {
    await repo.setExportStatus(payload.workspaceId, payload.exportId, {
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
