import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { FleetResult, PlanRequest } from "../api/types.ts";
import fleetReal from "../../__fixtures__/fleet-real.json";
import { UnitsContext, unitsFor, type UnitSystem } from "../lib/units.ts";
import { fleetSample, reference } from "../test/fixtures.ts";
import FleetSummary from "./FleetSummary.tsx";

const { request, result: fleet } = fleetSample;
const show = (f: FleetResult = fleet, props: { dgSeparated?: boolean; onBack?: () => void } = {}) =>
  render(<FleetSummary fleet={f} request={request} onBack={props.onBack ?? (() => {})} dgSeparated={props.dgSeparated} />);

describe("FleetSummary", () => {
  it("announces the truck count as proven fewest, with the bounds behind it", () => {
    show();
    const status = screen.getByRole("status");
    expect(within(status).getByRole("heading", { name: "2 trucks · Proven fewest" })).toBeInTheDocument();
    expect(screen.getByText("Each truck is a Medium rigid (8 t). No split can use fewer.")).toBeInTheDocument();
    const bounds = within(screen.getByRole("list", { name: "Fewest trucks possible by" })).getAllByRole("listitem");
    expect(bounds.map((b) => b.textContent)).toEqual(["Weight1", "Floor space2", "Volume1"]);
    // The bound that sets the minimum stands out.
    expect(bounds.map((b) => b.classList.contains("fleet-bound--binding"))).toEqual([false, true, false]);
    expect(screen.getByTestId("fleet-summary")).toHaveClass("fleet-summary--proven");
  });

  it("says best found with the lower bound when it isn't proven", () => {
    show({ ...fleet, num_trucks: 3, optimal: false, status: "FEASIBLE" });
    expect(screen.getByRole("heading", { name: "3 trucks · Best found · at least 2" })).toBeInTheDocument();
    expect(screen.getByText(/ran out of time before proving this is the fewest: a split needs at least 2/)).toBeInTheDocument();
    expect(screen.getByTestId("fleet-summary")).toHaveClass("fleet-summary--best");
  });

  it("explains a big load split truck by truck", () => {
    show({ ...fleet, num_trucks: 3, optimal: false, method: "heuristic", status: "HEURISTIC" });
    expect(screen.getByText(/big load, so it was split truck by truck and isn't proven the fewest/)).toBeInTheDocument();
  });

  it("notes dangerous goods on separate trucks only when they forced the split", () => {
    show(fleet, { dgSeparated: true });
    expect(screen.getByRole("note")).toHaveTextContent("Dangerous goods that can’t travel together are on separate trucks.");
  });

  it("has no DG note otherwise", () => {
    show();
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });

  it("lists units no truck can take, by freight line, with the reasons", () => {
    show({
      ...fleet, fits: false, unplaced: ["cem#1", "cem#2", "paint#4"],
      reasons: ["Cement is too heavy for a Medium rigid (8 t).", "Paint is too tall for the body."],
    });
    const group = screen.getByRole("group", { name: "3 units can’t go on any truck" });
    const [lines, reasons] = within(group).getAllByRole("list");
    expect(within(lines).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      // Line names and counts only: unit ids are internal ("line-…#1") and mean nothing to the user.
      "Cement × 2", "Paint × 1",
    ]);
    expect(within(reasons).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "Cement is too heavy for a Medium rigid (8 t).", "Paint is too tall for the body.",
    ]);
    expect(screen.getByTestId("fleet-summary")).toHaveClass("fleet-summary--problem");
  });

  it("says so when no truck can take anything", () => {
    show({ ...fleet, fits: false, num_trucks: 0, trucks: [], unplaced: ["cem#1"], reasons: ["Too heavy."] });
    expect(screen.getByRole("heading", { name: "No truck can take this freight" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "1 unit can’t go on any truck" })).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Fewest trucks possible by" })).not.toBeInTheDocument();
  });

  it("goes back to one truck", async () => {
    const onBack = vi.fn();
    show(fleet, { onBack });
    await userEvent.click(screen.getByRole("button", { name: "Back to one truck" }));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("writes each bound as ⌈total ÷ what one truck holds⌉, in the display units", () => {
    // The real solver's answer (fleet-sample.json is hand-made, so its bounds aren't computed).
    const real = fleetReal as unknown as { request: PlanRequest; result: FleetResult };
    const view = (system: UnitSystem) => (
      <UnitsContext.Provider value={unitsFor(system, () => {})}>
        <FleetSummary fleet={real.result} request={real.request} reference={reference} onBack={() => {}} />
      </UnitsContext.Provider>
    );
    const bounds = () => within(screen.getByRole("list", { name: "Fewest trucks possible by" }))
      .getAllByRole("listitem").map((b) => b.textContent);
    const { rerender } = render(view("mm-kg"));
    expect(bounds()).toEqual([
      "Weight⌈12,150 ÷ 8,000 kg⌉ =2", "Floor space⌈16.3 ÷ 10.9 m²⌉ =2", "Volume⌈23.6 ÷ 20.7 m³⌉ =2",
    ]);
    rerender(view("m-t"));
    expect(bounds()[0]).toBe("Weight⌈12.2 ÷ 8 t⌉ =2");
  });

  it("shows the time used against the solver's limit while a new split is on its way", () => {
    const { rerender } = render(<FleetSummary fleet={fleet} request={request} onBack={() => {}} solving />);
    expect(screen.getByRole("progressbar", { name: "Time used of the solver limit" })).toHaveAttribute("max", "10");
    expect(screen.getByText("0.0 s of up to 10 s")).toBeInTheDocument();
    rerender(<FleetSummary fleet={fleet} request={request} onBack={() => {}} />);
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });
});
