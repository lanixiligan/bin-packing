import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { dgByItem } from "../lib/dg.ts";
import { planBdoubleContainers, planDgConflict, planMultidrop, reference } from "../test/fixtures.ts";
import PlacementTable from "./PlacementTable.tsx";

const vehicle = reference.vehicles.SEMI_TRAILER;
const typeName = (p: { type_id: string }) => `type ${p.type_id}`;

describe("PlacementTable", () => {
  it("has one row per placement, inside a collapsed details", () => {
    const { container } = render(
      <PlacementTable id="t" placements={planMultidrop.result.placements} decks={vehicle.decks} typeName={typeName} />,
    );
    expect(container.querySelector("details")).not.toHaveAttribute("open");
    expect(screen.getByText("Show the plan as a table")).toBeInTheDocument();
    const table = screen.getByRole("table", { hidden: true });
    const rows = within(table).getAllByRole("row", { hidden: true });
    expect(rows).toHaveLength(planMultidrop.result.placements.length + 1);
  });

  /** The row of a unit, by its id (kept on the row; the table shows "label #n"). */
  const rowOf = (unitId: string) => document.querySelector<HTMLElement>(`tr[data-unit="${unitId}"]`)!;
  const cellsOf = (unitId: string) => within(rowOf(unitId)).getAllByRole("cell").map((c) => c.textContent);
  const headers = () => screen.getAllByRole("columnheader").map((h) => h.textContent);

  it("has one column for the position and one for the size, units and stacked levels included", async () => {
    render(<PlacementTable id="t" placements={planMultidrop.result.placements} decks={vehicle.decks} typeName={typeName} />);
    await userEvent.click(screen.getByText("Show the plan as a table"));
    expect(headers()).toEqual(["Item", "DG", "Type", "Position (x, y, z)", "Size (L × W × H)", "Weight", "Level"]);
    const upper = planMultidrop.result.placements.find((p) => p.stack_level === 1)!;
    const n = (v: number) => v.toLocaleString("en-AU");
    expect(cellsOf(upper.unit_id)).toEqual([
      `${upper.label} unit #${upper.unit_id.split("#")[1]}`, "–", "type AU_STD",
      `${n(upper.x_mm)} · ${n(upper.y_mm)} · ${n(upper.z_mm)} mm`,
      `${n(upper.length_mm)} × ${n(upper.width_mm)} × ${n(upper.height_mm)} mm`,
      `${n(upper.weight_kg)} kg`, "2",
    ]);
    expect(upper.z_mm).toBeGreaterThan(0); // the upper unit of a stack: z is its height off the deck
    expect(rowOf(upper.unit_id)).not.toHaveTextContent(upper.item_id); // line ids are internal
  });

  it("has no inner scroll box: the table is as tall as its rows", async () => {
    const { container } = render(
      <PlacementTable id="t" placements={planMultidrop.result.placements} decks={vehicle.decks} typeName={typeName} />,
    );
    const wrapper = container.querySelector<HTMLElement>(".table-scroll")!;
    expect(wrapper.style.maxHeight).toBe("");
    expect(screen.getByRole("table", { hidden: true }).closest("details")).not.toHaveAttribute("open");
  });

  it("names the deck only on a multi-deck vehicle, in vehicle position order", async () => {
    render(<PlacementTable id="t" placements={planBdoubleContainers.result.placements}
                           decks={reference.vehicles.B_DOUBLE.decks} typeName={typeName} />);
    await userEvent.click(screen.getByText("Show the plan as a table"));
    expect(headers()).toEqual(["Item", "DG", "Type", "Deck", "Position (x, y, z)", "Size (L × W × H)", "Weight", "Level"]);
    const decks = screen.getAllByRole("row").slice(1).map((r) => within(r).getAllByRole("cell")[3].textContent);
    expect(decks).toEqual(["Lead trailer", "Rear trailer"]);
  });

  it("has a DG column with the placard code and class name, a dash for general freight", async () => {
    render(<PlacementTable id="t" placements={planDgConflict.result.placements} decks={vehicle.decks} typeName={typeName}
                           dg={dgByItem(planDgConflict.request)} />);
    await userEvent.click(screen.getByText("Show the plan as a table"));
    expect(screen.getByRole("columnheader", { name: "DG" })).toBeInTheDocument();
    const dgOf = (unit: string) => cellsOf(unit)[1];
    expect(dgOf("chlorine#1")).toBe("5.1 Oxidising substance");
    expect(dgOf("paint#2")).toBe("3 Flammable liquid");
    expect(dgOf("acid#1")).toBe("8 Corrosive");
    expect(dgOf("gen#1")).toBe("–");
  });
});
