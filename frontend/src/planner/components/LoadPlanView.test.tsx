import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { PlanResult } from "../api/types.ts";
import { lineLit } from "../lib/sceneData.ts";
import { fleetSample, planMultidrop, planOverCapacity, reference } from "../test/fixtures.ts";
import LoadPlanView from "./LoadPlanView.tsx";

// three.js doesn't run in jsdom: the lazy 3D scene is a stand-in that shows what it was given.
vi.mock("./TruckScene3D.jsx", () => ({
  default: ({ data, onSelectTruck }: { data: { trucks: { shipments: unknown[] }[] }; onSelectTruck?: (i: number) => void }) => (
    <div data-testid="scene3d">
      {data.trucks.length} truck, {data.trucks[0].shipments.length} units
      {onSelectTruck && <button type="button" onClick={() => onSelectTruck(1)}>Pick truck 2</button>}
    </div>
  ),
}));

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
    // The drawing opens fitted to its box (100 % of its width, whatever that is): no sideways scroll.
    const width = () => container.querySelector<SVGElement>(".deck-view, .elevation-view")!.style.width;
    expect(zoom()).toBe("100 %");
    expect(width()).toBe("100%");
    expect(screen.getByRole("button", { name: "Zoom out" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Fit to width" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Zoom in" }));
    await user.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(zoom()).toBe("200 %");
    expect(width()).toBe("200%"); // zoomed in: wider than the box, which then scrolls
    await user.click(screen.getByRole("button", { name: "Zoom out" }));
    expect(zoom()).toBe("150 %");
    await user.click(screen.getByRole("button", { name: "Fit to width" }));
    expect(zoom()).toBe("100 %");
    expect(width()).toBe("100%");
    expect(screen.getByRole("button", { name: "Fit to width" })).toBeDisabled();
    // The top and side views share the x scale (same viewBox x range), and the zoom.
    const xRange = (svg: Element) => svg.getAttribute("viewBox")!.split(" ").filter((_, i) => i % 2 === 0);
    const deckRange = xRange(container.querySelector(".deck-view")!);
    await user.click(screen.getByRole("button", { name: "Zoom in" }));
    await user.click(screen.getByRole("radio", { name: "Driver side" }));
    expect(xRange(container.querySelector(".elevation-view")!)).toEqual(deckRange);
    expect(width()).toBe("150%");
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
    const row = screen.getByRole("table", { hidden: true }).querySelector<HTMLElement>(`tr[data-unit="${pipes.unit_id}"]`)!;
    expect(row).toHaveTextContent("Loose item");
    expect(row).toHaveTextContent("6,000 × 800 × 400 mm");
  });

  it("offers the four colour modes, freight line first", () => {
    render(<LoadPlanView result={planMultidrop.result} reference={reference} request={planMultidrop.request} />);
    const group = screen.getByRole("group", { name: "Colour by" });
    expect(within(group).getAllByRole("radio").map((r) => r.getAttribute("value"))).toEqual(["line", "dg", "weight", "type"]);
  });

  it("shows one 2D view at a time, the top view first", async () => {
    const user = userEvent.setup();
    const { container } = render(<LoadPlanView result={planMultidrop.result} reference={reference} request={planMultidrop.request} />);
    const group = screen.getByRole("group", { name: "View" });
    const options = within(group).getAllByRole("radio");
    expect(options.map((r) => r.closest("label")!.textContent)).toEqual(["Top", "Driver side", "Passenger side", "Rear"]);
    expect(options[0]).toBeChecked();
    const drawings = () => [...container.querySelectorAll("svg[role]")].map((svg) => svg.getAttribute("aria-label")!.split(":")[0]);
    expect(drawings()).toEqual([expect.stringMatching(/top-down/i)]);

    for (const [name, label] of [["Driver side", "Side view from the driver's side"],
      ["Passenger side", "Side view from the passenger's side"], ["Rear", "Rear view"]]) {
      await user.click(within(group).getByRole("radio", { name }));
      expect(drawings()).toEqual([label]);
    }
    // The legend stays with every view.
    expect(screen.getByRole("group", { name: "Legend" })).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: "3D" }));
    expect(screen.queryByRole("group", { name: "View" })).not.toBeInTheDocument();
  });

  it("shows the truck in 3D on request (2D by default), loaded on demand", async () => {
    const user = userEvent.setup();
    const { container } = render(<LoadPlanView result={planMultidrop.result} reference={reference} request={planMultidrop.request} />);
    const drawing = screen.getByRole("group", { name: "Drawing" });
    expect(within(drawing).getByRole("radio", { name: "2D" })).toBeChecked();
    expect(container.querySelector(".deck-view")).toBeInTheDocument();

    await user.click(within(drawing).getByRole("radio", { name: "3D" }));
    expect(await screen.findByTestId("scene3d")).toHaveTextContent("1 truck, 21 units");
    // The 2D drawings and their tools make way; the placement table stays for screen readers.
    expect(container.querySelector(".deck-view")).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Colour by" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Replay/ })).toBeInTheDocument();
    expect(screen.getByRole("table", { hidden: true })).toBeInTheDocument();

    await user.click(within(drawing).getByRole("radio", { name: "2D" }));
    expect(container.querySelector(".deck-view")).toBeInTheDocument();
  });

  it("lights the stacks of a freight line hovered in step 2, and reports a hovered stack's units", () => {
    const onHoverLit = vi.fn();
    const { container } = render(<LoadPlanView result={planMultidrop.result} reference={reference} request={planMultidrop.request}
                                               lit={lineLit("dry")} onHoverLit={onHoverLit} />);
    const lit = [...container.querySelectorAll(".deck-stack.is-lit")].map((g) => g.getAttribute("data-stack"));
    expect(lit).toHaveLength(3); // dry goods: three stacks of two
    expect(container.querySelectorAll(".deck-stack.is-dimmed")).toHaveLength(container.querySelectorAll(".deck-stack").length - 3);
    act(() => screen.getByRole("radio", { name: "Rear" }).click());
    expect(container.querySelectorAll(".elev-stack.is-highlighted")).toHaveLength(3);
    act(() => screen.getByRole("radio", { name: "Top" }).click());

    fireEvent.mouseEnter(container.querySelector(`.deck-stack[data-stack="${lit[0]}"]`)!);
    const [{ items, units }] = onHoverLit.mock.lastCall!;
    expect(items).toEqual(["dry"]);
    expect(units).toHaveLength(2); // the stack's two units, floor first
    expect(units.every((u: string) => u.startsWith("dry#"))).toBe(true);
    fireEvent.mouseLeave(container.querySelector(`.deck-stack[data-stack="${lit[0]}"]`)!);
    expect(onHoverLit).toHaveBeenLastCalledWith(null);
  });

  describe("all the trucks of a split", () => {
    const { request, result: fleet } = fleetSample;

    it("draws every truck in the chosen view, one under another, with one legend", async () => {
      const user = userEvent.setup();
      const onSelectTruck = vi.fn();
      const { container } = render(<LoadPlanView fleet={fleet} reference={reference} request={request} onSelectTruck={onSelectTruck} />);
      expect(container.querySelectorAll(".deck-view")).toHaveLength(2);
      expect(screen.getAllByRole("group", { name: "Legend" })).toHaveLength(1);
      expect(screen.queryByRole("table", { hidden: true })).not.toBeInTheDocument(); // each truck's tab has its table
      await user.click(screen.getByRole("radio", { name: "Driver side" }));
      expect(container.querySelectorAll(".elevation-view")).toHaveLength(2);
      await user.click(screen.getByRole("button", { name: /^Truck 2/ }));
      expect(onSelectTruck).toHaveBeenCalledWith(1);
    });

    it("colours a freight line the same on every truck, and lights it on every truck", () => {
      const { container } = render(<LoadPlanView fleet={fleet} reference={reference} request={request} lit={lineLit("cem")} />);
      const [one, two] = container.querySelectorAll(".deck-view");
      const fill = (svg: Element) => svg.querySelector('.deck-stack[aria-label^="Cement"] .deck-unit')!.getAttribute("fill");
      expect(fill(one)).toBe(fill(two));
      expect(one.querySelectorAll(".deck-stack.is-lit").length).toBeGreaterThan(0);
      expect(two.querySelectorAll(".deck-stack.is-lit").length).toBeGreaterThan(0);
    });

    it("shows every truck in 3D, and opens the one clicked", async () => {
      const user = userEvent.setup();
      const onSelectTruck = vi.fn();
      render(<LoadPlanView fleet={fleet} reference={reference} request={request} onSelectTruck={onSelectTruck} />);
      await user.click(screen.getByRole("radio", { name: "3D" }));
      expect(await screen.findByTestId("scene3d")).toHaveTextContent(/^2 truck/);
      await user.click(screen.getByRole("button", { name: "Pick truck 2" }));
      expect(onSelectTruck).toHaveBeenCalledWith(1);
    });
  });
});
