import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { PlanResult } from "../api/types.ts";
import { planMultidrop, planOverCapacity, reference } from "../test/fixtures.ts";
import LoadPlanView from "./LoadPlanView.tsx";

describe("LoadPlanView", () => {
  it("lists unplaced units grouped by item, with a pointer to the warnings", () => {
    render(<LoadPlanView result={planOverCapacity.result} reference={reference} request={planOverCapacity.request} />);
    const section = screen.getByRole("region", { name: /not placed/i });
    expect(within(section).getByText("Chilled")).toBeInTheDocument();
    expect(within(section).getByText("× 1")).toBeInTheDocument();
    expect(within(section).queryByText("(chill#3)")).not.toBeInTheDocument(); // unit ids are internal
    expect(within(section).getByText(/see the warnings/i)).toBeInTheDocument();
  });

  it("has no unplaced list when everything fits", () => {
    render(<LoadPlanView result={planMultidrop.result} reference={reference} request={planMultidrop.request} />);
    expect(screen.queryByRole("region", { name: /not placed/i })).not.toBeInTheDocument();
  });

  it("zooms the drawings in steps and fits them back", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <LoadPlanView result={planMultidrop.result} reference={reference} request={planMultidrop.request} />,
    );
    const zoom = () => screen.getByLabelText("Zoom level").textContent;
    expect(zoom()).toBe("100 %");
    expect(screen.getByRole("button", { name: "Zoom out" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Fit to width" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Zoom in" }));
    await user.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(zoom()).toBe("200 %");
    await user.click(screen.getByRole("button", { name: "Zoom out" }));
    expect(zoom()).toBe("150 %");
    await user.click(screen.getByRole("button", { name: "Fit to width" }));
    expect(zoom()).toBe("100 %");
    // Both drawings share the x scale: same viewBox x range.
    const [deck, elev] = [container.querySelector(".deck-view")!, container.querySelector(".elevation-view")!];
    const xRange = (svg: Element) => svg.getAttribute("viewBox")!.split(" ").filter((_, i) => i % 2 === 0);
    expect(xRange(deck)).toEqual(xRange(elev));
  });

  it("draws a loose item at its own size, named in the drawing, the legend and the table", async () => {
    // A 6 m pipe bundle in place of the first pallet (the drawings take sizes straight from the placement).
    const [first, ...rest] = planMultidrop.result.placements;
    const pipes = { ...first, kind: "loose" as const, type_id: "LOOSE", label: "Pipes", length_mm: 6000, width_mm: 800,
                    height_mm: 400 };
    const result: PlanResult = { ...planMultidrop.result, placements: [pipes, ...rest.filter((p) => p.stack_id !== first.stack_id)] };
    const { container } = render(<LoadPlanView result={result} reference={reference} request={planMultidrop.request} />);

    const unit = screen.getByRole("button", { name: /^Pipes, Loose item 6,000 × 800 mm/ });
    const edge = unit.querySelector(".deck-unit")!;
    const sizes = [...container.querySelectorAll(".deck-unit")].map((r) => Number(r.getAttribute("width")));
    expect(Number(edge.getAttribute("width"))).toBe(Math.max(...sizes)); // the long bar

    await userEvent.click(screen.getByRole("radio", { name: "Type" }));
    const legend = screen.getByRole("heading", { name: "Freight type" }).parentElement!;
    expect(within(legend).getByText("LOOSE")).toBeInTheDocument();
    expect(legend).toHaveTextContent(/LOOSE Loose item × 1/);
    const row = within(screen.getByRole("table", { hidden: true })).getByText(pipes.unit_id).closest("tr")!;
    expect(row).toHaveTextContent("Loose item");
    expect(row).toHaveTextContent("6,000 × 800 × 400 mm");
  });

  it("offers the three colour modes", () => {
    render(<LoadPlanView result={planMultidrop.result} reference={reference} request={planMultidrop.request} />);
    const group = screen.getByRole("group", { name: "Colour by" });
    expect(within(group).getAllByRole("radio").map((r) => r.getAttribute("value"))).toEqual(["dg", "weight", "type"]);
  });
});
