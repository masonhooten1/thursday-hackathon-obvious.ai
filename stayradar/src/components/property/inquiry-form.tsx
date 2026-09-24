"use client";

import { useEffect, useState } from "react";
import { InquiryRequestSchema, type InquiryRequest, type InquiryResponse } from "@/lib/contracts";
import { ApiClientError, createStayRadarClient } from "@/lib/api/client";
import { lastSearchWindowFor, searchEventFor } from "@/lib/session";

/**
 * Inquiry form (traveler UX task): posts to POST /api/inquiries through
 * the API client, validates against the shared InquiryRequestSchema
 * client-side for inline field errors, and pre-fills dates/guests from
 * the search that led here (session attribution). The API re-validates —
 * client validation is for fast feedback, not trust.
 */

interface InquiryFormProps {
  propertyId: string;
  /** Injectable submit for component tests; default posts to /api/inquiries. */
  onSubmit?: (input: InquiryRequest) => Promise<InquiryResponse>;
}

/** Friendly messages for emptiness cases zod words awkwardly. */
const REQUIRED_FIELD_MESSAGES: Record<string, string> = {
  name: "Please add your name.",
  email: "Please add your email.",
};

interface FormFields {
  name: string;
  email: string;
  checkIn: string;
  checkOut: string;
  guests: string;
  message: string;
}

const EMPTY_FIELDS: FormFields = {
  name: "",
  email: "",
  checkIn: "",
  checkOut: "",
  guests: "",
  message: "",
};

const labelClass = "flex flex-col gap-1 text-xs font-medium text-stone-600";
const inputClass =
  "rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 aria-[invalid=true]:border-red-500 aria-[invalid=true]:bg-red-50";

