import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { planDgConflict, planMultidrop, reference } from "../test/fixtures.ts";
import LoadPlanView from "./LoadPlanView.tsx";

function renderPlan() {
  return render(<LoadPlanView result={planMultidrop.result} reference={reference} request={planMultidrop.request} />);
}

const legend = () => screen.getByRole("group", { name: "Legend" });
const deckSvg = (container: HTMLElement) => container.querySelector<HTMLElement>(".deck-view")!;

describe("Legend and colour modes", () => {
  it("colours by DG class by default, in order of first appearance, general freight neutral", () => {
    const { container } = render(
      <LoadPlanView result={planDgConflict.result} reference={reference} request={planDgConflict.request} />,
    );
    expect(screen.getByRole("radio", { name: "DG class" })).toBeChecked();
    expect(within(legend()).getByText("Dangerous goods class")).toBeInTheDocument();
    const items = within(legend()).getAllByRole("listitem").map((li) => li.textContent);
    // Classes get colours in the order they first appear in the placements.
    const names: Record<string, string> = { paint: "3Flammable liquid", acid: "8Corrosive", chlorine: "5.1Oxidising substance" };
    const order = [...new Set(planDgConflict.result.placements.map((p) => p.item_id))].filter((id) => id in names);
    expect(items).toEqual([...order.map((id) => names[id]), "–General freight"]);
    const labels: Record<string, string> = { paint: "Paint", acid: "Battery acid", chlorine: "Pool chlorine" };
    const fillOf = (label: string) => container.querySelector(
      `.deck-view .deck-stack[aria-label^="${label}"] .deck-unit`)!.getAttribute("fill");
    order.forEach((id, i) => expect(fillOf(labels[id])).toBe(`var(--cat-${i + 1})`));
    expect(fillOf("General freight")).toBe("var(--cat-none)");
  });

  it("lists only general freight without DG", () => {
    const { container } = renderPlan();
    const items = within(legend()).getAllByRole("listitem").map((li) => li.textContent);
    expect(items).toEqual(["–General freight"]);
    const fills = [...container.querySelectorAll(".deck-view .deck-unit")].map((r) => r.getAttribute("fill"));
    expect(new Set(fills)).toEqual(new Set(["var(--cat-none)"]));
  });

  it("switches to weight: a heat scale with min and max", async () => {
    const { container } = renderPlan();
    await userEvent.click(screen.getByRole("radio", { name: "Weight" }));
    expect(within(legend()).getByText("Stack weight")).toBeInTheDocument();
    expect(within(legend()).getByText(/Lightest 600 kg, heaviest 950 kg/)).toBeInTheDocument();
    const fills = [...container.querySelectorAll(".deck-view .deck-unit")].map((r) => r.getAttribute("fill"));
    expect(fills.every((f) => /^var\(--heat-[1-6]\)$/.test(f!))).toBe(true);
    expect(fills).toContain("var(--heat-6)");
  });

  it("switches to type: patterns with type codes and names", async () => {
    const { container } = renderPlan();
    await userEvent.click(screen.getByRole("radio", { name: "Type" }));
    expect(within(legend()).getByText(/Australian Standard pallet/)).toBeInTheDocument();
    expect(within(legend()).getByText(/Euro \(EUR \/ EPAL\) pallet/)).toBeInTheDocument();
    expect(within(deckSvg(container)).getAllByText("AU").length).toBeGreaterThan(0);
    expect(within(deckSvg(container)).getAllByText("EURO").length).toBeGreaterThan(0);
    const patterns = new Set([...container.querySelectorAll(".deck-view .deck-stack rect[fill^='url(']")]
      .map((r) => r.getAttribute("fill")));
    expect(patterns.size).toBe(2);
  });

  it("explains the axle marker", () => {
    renderPlan();
    expect(within(legend()).getByText(/axle group, one tick per axle/i)).toBeInTheDocument();
  });
});
