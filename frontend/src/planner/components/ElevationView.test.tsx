import { act, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { PlanRequest, PlanResult } from "../api/types.ts";
import { UnitsProvider } from "../lib/UnitsProvider.tsx";
import { planBdoubleContainers, planDgConflict, planMultidrop, reference } from "../test/fixtures.ts";
import LoadPlanView from "./LoadPlanView.tsx";

/** planMultidrop with one Hardware pallet 3.5 m tall: its top is 1,300 + 3,500 = 4,800 mm. */
function tallPlan(): PlanResult {
  const result = structuredClone(planMultidrop.result);
  const tall = result.placements.find((p) => p.unit_id === "hw#5")!;
  tall.height_mm = 3500;
  result.max_load_height_mm = 4800;
  return result;
}

const elevation = () => screen.getByRole("img", { name: /side view/i });

/** LoadPlanView switched to one of its 2D views. */
function renderView(result: PlanResult, request: PlanRequest, view = "Driver side", initial?: "mm-kg" | "m-t") {
  const plan = <LoadPlanView result={result} reference={reference} request={request} />;
  const out = render(initial ? <UnitsProvider initial={initial}>{plan}</UnitsProvider> : plan);
  act(() => screen.getByRole("radio", { name: view }).click());
  return out;
}

describe("ElevationView", () => {
  it("shows the height limit and the tallest point", () => {
    const { container } = renderView(planMultidrop.result, planMultidrop.request);
    const svg = container.querySelector<HTMLElement>(".elevation-view")!;
    expect(within(svg).getByText("4,300 mm height limit")).toBeInTheDocument();
    expect(within(svg).getByText("Tallest 3,100 mm")).toBeInTheDocument();
    expect(elevation()).toHaveAccessibleName(/tallest point 3,100 mm, height limit 4,300 mm, all within it/);
    expect(container.querySelectorAll(".elev-stack[data-over-limit]")).toHaveLength(0);
  });

  it("formats the limit in the chosen units", () => {
    const { container } = renderView(planMultidrop.result, planMultidrop.request, "Driver side", "m-t");
    expect(within(container.querySelector<HTMLElement>(".elevation-view")!).getByText("4.30 m height limit")).toBeInTheDocument();
  });

  it("draws every unit, stacked units at their z", () => {
    const { container } = renderView(planMultidrop.result, planMultidrop.request);
    expect(container.querySelectorAll(".elev-unit")).toHaveLength(planMultidrop.result.placements.length);
    // Pick a stack with two levels: the upper box sits the lower unit's height higher.
    const upper = planMultidrop.result.placements.find((p) => p.stack_level === 1)!;
    const lower = planMultidrop.result.placements.find((p) => p.stack_id === upper.stack_id && p.stack_level === 0)!;
    const boxes = container.querySelectorAll(`.elev-stack[data-stack="${upper.deck_id}:${upper.stack_id}"] .elev-unit`);
    const ys = [...boxes].map((r) => Number(r.getAttribute("y")));
    expect(ys[0] - ys[1]).toBe(lower.height_mm);
  });

  it("marks stacks over the height limit", () => {
    const { container } = renderView(tallPlan(), planMultidrop.request);
    const over = container.querySelectorAll(".elev-stack[data-over-limit]");
    expect(over).toHaveLength(1);
    expect(over[0]).toHaveClass("is-over");
    expect(over[0].querySelector(".elev-warning title")).toHaveTextContent("Over the height limit");
    expect(elevation()).toHaveAccessibleName(/1 stack over the height limit/);
    // The top view's stack says so too.
    act(() => screen.getByRole("radio", { name: "Top" }).click());
    expect(screen.getByRole("button", { name: /^Hardware.*over the height limit/ })).toBeInTheDocument();
  });

  it("draws both decks of a B-double at their deck height", () => {
    const { container } = renderView(planBdoubleContainers.result, planBdoubleContainers.request);
    expect(container.querySelectorAll(".elev-deck")).toHaveLength(2);
    expect(container.querySelectorAll(".elev-stack")).toHaveLength(2);
    expect(within(container.querySelector<HTMLElement>(".elevation-view")!).getByText("Tallest 4,196 mm")).toBeInTheDocument();
  });

  it("mirrors the drawing for the passenger's side, nearest units on top", () => {
    const order = (view: string) => {
      const { container, unmount } = renderView(planMultidrop.result, planMultidrop.request, view);
      const keys = [...container.querySelectorAll(".elev-stack")].map((g) => g.getAttribute("data-stack"));
      const flip = container.querySelector(".elevation-view > g:not(.elev-marks)")!.getAttribute("transform");
      unmount();
      return { keys, flip };
    };
    const driver = order("Driver side");
    const passenger = order("Passenger side");
    expect(driver.flip).toBeNull();
    expect(passenger.flip).toMatch(/scale\(-1 1\)/);
    // Stacks at different y draw in reverse order: the driver's side last for the driver, first for the passenger.
    const y = new Map(planMultidrop.result.placements.map((p) => [`${p.deck_id}:${p.stack_id}`, p.y_mm]));
    const ys = (keys: (string | null)[]) => keys.map((k) => y.get(k!)!);
    expect(ys(driver.keys).at(-1)).toBe(Math.min(...y.values()));
    expect(ys(passenger.keys).at(-1)).toBe(Math.max(...y.values()));
    expect(screen.queryByRole("img", { name: /side view/i })).toBeNull();
  });
});

describe("units in the side and rear views", () => {
  it("draws a pallet's wooden base at the bottom of each pallet unit", () => {
    const { container } = renderView(planMultidrop.result, planMultidrop.request);
    const pallets = planMultidrop.result.placements.filter((p) => p.kind === "pallet");
    const bases = container.querySelectorAll(".elev-pallet");
    expect(bases).toHaveLength(pallets.length);
    const unit = bases[0].parentElement!.querySelector(".elev-unit")!;
    expect(Number(bases[0].getAttribute("height"))).toBe(144);
    // Flush with the unit's bottom edge.
    expect(Number(bases[0].getAttribute("y")) + 144).toBe(Number(unit.getAttribute("y")) + Number(unit.getAttribute("height")));
  });

  it("puts the DG diamond on dangerous goods units, readable on the passenger's side too", () => {
    const dgUnits = planDgConflict.result.placements.filter((p) => planDgConflict.request.items.find((i) => i.id === p.item_id)?.dg);
    for (const view of ["Driver side", "Passenger side", "Rear"]) {
      const { container, unmount } = renderView(planDgConflict.result, planDgConflict.request, view);
      expect(container.querySelectorAll(".elev-stack .dg-diamond")).toHaveLength(dgUnits.length);
      const flipped = container.querySelector(".elev-stack .dg-diamond")!.parentElement!.getAttribute("transform");
      if (view === "Passenger side") expect(flipped).toMatch(/scale\(-1 1\)/);
      else expect(flipped).toBeNull();
      unmount();
    }
  });
});

describe("RearView", () => {
  it("draws each unit across the deck's width at its y, up from its deck", () => {
    const { container } = renderView(planMultidrop.result, planMultidrop.request, "Rear");
    expect(screen.getByRole("img", { name: /^Rear view: tallest point 3,100 mm, height limit 4,300 mm, all within it/ }))
      .toBeInTheDocument();
    expect(container.querySelectorAll(".rear-view .elev-unit")).toHaveLength(planMultidrop.result.placements.length);
    const p = planMultidrop.result.placements.find((u) => u.y_mm > 0 && u.stack_level === 0)!;
    const box = container.querySelector(`.elev-stack[data-stack="${p.deck_id}:${p.stack_id}"] .elev-unit`)!;
    // One deck, so no centring offset: x is the unit's y_mm, and its width is the unit's.
    expect(Number(box.getAttribute("x"))).toBe(p.y_mm);
    expect(Number(box.getAttribute("width"))).toBe(p.width_mm);
  });

  it("marks stacks over the height limit", () => {
    const { container } = renderView(tallPlan(), planMultidrop.request, "Rear");
    expect(container.querySelectorAll(".rear-view .elev-stack[data-over-limit]")).toHaveLength(1);
    expect(screen.getByRole("img", { name: /^Rear view: .*1 stack over the height limit/ })).toBeInTheDocument();
  });
});
