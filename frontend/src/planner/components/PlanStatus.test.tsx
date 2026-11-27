import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import PlanStatus from "./PlanStatus.tsx";
import { planAxleOverload, planBdoubleContainers, planMultidrop, planOverCapacity, planSuggest, reference } from "../test/fixtures.ts";

describe("PlanStatus", () => {
  it("shows a fits headline with the vehicle and the key facts", () => {
    render(<PlanStatus result={planMultidrop.result} reference={reference} />);
    const status = screen.getByRole("status");
    expect(within(status).getByRole("heading", { name: "Fits on the Semi-trailer (13.7 m class)" })).toBeInTheDocument();
    expect(screen.getByText("14,530 kg")).toBeInTheDocument();
    expect(screen.getByText("16.8 of 22")).toBeInTheDocument();
    expect(screen.getByText("3,100 mm")).toBeInTheDocument();
    expect(screen.getByText(/of 4,300 mm limit/)).toBeInTheDocument();
    expect(screen.getByTitle("General Mass Limits")).toHaveTextContent("GML");
    expect(screen.getByText("Tautliner (curtainsider)")).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("shows a doesn't-fit headline that counts and lists the reasons", () => {
    render(<PlanStatus result={planOverCapacity.result} reference={reference} />);
    expect(screen.getByRole("heading", { name: "Doesn't fit: 1 problem" })).toBeInTheDocument();
    const reasons = screen.getByRole("list");
    expect(within(reasons).getAllByRole("listitem")).toHaveLength(1);
    expect(reasons).toHaveTextContent(/Over by 1 pallet/);
  });

  it("pluralises the problem count", () => {
    const result = { ...planAxleOverload.result, reasons: [...planAxleOverload.result.reasons, "Too tall."] };
    render(<PlanStatus result={result} reference={reference} />);
    expect(screen.getByRole("heading", { name: "Doesn't fit: 2 problems" })).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("flags a load taller than the vehicle's height limit", () => {
    render(<PlanStatus result={{ ...planMultidrop.result, max_load_height_mm: 4500 }} reference={reference} />);
    expect(screen.getByText(/over the 4,300 mm limit/)).toBeInTheDocument();
  });

  it("shows TEU instead of pallet spaces for a container load", () => {
    render(<PlanStatus result={planBdoubleContainers.result} reference={reference} />);
    expect(screen.getByText("3 of 3 TEU")).toBeInTheDocument();
  });

  it("names the suggested vehicle and lists the vehicles tried in a disclosure", async () => {
    render(<PlanStatus result={planSuggest.result} reference={reference} />);
    expect(screen.getByText(/Suggested:/)).toHaveTextContent("Suggested: Medium rigid (8 t), the smallest that fits.");
    const toggle = screen.getByRole("button", { name: "Vehicles tried (2)" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    const panel = document.getElementById(toggle.getAttribute("aria-controls")!);
    expect(panel).not.toBeVisible();

    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(panel).toBeVisible();
    const tried = screen.getByRole("list");
    const items = within(tried).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("Doesn't fit");
    expect(items[0]).toHaveTextContent("Small rigid (4-6 t)");
    expect(items[0]).toHaveTextContent(/didn't fit on the Small rigid/);
    expect(items[1]).toHaveTextContent("Fits");
    expect(items[1]).toHaveTextContent("Medium rigid (8 t)");
  });

  it("doesn't show the suggest line outside suggest mode", () => {
    render(<PlanStatus result={planMultidrop.result} reference={reference} />);
    expect(screen.queryByText(/Suggested:/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
