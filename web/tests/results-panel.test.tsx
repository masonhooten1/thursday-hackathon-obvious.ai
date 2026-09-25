import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import ResultsPanel, { closenessPercent } from "@/components/ResultsPanel";
import type { IdentifyResponse } from "@/lib/api/types";

const THUMB = "/api/static/thumbs/1355868/train/leaf.jpg";

function response(): IdentifyResponse {
  return {
    model_version: "bioclip2-vit-l14",
    latency_ms: 42,
    low_confidence: false,
    matches: [
      {
        species_id: "1355868",
        scientific_name: "Lactuca virosa",
        common_name: "bitter lettuce",
        distance: 0.09,
        confidence: "high",
        reference_image: THUMB,
      },
      {
        species_id: "1355932",
        scientific_name: "Lactuca serriola",
        common_name: "prickly lettuce",
        distance: 0.21,
        confidence: "medium",
        reference_image: THUMB,
      },
    ],
  };
}

describe("closenessPercent", () => {
  it("maps cosine distance to a clamped 0-100 percent", () => {
    expect(closenessPercent(0)).toBe(100);
    expect(closenessPercent(0.25)).toBe(75);
    expect(closenessPercent(1)).toBe(0);
    expect(closenessPercent(1.5)).toBe(0);
    expect(closenessPercent(-0.5)).toBe(100);
  });
});

describe("ResultsPanel reference images", () => {
  it("renders thumbnails for every match, nearest first", () => {
    render(
      <ResultsPanel
        response={response()}
        lowConfidence={false}
        onTryAgain={() => {}}
        onIdentifyAnother={() => {}}
      />,
    );
    const names = screen.getAllByText(/Lactuca/);
    expect(names[0]).toHaveTextContent("Lactuca virosa");
    expect(names[1]).toHaveTextContent("Lactuca serriola");
    // alt="" thumbnails are decorative and absent from the a11y tree.
    expect(document.querySelectorAll("img.thumbnail")).toHaveLength(2);
  });

  it("degrades a broken thumbnail to a decorative placeholder tile", () => {
    render(
      <ResultsPanel
        response={response()}
        lowConfidence={false}
        onTryAgain={() => {}}
        onIdentifyAnother={() => {}}
      />,
    );
    const [thumbnail] = document.querySelectorAll("img.thumbnail");
    fireEvent.error(thumbnail);
    const placeholders = document.querySelectorAll("span.thumbnail-placeholder");
    expect(placeholders).toHaveLength(1);
    expect(placeholders[0]).toHaveAttribute("aria-hidden", "true");
    // The other match's thumbnail is untouched.
    expect(document.querySelectorAll("img.thumbnail")).toHaveLength(1);
  });

  it("degrades the expanded reference photo with a spoken unavailability label", () => {
    render(<ResultsPanel response={response()} lowConfidence={false} onTryAgain={() => {}} onIdentifyAnother={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Reference photo for Lactuca virosa" }));
    const large = screen.getByRole("img", { name: "Reference photo of Lactuca virosa" });
    fireEvent.error(large);
    expect(
      screen.getByRole("img", { name: "Reference photo unavailable for Lactuca virosa" })
    ).toHaveClass("thumbnail-placeholder");
  });
});
