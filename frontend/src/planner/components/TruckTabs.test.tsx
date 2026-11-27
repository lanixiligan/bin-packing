import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import type { PlanResult } from "../api/types.ts";
import type { TruckChoice } from "../lib/fleet.ts";
import { fleetSample, planAxleOverload, planBdoubleContainers } from "../test/fixtures.ts";
import TruckTabs from "./TruckTabs.tsx";

const [one, two] = fleetSample.result.trucks;
/** Four trucks: two that fit, one near an axle limit, one over. */
const trucks: PlanResult[] = [one, two, planBdoubleContainers.result, planAxleOverload.result];

function Harness({ list = trucks, start = 0 }: { list?: PlanResult[]; start?: TruckChoice }) {
  const [selected, setSelected] = useState<TruckChoice>(start);
  return (
    <>
      <TruckTabs trucks={list} selected={selected} onSelect={setSelected} idBase="t" />
      <p data-testid="selected">{selected}</p>
    </>
  );
}

const allTabs = () => screen.getAllByRole("tab");
/** The trucks' tabs, after "All trucks". */
const tabs = () => allTabs().slice(1);
const selected = () => {
  const text = screen.getByTestId("selected").textContent!;
  return text === "all" ? text : Number(text);
};

describe("TruckTabs", () => {
  it("is a tablist with one tab per truck: its number, payload and status in words", () => {
    render(<Harness />);
    expect(screen.getByRole("tablist", { name: "Trucks" })).toBeInTheDocument();
    expect(allTabs()[0]).toHaveTextContent(/^All trucks$/);
    expect(tabs().map((t) => t.textContent)).toEqual([
      "Truck 168 % of payload, fits",
      "Truck 245 % of payload, fits",
      expect.stringMatching(/^Truck 3\d+ % of payload, near a limit$/),
      expect.stringMatching(/^Truck 4\d+ % of payload, over a limit$/),
    ]);
    expect(screen.getByRole("tab", { name: "Truck 2 45 % of payload, fits" })).toBeInTheDocument();
    // The status is an icon plus words (and a class for the colour), never colour alone.
    for (const tab of tabs()) expect(tab.querySelector("svg")).not.toBeNull();
    expect(tabs()[2]).toHaveClass("truck-tab--near");
    expect(tabs()[3]).toHaveClass("truck-tab--over");
  });

  it("marks the selected tab and ties each tab to its panel", () => {
    render(<Harness start={1} />);
    expect(allTabs().map((t) => t.getAttribute("aria-selected"))).toEqual(["false", "false", "true", "false", "false"]);
    expect(allTabs().map((t) => t.tabIndex)).toEqual([-1, -1, 0, -1, -1]); // one tab stop
    expect(tabs()[1]).toHaveAttribute("id", "t-tab-1");
    expect(tabs()[1]).toHaveAttribute("aria-controls", "t-panel-1");
    expect(allTabs()[0]).toHaveAttribute("aria-controls", "t-panel-all");
  });

  it("selects all the trucks with the first tab", async () => {
    render(<Harness start="all" />);
    expect(allTabs()[0]).toHaveAttribute("aria-selected", "true");
    await userEvent.click(tabs()[1]);
    expect(selected()).toBe(1);
    await userEvent.click(allTabs()[0]);
    expect(selected()).toBe("all");
  });

  it("selects a truck on click", async () => {
    render(<Harness />);
    await userEvent.click(tabs()[2]);
    expect(selected()).toBe(2);
    expect(tabs()[2]).toHaveAttribute("aria-selected", "true");
  });

  it("moves with the arrow keys (wrapping), Home and End, and focus follows", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.tab();
    expect(tabs()[0]).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(selected()).toBe(1);
    expect(tabs()[1]).toHaveFocus();
    expect(allTabs().map((t) => t.tabIndex)).toEqual([-1, -1, 0, -1, -1]);
    await user.keyboard("{End}");
    expect(selected()).toBe(3);
    expect(tabs()[3]).toHaveFocus();
    // Past the last truck it wraps to "All trucks", then the first truck.
    await user.keyboard("{ArrowRight}");
    expect(selected()).toBe("all");
    expect(allTabs()[0]).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(selected()).toBe(0);
    await user.keyboard("{ArrowLeft}{ArrowLeft}");
    expect(selected()).toBe(3);
    await user.keyboard("{ArrowLeft}{ArrowLeft}");
    expect(selected()).toBe(1);
    await user.keyboard("{Home}");
    expect(selected()).toBe("all");
    expect(allTabs()[0]).toHaveFocus();
    // Other keys are left alone, and Tab leaves the strip.
    await user.keyboard("{ArrowDown}a");
    expect(selected()).toBe("all");
    await user.tab();
    expect(tabs().some((t) => t === document.activeElement)).toBe(false);
  });

  it("is left out of print (every truck prints under its own heading instead)", () => {
    const { container } = render(<Harness />);
    expect(container.querySelector(".truck-tabs")).toHaveClass("no-print");
  });
});
