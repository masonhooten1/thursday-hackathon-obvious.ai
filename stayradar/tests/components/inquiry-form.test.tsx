import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { ApiClientError } from "@/lib/api/client";
import type { InquiryRequest } from "@/lib/contracts";
import { InquiryForm } from "@/components/property/inquiry-form";
import { inquiryResponse, testId } from "./fixtures";

const PROPERTY_ID = testId();

describe("InquiryForm", () => {
  afterEach(() => {
    cleanup();
    window.sessionStorage.clear();
  });

  it("shows friendly inline errors when name and email are missing", async () => {
    render(<InquiryForm propertyId={PROPERTY_ID} onSubmit={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: /Send inquiry/i }));

    expect(screen.getByText("Please add your name.")).toBeInTheDocument();
    expect(screen.getByText("Please add your email.")).toBeInTheDocument();
  });

  it("submits a contract-valid payload and renders the success state", async () => {
    const onSubmit = vi.fn(() => Promise.resolve(inquiryResponse()));
    render(<InquiryForm propertyId={PROPERTY_ID} onSubmit={onSubmit} />);

    await userEvent.type(screen.getByLabelText("Name"), "Mason Hooten");
    await userEvent.type(screen.getByLabelText("Email"), "mason@example.com");
    await userEvent.type(screen.getByLabelText(/Message/i), "Is the hot tub open in October?");
    await userEvent.click(screen.getByRole("button", { name: /Send inquiry/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const payload = onSubmit.mock.calls[0][0] as InquiryRequest;
    expect(payload.propertyId).toBe(PROPERTY_ID);
    expect(payload.name).toBe("Mason Hooten");
    expect(payload.email).toBe("mason@example.com");
    expect(payload.message).toBe("Is the hot tub open in October?");

    const success = await screen.findByRole("status", { name: "Inquiry sent" });
    expect(success).toHaveTextContent("Inquiry received");
    expect(success).toHaveTextContent(/Reference /);
  });

  it("surfaces server-side field errors inline when the API rejects the inquiry", async () => {
    const onSubmit = vi.fn(() =>
      Promise.reject(
        new ApiClientError("bad_request", "Check the highlighted fields.", {
          details: [
            { path: "email", message: "Invalid email address" },
            { path: "guests", message: "Too small: expected number to be >0" },
          ],
          status: 400,
        }),
      ),
    );
    render(<InquiryForm propertyId={PROPERTY_ID} onSubmit={onSubmit} />);

    // Locally-valid input so the request reaches the API; the server then
    // rejects with the shared error envelope's field details.
    await userEvent.type(screen.getByLabelText("Name"), "Mason Hooten");
    await userEvent.type(screen.getByLabelText("Email"), "mason@example.com");
    await userEvent.click(screen.getByRole("button", { name: /Send inquiry/i }));

    await waitFor(() => expect(screen.getByText("Invalid email address")).toBeInTheDocument());
    expect(screen.getByText(/Too small/)).toBeInTheDocument();
    expect(screen.queryByRole("status", { name: "Inquiry sent" })).not.toBeInTheDocument();
  });

  it("prefills the remembered search window and attributes the inquiry to it", async () => {
    const searchEventId = testId();
    window.sessionStorage.setItem(
      "stayradar:last-search",
      JSON.stringify({
        searchEventId,
        propertyIds: [PROPERTY_ID],
        checkIn: "2027-06-04",
        checkOut: "2027-06-07",
        guests: 4,
      }),
    );
    const onSubmit = vi.fn(() => Promise.resolve(inquiryResponse()));
    render(<InquiryForm propertyId={PROPERTY_ID} onSubmit={onSubmit} />);

    // Prefill lands after hydration.
    await waitFor(() => expect(screen.getByLabelText(/Check-in/i)).toHaveValue("2027-06-04"));
    expect(screen.getByLabelText(/Check-out/i)).toHaveValue("2027-06-07");
    expect(screen.getByLabelText(/Guests/i)).toHaveValue(4);

    await userEvent.type(screen.getByLabelText("Name"), "Mason Hooten");
    await userEvent.type(screen.getByLabelText("Email"), "mason@example.com");
    await userEvent.click(screen.getByRole("button", { name: /Send inquiry/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const payload = onSubmit.mock.calls[0][0] as InquiryRequest;
    expect(payload.searchEventId).toBe(searchEventId);
  });

  it("shows a submit error when the API is unreachable", async () => {
    const onSubmit = vi.fn(() =>
      Promise.reject(new ApiClientError("internal_error", "Could not reach the StayRadar API (inquiry).")),
    );
    render(<InquiryForm propertyId={PROPERTY_ID} onSubmit={onSubmit} />);

    await userEvent.type(screen.getByLabelText("Name"), "Mason Hooten");
    await userEvent.type(screen.getByLabelText("Email"), "mason@example.com");
    await userEvent.click(screen.getByRole("button", { name: /Send inquiry/i }));

    await waitFor(() =>
      expect(screen.getByText(/Could not reach the StayRadar API/)).toBeInTheDocument(),
    );
  });
});
