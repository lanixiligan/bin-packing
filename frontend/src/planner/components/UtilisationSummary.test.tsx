import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import UtilisationSummary from "./UtilisationSummary.tsx";
import { UnitsProvider } from "../lib/UnitsProvider.tsx";
import type { Utilisation } from "../api/types.ts";
import { planBdoubleContainers, planMultidrop, planSuggest } from "../test/fixtures.ts";

describe("UtilisationSummary", () => {
  it("shows exact numbers, percentages and spoken values for each row", () => {
    render(<UtilisationSummary utilisation={planMultidrop.result.utilisation} />);
    const spaces = screen.getByRole("meter", { name: "Pallet spaces" });
    expect(spaces).toHaveAttribute("aria-valuetext", "16.8 of 22 pallet spaces, 76 %");
    expect(spaces).toHaveAttribute("aria-valuenow", "16.8");
    expect(spaces).toHaveAttribute("aria-valuemin", "0");
    expect(spaces).toHaveAttribute("aria-valuemax", "22");
    expect(screen.getByText("16.8 / 22")).toBeInTheDocument();
    expect(screen.getByText("76 %")).toBeInTheDocument();

    expect(screen.getByRole("meter", { name: "Payload" }))
      .toHaveAttribute("aria-valuetext", "14,530 kg of 24,000 kg payload, 61 %");
    expect(screen.getByText("14,530 kg / 24,000 kg")).toBeInTheDocument();
    expect(screen.getByRole("meter", { name: "Volume" }))
      .toHaveAttribute("aria-valuetext", "29.9 m³ of 93.1 m³ volume, 32 %");
    expect(screen.getByText("29.9 m³ / 93.1 m³")).toBeInTheDocument();
    expect(screen.getByText("0 / 2.25")).toBeInTheDocument();
    expect(screen.queryByText(/over/i)).not.toBeInTheDocument();
  });

  it("uses the display units for payload", () => {
    render(<UnitsProvider initial="m-t"><UtilisationSummary utilisation={planMultidrop.result.utilisation} /></UnitsProvider>);
    expect(screen.getByText("14.5 t / 24.0 t")).toBeInTheDocument();
  });

  it("shows TEU with up to 2 decimals on a container vehicle", () => {
    render(<UtilisationSummary utilisation={planBdoubleContainers.result.utilisation} />);
    expect(screen.getByRole("meter", { name: "Containers (TEU)" })).toHaveAttribute("aria-valuetext", "3 of 3 TEU, 100 %");
  });

  it("marks a row over 100 % with an Over label and the error state", () => {
    const utilisation: Utilisation = {
      ...planMultidrop.result.utilisation,
      pallet_spaces: { used: 24, available: 22, pct: 109.1 },
    };
    render(<UtilisationSummary utilisation={utilisation} />);
    const meter = screen.getByRole("meter", { name: "Pallet spaces" });
    expect(meter).toHaveAttribute("aria-valuetext", "24 of 22 pallet spaces, 109 %, over capacity");
    expect(meter).toHaveAttribute("aria-valuenow", "22");
    expect(meter.closest("li")).toHaveClass("util-row--over");
    expect(screen.getByText("Over")).toBeInTheDocument();
    expect(screen.getByText("24 / 22")).toBeInTheDocument();
  });

  it("says 'Not a container vehicle' instead of a TEU bar when none are available", () => {
    render(<UtilisationSummary utilisation={planSuggest.result.utilisation} />);
    expect(screen.getByText("Not a container vehicle")).toBeInTheDocument();
    expect(screen.queryByRole("meter", { name: /TEU/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole("meter")).toHaveLength(3);
  });
});