export function InquiryForm({ propertyId, onSubmit }: InquiryFormProps) {
  const [fields, setFields] = useState<FormFields>(EMPTY_FIELDS);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<InquiryResponse | null>(null);

  // Prefill the window the traveler searched with, after hydration.
  useEffect(() => {
    const remembered = lastSearchWindowFor(propertyId);
    if (remembered.checkIn || remembered.checkOut || remembered.guests !== undefined) {
      setFields((prev) => ({
        ...prev,
        checkIn: remembered.checkIn ?? prev.checkIn,
        checkOut: remembered.checkOut ?? prev.checkOut,
        guests: remembered.guests !== undefined ? String(remembered.guests) : prev.guests,
      }));
    }
  }, [propertyId]);

  const setField = (key: keyof FormFields) => (value: string) => {
    setFields((prev) => ({ ...prev, [key]: value }));
    setFieldErrors((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitError(null);

    const parse = InquiryRequestSchema.safeParse({
      propertyId,
      name: fields.name || undefined,
      email: fields.email,
      checkIn: fields.checkIn || undefined,
      checkOut: fields.checkOut || undefined,
      guests: fields.guests === "" ? undefined : Number(fields.guests),
      message: fields.message || undefined,
    });
    if (!parse.success) {
      const errors: Record<string, string> = {};
      for (const issue of parse.error.issues) {
        const key = issue.path.join(".") || "form";
        if (!(key in errors)) {
          errors[key] = REQUIRED_FIELD_MESSAGES[key] ?? issue.message;
        }
      }
      setFieldErrors(errors);
      return;
    }

    setSubmitting(true);
    try {
      const submit = onSubmit ?? ((input: InquiryRequest) => createStayRadarClient().submitInquiry(input));
      // Attribute the inquiry back to the search that surfaced this stay
      // (spec: leads link to the originating search event).
      const response = await submit({ ...parse.data, searchEventId: searchEventFor(propertyId) });
      setSuccess(response);
    } catch (error) {
      // Server-side validation (the shared error envelope's field details)
      // lands inline next to the fields; everything else is a form banner.
      if (error instanceof ApiClientError) {
        const serverErrors = error.fieldErrors();
        if (Object.keys(serverErrors).length > 0) {
          setFieldErrors(serverErrors);
        } else {
          setSubmitError(error.message);
        }
      } else {
        setSubmitError(
          error instanceof Error ? error.message : "Could not send your inquiry — please try again.",
        );
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (success) {
    return (
      <div
        role="status"
        aria-label="Inquiry sent"
        data-testid="inquiry-success"
        className="rounded-xl border border-teal-200 bg-teal-50 p-6 text-center"
      >
        <p className="text-sm font-semibold text-teal-900">Inquiry received</p>
        <p className="mt-1 text-xs text-teal-800">
          Reference {success.id.slice(0, 8)}. The property manager replies by email — usually within
          a day.
        </p>
      </div>
    );
  }

  const errorText = (key: string) =>
    fieldErrors[key] ? (
      <span id={`${key}-error`} role="alert" className="text-[11px] font-medium text-red-700">
        {fieldErrors[key]}
      </span>
    ) : null;

  const describedBy = (key: string) => (fieldErrors[key] ? `${key}-error` : undefined);

  return (
    <form
      aria-label="Inquiry form"
      data-testid="inquiry-form"
      onSubmit={(event) => void handleSubmit(event)}
      noValidate
      className="flex flex-col gap-3 rounded-xl border border-stone-200 bg-white p-4"
    >
      <h2 className="text-sm font-semibold text-stone-900">Ask about this stay</h2>
      <p className="-mt-2 text-xs text-stone-500">
        Inquiries go straight to the property manager. No booking, no payment.
      </p>

      <label className={labelClass}>
        Name
        <input
          type="text"
          name="name"
          autoComplete="name"
          className={inputClass}
          value={fields.name}
          onChange={(event) => setField("name")(event.target.value)}
          aria-invalid={fieldErrors.name ? true : undefined}
          aria-describedby={describedBy("name")}
        />
        {errorText("name")}
      </label>

      <label className={labelClass}>
        Email
        <input
          type="email"
          name="email"
          autoComplete="email"
          required
          className={inputClass}
          value={fields.email}
          onChange={(event) => setField("email")(event.target.value)}
          aria-invalid={fieldErrors.email ? true : undefined}
          aria-describedby={describedBy("email")}
        />
        {errorText("email")}
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className={labelClass}>
          Check-in
          <input
            type="date"
            name="checkIn"
            className={inputClass}
            value={fields.checkIn}
            onChange={(event) => setField("checkIn")(event.target.value)}
            aria-invalid={fieldErrors.checkIn ? true : undefined}
            aria-describedby={describedBy("checkIn")}
          />
          {errorText("checkIn")}
        </label>
        <label className={labelClass}>
          Check-out
          <input
            type="date"
            name="checkOut"
            className={inputClass}
            value={fields.checkOut}
            onChange={(event) => setField("checkOut")(event.target.value)}
            aria-invalid={fieldErrors.checkOut ? true : undefined}
            aria-describedby={describedBy("checkOut")}
          />
          {errorText("checkOut")}
        </label>
      </div>

      <label className={labelClass}>
        Guests
        <input
          type="number"
          name="guests"
          min={1}
          className={inputClass}
          value={fields.guests}
          onChange={(event) => setField("guests")(event.target.value)}
          aria-invalid={fieldErrors.guests ? true : undefined}
          aria-describedby={describedBy("guests")}
        />
        {errorText("guests")}
      </label>

      <label className={labelClass}>
        Message
        <textarea
          name="message"
          rows={3}
          className={inputClass}
          placeholder="Anything the manager should know — pets, arrival time, questions."
          value={fields.message}
          onChange={(event) => setField("message")(event.target.value)}
          aria-invalid={fieldErrors.message ? true : undefined}
          aria-describedby={describedBy("message")}
        />
        {errorText("message")}
      </label>

      {submitError ? (
        <p role="alert" className="text-xs font-medium text-red-700">
          {submitError}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={submitting}
        className="rounded-md bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {submitting ? "Sending…" : "Send inquiry"}
      </button>
    </form>
  );
}
