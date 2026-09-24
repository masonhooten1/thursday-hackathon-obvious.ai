import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import IdentifyPage from "@/app/page";

describe("identify page shell", () => {
  it("renders the heading, tagline, and an enabled upload affordance", () => {
    render(<IdentifyPage />);

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Plant ID");
    expect(screen.getByText("Point a camera at a plant, get its name.")).toBeInTheDocument();
    expect(screen.getByTestId("upload-affordance")).toBeEnabled();
    expect(screen.getByLabelText("Choose a plant photo")).toHaveAttribute("accept", "image/*");
  });
});
