import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";
import { AvailabilityCalendar } from "@/components/property/availability-calendar";
import { calendarDay, calendarFixture } from "./fixtures";

describe("AvailabilityCalendar", () => {
  afterEach(() => cleanup());

  it("renders month grids from the API calendar with status on each day cell", () => {
    render(<AvailabilityCalendar calendar={calendarFixture()} />);

    // Month blocks from the fixture's two months, labels from buildCalendarMonths.
    expect(screen.getByText("March 2027")).toBeInTheDocument();
    expect(screen.getByText("April 2027")).toBeInTheDocument();

    // Status drives data attributes a reviewer can see in the DOM.
    const booked = screen.getByLabelText("Mar 3: booked");
    expect(booked).toHaveAttribute("data-status", "booked");
    const blocked = screen.getByLabelText("Mar 4: blocked");
    expect(blocked).toHaveAttribute("data-status", "blocked");
    const open = screen.getByLabelText("Mar 1: available");
    expect(open).toHaveAttribute("data-status", "available");
    expect(open).toHaveTextContent("$150");
  });

  it("summarizes open nights and shows the window echo when dates are given", () => {
    const calendar = calendarFixture();
    render(
      <AvailabilityCalendar
        calendar={{ ...calendar, checkIn: "2027-03-01", checkOut: "2027-03-08" }}
      />,
    );

    expect(screen.getByText("7-day outlook — 4 of 7 nights open")).toBeInTheDocument();
    expect(screen.getByText(/Showing availability for your dates/)).toBeInTheDocument();
  });

  it("renders without a crash when the API returns an empty day list", () => {
    const calendar = calendarFixture();
    render(<AvailabilityCalendar calendar={{ ...calendar, days: [] }} />);

    expect(screen.getByText(/0 of 0 nights open/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/: (available|booked|blocked)/)).not.toBeInTheDocument();
  });

  it("omits the price line for available nights without a rate", () => {
    const calendar = calendarFixture();
    render(
      <AvailabilityCalendar
        calendar={{
          ...calendar,
          days: [calendarDay("2027-03-01", "available", null)],
        }}
      />,
    );

    const day = screen.getByLabelText("Mar 1: available");
    expect(day).toHaveTextContent("—");
  });
});
