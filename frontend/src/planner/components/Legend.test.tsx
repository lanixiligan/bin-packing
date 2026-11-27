import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { planMultidrop, reference } from "../test/fixtures.ts";
import LoadPlanView from "./LoadPlanView.tsx";

function renderPlan() {
  return render(<LoadPlanView result={planMultidrop.result} reference={reference} request={planMultidrop.request} />);
}

const legend = () => screen.getByRole("group", { name: "Legend" });
const deckSvg = (container: HTMLElement) => container.querySelector<HTMLElement>(".deck-view")!;

describe("Legend and colour modes", () => {
  it("colours by stop by default, with stop badges and LIFO explained", () => {
    const { container } = renderPlan();
    expect(screen.getByRole("radio", { name: "Stop" })).toBeChecked();
    expect(within(legend()).getByText("Delivery stop")).toBeInTheDocument();
    for (const n of [1, 2, 3]) expect(within(legend()).getByText(`Stop ${n}`)).toBeInTheDocument();
    expect(within(legend()).getByText(/Euro imports × 4, Dry goods × 6/)).toBeInTheDocument();
    expect(within(legend()).getByText(/stop 1 comes off first and stop 3 is unloaded last/)).toBeInTheDocument();
    expect(within(deckSvg(container)).getAllByText("S3")).toHaveLength(6);
    expect(within(deckSvg(container)).getAllByText("S1")).toHaveLength(5);
    const fills = [...container.querySelectorAll(".deck-view .deck-unit")].map((r) => r.getAttribute("fill"));
    expect(new Set(fills)).toEqual(new Set(["var(--stop-1)", "var(--stop-2)", "var(--stop-3)"]));
  });

  it("switches to weight: a heat scale with min and max, no stop badges", async () => {
    const { container } = renderPlan();
    await userEvent.click(screen.getByRole("radio", { name: "Weight" }));
    expect(within(legend()).getByText("Stack weight")).toBeInTheDocument();
    expect(within(legend()).getByText(/Lightest 600 kg, heaviest 950 kg/)).toBeInTheDocument();
    expect(within(deckSvg(container)).queryByText("S3")).not.toBeInTheDocument();
    const fills = [...container.querySelectorAll(".deck-view .deck-unit")].map((r) => r.getAttribute("fill"));
    expect(fills.every((f) => /^var\(--heat-[1-6]\)$/.test(f!))).toBe(true);
    expect(fills).toContain("var(--heat-6)");
  });

  it("switches to type: patterns with type codes and names", async () => {
    const { container } = renderPlan();
    await userEvent.click(screen.getByRole("radio", { name: "Type" }));
    expect(within(legend()).getByText(/Australian Standard pallet/)).toBeInTheDocument();
    expect(within(legend()).getByText(/Euro \(EUR \/ EPAL\) pallet/)).toBeInTheDocument();
    expect(within(deckSvg(container)).queryByText("S3")).not.toBeInTheDocument();
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
