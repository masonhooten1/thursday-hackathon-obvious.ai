import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import IdentifyPage from "@/app/page";

describe("identify screen — scaffold placeholder", () => {
  it("renders the heading and a disabled upload affordance", () => {
    render(<IdentifyPage />);

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Plant ID");
    expect(screen.getByTestId("upload-affordance")).toBeDisabled();
  });
});
