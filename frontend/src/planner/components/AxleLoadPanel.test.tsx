import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import AxleLoadPanel from "./AxleLoadPanel.tsx";
import { UnitsProvider } from "../lib/UnitsProvider.tsx";
import type { AxleLoad } from "../api/types.ts";

// Hand-written loads, so the tests don't depend on how the planner happens to balance a sample.
const axle = (group_id: string, name: string, load_kg: number, limit_kg: number, status: AxleLoad["status"]): AxleLoad =>
  ({ group_id, name, load_kg, limit_kg, ratio: load_kg / limit_kg, status });
const nearLoads = [
  axle("steer", "Steer", 5544, 6000, "near"),
  axle("drive", "Drive tandem", 12100, 16500, "ok"),
  axle("trailer_tri", "Trailer tri-axle", 14000, 20000, "ok"),
];
const overLoads = [
  axle("steer", "Steer", 5205, 6000, "ok"),
  axle("drive", "Drive tandem", 10323, 16500, "ok"),
  axle("trailer_tri", "Trailer tri-axle", 22172, 20000, "over"),
];

describe("AxleLoadPanel", () => {
  it("names the mass scheme and says it's an estimate", () => {
    render(<AxleLoadPanel axleLoads={nearLoads} massScheme="GML" />);
    expect(screen.getByRole("heading", { name: "Estimated axle loads (General Mass Limits)" })).toBeInTheDocument();
    expect(screen.getByText(/static estimate, not a weighbridge reading/i)).toBeInTheDocument();
  });

  it("says Higher Mass Limits under HML", () => {
    render(<AxleLoadPanel axleLoads={nearLoads} massScheme="HML" />);
    expect(screen.getByRole("heading", { name: "Estimated axle loads (Higher Mass Limits)" })).toBeInTheDocument();
  });

  it("shows one row per group with near and within-limit labels", () => {
    render(<AxleLoadPanel axleLoads={nearLoads} massScheme="GML" />);
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent("Steer");
    expect(rows[0]).toHaveTextContent("Near limit");
    expect(rows[0]).toHaveClass("axle-row--near");
    expect(rows[0]).toHaveTextContent("5,544 kg / 6,000 kg");
    expect(rows[0]).toHaveTextContent("92 %");
    expect(rows[1]).toHaveTextContent("Within limit");
    expect(rows[2]).toHaveTextContent("Within limit");
  });

  it("shows how far over an overloaded group is, with error styling", () => {
    render(<AxleLoadPanel axleLoads={overLoads} massScheme="GML" />);
    const meter = screen.getByRole("meter", { name: "Trailer tri-axle" });
    const row = meter.closest("li")!;
    expect(row).toHaveClass("axle-row--over");
    expect(within(row).getByText("Over by 2,172 kg")).toBeInTheDocument();
    expect(row).toHaveTextContent("22,172 kg / 20,000 kg");
    expect(row).toHaveTextContent("111 %");
    expect(row.querySelector(".axle-overflow")).not.toBeNull();
  });

  it("formats the overload in tonnes when the display units are m · t", () => {
    render(
      <UnitsProvider initial="m-t">
        <AxleLoadPanel axleLoads={overLoads} massScheme="GML" />
      </UnitsProvider>,
    );
    expect(screen.getByText("Over by 2.2 t")).toBeInTheDocument();
  });

  it("exposes each bar as a meter scaled to 120 % of the limit", () => {
    render(<AxleLoadPanel axleLoads={overLoads} massScheme="GML" />);
    const meter = screen.getByRole("meter", { name: "Trailer tri-axle" });
    expect(meter).toHaveAttribute("aria-valuemin", "0");
    expect(meter).toHaveAttribute("aria-valuemax", "24000");
    expect(meter).toHaveAttribute("aria-valuenow", "22172");
    expect(meter).toHaveAttribute("aria-valuetext", "22,172 kg of 20,000 kg limit, 111 %, over by 2,172 kg");
    expect(screen.getByRole("meter", { name: "Steer" }))
      .toHaveAttribute("aria-valuetext", "5,205 kg of 6,000 kg limit, 86 %, within limit");
  });
});
