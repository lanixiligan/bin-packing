import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { PlanResult } from "../api/types.ts";
import { UnitsProvider } from "../lib/UnitsProvider.tsx";
import { planBdoubleContainers, planMultidrop, reference } from "../test/fixtures.ts";
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

describe("ElevationView", () => {
  it("shows the height limit and the tallest point", () => {
    const { container } = render(
      <LoadPlanView result={planMultidrop.result} reference={reference} request={planMultidrop.request} />,
    );
    const svg = container.querySelector<HTMLElement>(".elevation-view")!;
    expect(within(svg).getByText("4,300 mm height limit")).toBeInTheDocument();
    expect(within(svg).getByText("Tallest 3,100 mm")).toBeInTheDocument();
    expect(elevation()).toHaveAccessibleName(/tallest point 3,100 mm, height limit 4,300 mm, all within it/);
    expect(container.querySelectorAll(".elev-stack[data-over-limit]")).toHaveLength(0);
  });

  it("formats the limit in the chosen units", () => {
    const { container } = render(
      <UnitsProvider initial="m-t">
        <LoadPlanView result={planMultidrop.result} reference={reference} request={planMultidrop.request} />
      </UnitsProvider>,
    );
    expect(within(container.querySelector<HTMLElement>(".elevation-view")!).getByText("4.30 m height limit")).toBeInTheDocument();
  });

  it("draws every unit, stacked units at their z", () => {
    const { container } = render(
      <LoadPlanView result={planMultidrop.result} reference={reference} request={planMultidrop.request} />,
    );
    expect(container.querySelectorAll(".elev-unit")).toHaveLength(planMultidrop.result.placements.length);
    // dry#5 (floor) and dry#6 (z 900) share stack 7: the upper box sits 900 mm higher.
    const boxes = container.querySelectorAll('.elev-stack[data-stack="trailer:7"] .elev-unit');
    const ys = [...boxes].map((r) => Number(r.getAttribute("y")));
    expect(ys[0] - ys[1]).toBe(900);
  });

  it("marks stacks over the height limit", () => {
    const { container } = render(
      <LoadPlanView result={tallPlan()} reference={reference} request={planMultidrop.request} />,
    );
    const over = container.querySelectorAll(".elev-stack[data-over-limit]");
    expect(over).toHaveLength(1);
    expect(over[0]).toHaveClass("is-over");
    expect(over[0].querySelector(".elev-warning title")).toHaveTextContent("Over the height limit");
    expect(elevation()).toHaveAccessibleName(/1 stack over the height limit/);
    expect(screen.getByRole("button", { name: /^Hardware.*over the height limit/ })).toBeInTheDocument();
  });

  it("draws both decks of a B-double at their deck height", () => {
    const { container } = render(
      <LoadPlanView result={planBdoubleContainers.result} reference={reference} request={planBdoubleContainers.request} />,
    );
    expect(container.querySelectorAll(".elev-deck")).toHaveLength(2);
    expect(container.querySelectorAll(".elev-stack")).toHaveLength(2);
    expect(within(container.querySelector<HTMLElement>(".elevation-view")!).getByText("Tallest 4,196 mm")).toBeInTheDocument();
  });
});
