import { z } from "zod";
import { isoDateSchema } from "./shared";

/**
 * Wire contracts for inquiry capture (spec art_XasJ5Kw8, "API routes":
 * POST /api/inquiries — validated → lead row, linked to the originating
 * search event when the client supplies one).
 */

export const InquiryRequestSchema = z
  .object({
    propertyId: z.uuid(),
    /** Attribution back to the search that produced the inquiry (spec: lead linkage). */
    searchEventId: z.uuid().optional(),
    checkIn: isoDateSchema.optional(),
    checkOut: isoDateSchema.optional(),
    guests: z.number().int().positive().max(50).optional(),
    name: z.string().min(1).max(200),
    email: z.email(),
    message: z.string().max(2000).optional(),
  })
  .strict()
  .refine((inquiry) => !inquiry.checkIn || !inquiry.checkOut || inquiry.checkOut > inquiry.checkIn, {
    message: "checkOut must be after checkIn",
    path: ["checkOut"],
  });
export type InquiryRequest = z.infer<typeof InquiryRequestSchema>;

export const InquiryResponseSchema = z.object({
  id: z.uuid(),
  propertyId: z.uuid(),
  searchEventId: z.uuid().nullable(),
  status: z.literal("received"),
  createdAt: z.iso.datetime(),
});
export type InquiryResponse = z.infer<typeof InquiryResponseSchema>;
