import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { planBdoubleContainers, planMultidrop, reference, type PlanFixture } from "../test/fixtures.ts";
import LoadPlanView from "./LoadPlanView.tsx";

function renderPlan(f: PlanFixture) {
  return render(<LoadPlanView result={f.result} reference={reference} request={f.request} />);
}

const deck = () => screen.getByRole("group", { name: /top-down plan/i });
const stacks = () => within(deck()).getAllByRole("button");

describe("DeckView", () => {
  it("draws one focusable element per floor stack", () => {
    renderPlan(planMultidrop);
    const floor = planMultidrop.result.placements.filter((p) => p.stack_level === 0);
    expect(stacks()).toHaveLength(floor.length);
    for (const el of stacks()) expect(el).toHaveAttribute("tabindex", "0");
  });

  it("labels each stack with its item and weight", () => {
    renderPlan(planMultidrop);
    const bev = stacks().filter((el) => el.getAttribute("aria-label")!.startsWith("Beverages"));
    expect(bev).toHaveLength(6);
    expect(bev[0]).toHaveAccessibleName(/Beverages, Australian Standard pallet 1,165 × 1,165 mm, 820 kg/);
    // A stack of two dry-goods pallets: total weight and the stack size.
    const dry = stacks().find((el) => /Dry goods/.test(el.getAttribute("aria-label")!) && /stack of 2/.test(el.getAttribute("aria-label")!));
    expect(dry).toBeDefined();
    expect(dry).toHaveAccessibleName(/in total, stack of 2/);
  });

  it("summarises the plan and points at the table", () => {
    renderPlan(planMultidrop);
    expect(deck()).toHaveAccessibleName(/Semi-trailer.*18 stacks \(21 units\) on a 13,900 mm deck/);
    const tableId = deck().getAttribute("aria-describedby")!;
    expect(document.getElementById(tableId)?.tagName).toBe("TABLE");
  });

  it("draws the cab direction, axle groups and stack badges", () => {
    const { container } = renderPlan(planMultidrop);
    const svg = container.querySelector(".deck-view")!;
    expect(within(svg as HTMLElement).getByText("FRONT")).toBeInTheDocument();
    expect(within(svg as HTMLElement).getByText("REAR")).toBeInTheDocument();
    const axleLabels = [...container.querySelectorAll(".deck-axle-label")].map((el) => el.textContent);
    expect(axleLabels).toEqual(["Steer", "Drive", "Tri"]);
    // Wheel ticks by kind: steer 1, tandem 2, tri 3.
    const ticks = [...container.querySelectorAll(".deck-axle")].map((g) => g.querySelectorAll("rect").length);
    expect(ticks).toEqual([1, 2, 3]);
    expect(within(svg as HTMLElement).getAllByText("×2").length).toBeGreaterThan(0);
  });

  it("draws both decks and both containers of a B-double", () => {
    const { container } = renderPlan(planBdoubleContainers);
    expect(container.querySelectorAll("[data-deck]")).toHaveLength(2);
    expect(within(deck()).getByText("Lead trailer")).toBeInTheDocument();
    expect(within(deck()).getByText("Rear trailer")).toBeInTheDocument();
    expect(stacks()).toHaveLength(2);
    expect(within(deck()).getByRole("button", { name: /MSKU 20'.*on the lead trailer/ })).toBeInTheDocument();
    expect(within(deck()).getByRole("button", { name: /TGHU 40' HC.*on the rear trailer/ })).toBeInTheDocument();
    expect(deck()).toHaveAccessibleName(/2 decks \(7,400 mm and 13,600 mm\)/);
  });

  it("places units to scale at deck x + placement x, with the driver's side at the bottom", () => {
    const { container } = renderPlan(planBdoubleContainers);
    const c40 = container.querySelector<SVGGElement>('.deck-stack[data-stack="rear:2"]')!;
    // Rear deck front at 11,200 + 700 = 11,900 mm.
    expect(c40.style.transform).toMatch(/^translate\(11900px, /);
  });

  it("shows details on hover and hides them on Escape", async () => {
    const user = userEvent.setup();
    renderPlan(planMultidrop);
    const dry = stacks().find((el) => /stack of 2/.test(el.getAttribute("aria-label")!))!;
    await user.hover(dry);
    const tip = screen.getByRole("tooltip");
    expect(tip).toHaveTextContent("Dry goods");
    expect(tip).toHaveTextContent("Australian Standard pallet");
    expect(tip).toHaveTextContent(/410 kg each, 820 kg in total/);
    expect(tip).toHaveTextContent(/L2/); // the second level is listed
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("shows details on focus, moves with the arrow keys and closes on Escape", async () => {
    renderPlan(planMultidrop);
    const all = stacks();
    const labelOf = (el: Element) => el.getAttribute("aria-label")!.split(",")[0];
    const first = all[0];
    act(() => first.focus());
    expect(screen.getByRole("tooltip")).toHaveTextContent(labelOf(first));
    expect(first).toHaveAttribute("aria-describedby", screen.getByRole("tooltip").id);

    fireEvent.keyDown(document.activeElement!, { key: "End" });
    const last = labelOf(all[all.length - 1]);
    expect(document.activeElement).toHaveAccessibleName(new RegExp(`^${last}`));
    expect(screen.getByRole("tooltip")).toHaveTextContent(last);

    const atEnd = document.activeElement;
    fireEvent.keyDown(document.activeElement!, { key: "ArrowLeft" });
    expect(document.activeElement).not.toBe(atEnd); // moved towards the front
    expect(document.activeElement?.getAttribute("role")).toBe("button");
    fireEvent.keyDown(document.activeElement!, { key: "Home" });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(document.activeElement!, { key: "ArrowRight" });
    expect(document.activeElement).not.toBe(first);
    expect(document.activeElement?.getAttribute("role")).toBe("button");

    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("highlights the same stack in the elevation", async () => {
    const user = userEvent.setup();
    const { container } = renderPlan(planMultidrop);
    const target = stacks()[3];
    await user.hover(target);
    const key = target.getAttribute("data-stack");
    expect(container.querySelector(`.elev-stack[data-stack="${key}"]`)).toHaveClass("is-highlighted");
    expect(container.querySelectorAll(".elev-stack.is-dimmed").length).toBe(stacks().length - 1);
  });
});
