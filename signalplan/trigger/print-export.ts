import "server-only";
import { task } from "@trigger.dev/sdk/v3";
import { printHtmlToPdf } from "@/workers/reports/print";
import type { PdfBytes } from "@/workers/reports/print";

/**
 * print-export — renders the fixed two-page plan template to PDF inside the
 * worker (brief §Stack). The API route pre-renders template HTML from the
 * stored plan and passes it in the payload; persisting the bytes to private
 * storage and updating the Export row is the export-integration step, which
 * lands with the storage adapter — this task owns the print itself and never
 * invents a persistence path it has not been given.
 */
export const printExportTask = task({
  id: "print-export",
  queue: { name: "exports", concurrencyLimit: 2 },
  run: async ({ payload }: { payload: { exportId: string; html: string } }) =>
    printExportCore(payload, printHtmlToPdf),
});

/** Testable core: the print function is injected. */
export async function printExportCore(
  payload: { exportId: string; html: string },
  print: (html: string) => Promise<PdfBytes>,
): Promise<{ exportId: string; byteLength: number }> {
  const pdf = await print(payload.html);
  return { exportId: payload.exportId, byteLength: pdf.byteLength };
}
