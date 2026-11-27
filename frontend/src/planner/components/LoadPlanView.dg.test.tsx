// Dangerous goods in the load plan drawing: placard badges, conflict outlines and the banner, all
// from the request's DG and the plan's warnings (planDgConflict: chlorine 5.1 conflicts with paint 3
// and battery acid 8; general freight has no DG).
import { act, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { PlanResult } from "../api/types.ts";
import { planDgConflict, planMultidrop, reference, type PlanFixture } from "../test/fixtures.ts";
import LoadPlanView from "./LoadPlanView.tsx";

function renderPlan(f: PlanFixture, result: PlanResult = f.result) {
  return render(<LoadPlanView result={result} reference={reference} request={f.request} />);
}

const deck = () => screen.getByRole("group", { name: /top-down plan/i });
const stacksOf = (label: string) =>
  within(deck()).getAllByRole("button").filter((el) => el.getAttribute("aria-label")!.startsWith(label));

describe("LoadPlanView dangerous goods", () => {
  it("puts a placard diamond with the class code on DG stacks only", () => {
    const { container } = renderPlan(planDgConflict);
    const expected: [string, string, number][] = [["Paint", "3", 4], ["Pool chlorine", "5.1", 3], ["Battery acid", "8", 2]];
    for (const [label, code, n] of expected) {
      const stacks = stacksOf(label);
      expect(stacks).toHaveLength(n);
      for (const s of stacks) {
        expect(s.querySelectorAll(".dg-diamond")).toHaveLength(1);
        expect(s.querySelector(".dg-diamond text")).toHaveTextContent(code);
        expect(s).toHaveAttribute("data-dg", code);
      }
    }
    const general = stacksOf("General freight");
    expect(general).toHaveLength(6);
    for (const s of general) expect(s.querySelector(".dg-diamond")).toBeNull();
    expect(container.querySelectorAll(".deck-view .dg-diamond")).toHaveLength(9);
  });

  it("keeps the badges in every colour mode", async () => {
    const { container } = renderPlan(planDgConflict);
    for (const mode of ["Weight", "Type", "DG class"]) {
      act(() => screen.getByRole("radio", { name: mode }).click());
      expect(container.querySelectorAll(".deck-view .dg-diamond")).toHaveLength(9);
    }
  });

  it("names the DG class in each stack's accessible label", () => {
    renderPlan(planDgConflict);
    expect(stacksOf("Pool chlorine")[0]).toHaveAccessibleName(/dangerous goods: Class 5\.1 Oxidising substance/);
    expect(stacksOf("General freight")[0].getAttribute("aria-label")).not.toMatch(/dangerous goods/);
  });

  it("outlines conflicting stacks in deck and elevation, with a warning icon and 'conflicts with' text", () => {
    const { container } = renderPlan(planDgConflict);
    for (const s of [...stacksOf("Paint"), ...stacksOf("Pool chlorine"), ...stacksOf("Battery acid")]) {
      expect(s).toHaveClass("has-conflict", "is-conflict-error");
      expect(s.querySelector(".deck-conflict-outline.is-error")).not.toBeNull();
      expect(s.querySelector(".deck-conflict-icon")).not.toBeNull();
      const key = s.getAttribute("data-stack");
      const elev = container.querySelector(`.elev-stack[data-stack="${key}"]`)!;
      expect(elev).toHaveClass("has-conflict", "is-conflict-error");
      expect(elev.querySelector(".elev-conflict title")).toHaveTextContent("Incompatible dangerous goods");
    }
    for (const s of stacksOf("General freight")) {
      expect(s).not.toHaveClass("has-conflict");
      expect(s.querySelector(".deck-conflict-outline")).toBeNull();
    }
    expect(stacksOf("Paint")[0]).toHaveAccessibleName(/conflicts with Pool chlorine \(Class 5\.1\)$/);
    expect(stacksOf("Battery acid")[0]).toHaveAccessibleName(/conflicts with Pool chlorine \(Class 5\.1\)$/);
    expect(stacksOf("Pool chlorine")[0])
      .toHaveAccessibleName(/conflicts with Paint \(Class 3\), Battery acid \(Class 8\)$/);
  });

  it("uses the warning outline for DG_CHECK warnings", () => {
    const result = structuredClone(planDgConflict.result);
    result.warnings = [{
      code: "DG_CHECK", severity: "warning", message: "Check Table 9.2.", suggestion: "", item_ids: ["paint", "acid"],
    }];
    renderPlan(planDgConflict, result);
    expect(stacksOf("Paint")[0]).toHaveClass("is-conflict-warning");
    expect(stacksOf("Paint")[0].querySelector(".deck-conflict-outline.is-warning")).not.toBeNull();
    expect(stacksOf("Pool chlorine")[0]).not.toHaveClass("has-conflict");
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });

  it("shows the class and the conflict messages in the details", () => {
    renderPlan(planDgConflict);
    act(() => stacksOf("Pool chlorine")[0].focus());
    const tip = screen.getByRole("tooltip");
    expect(tip).toHaveTextContent("Dangerous goods: Class 5.1 Oxidising substance");
    expect(tip).toHaveTextContent("Incompatible dangerous goods");
    expect(tip).toHaveTextContent(/"Paint" \(Class 3\) and "Pool chlorine" \(Class 5\.1\) can't travel on the same vehicle/);
    expect(tip).toHaveTextContent(/"Pool chlorine" \(Class 5\.1\) and "Battery acid" \(Class 8\) can't travel/);
  });

  it("has no DG details for general freight", () => {
    renderPlan(planDgConflict);
    act(() => stacksOf("General freight")[0].focus());
    expect(screen.getByRole("tooltip")).not.toHaveTextContent(/dangerous goods/i);
  });

  it("summarises incompatible goods in one banner above the deck", () => {
    const { container } = renderPlan(planDgConflict);
    const banner = screen.getByRole("note");
    expect(banner).toHaveTextContent(
      "Incompatible dangerous goods on this vehicle: Pool chlorine with Paint, Battery acid. Split them into separate loads.",
    );
    // Above the deck drawing.
    const figure = container.querySelector(".deck-view")!.closest("figure")!;
    expect(banner.compareDocumentPosition(figure) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("has no banner, badges or outlines without DG", () => {
    const { container } = renderPlan(planMultidrop);
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
    expect(screen.queryByText(/incompatible dangerous goods/i)).not.toBeInTheDocument();
    expect(container.querySelectorAll(".dg-diamond, .deck-conflict-outline, .elev-conflict")).toHaveLength(0);
  });
});
