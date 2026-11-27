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

  it("formats numbers with units and lists stacked levels", async () => {
    render(<PlacementTable id="t" placements={planMultidrop.result.placements} decks={vehicle.decks} typeName={typeName} />);
    await userEvent.click(screen.getByText("Show the plan as a table"));
    const row = screen.getByRole("row", { name: /dry#6/ });
    const cells = within(row).getAllByRole("cell").map((c) => c.textContent);
    expect(cells).toEqual([
      "dry#6", "Dry goods", "–", "type AU_STD", "Trailer", "3,495 mm", "0 mm", "1,165 × 1,165 × 900 mm", "410 kg", "2", "2",
    ]);
  });

  it("sorts by stop", async () => {
    render(<PlacementTable id="t" placements={planMultidrop.result.placements} decks={vehicle.decks} typeName={typeName} />);
    await userEvent.click(screen.getByText("Show the plan as a table"));
    const firstUnit = () => within(screen.getAllByRole("row")[1]).getAllByRole("cell")[0].textContent;
    expect(firstUnit()).toBe("bev#1");
    await userEvent.click(screen.getByRole("button", { name: /stop/i }));
    expect(firstUnit()).toMatch(/^hw#/);
    expect(screen.getByRole("columnheader", { name: /stop/i })).toHaveAttribute("aria-sort", "ascending");
  });

  it("orders multi-deck placements by vehicle position", async () => {
    render(<PlacementTable id="t" placements={planBdoubleContainers.result.placements}
                           decks={reference.vehicles.B_DOUBLE.decks} typeName={typeName} />);
    await userEvent.click(screen.getByText("Show the plan as a table"));
    const decks = screen.getAllByRole("row").slice(1).map((r) => within(r).getAllByRole("cell")[4].textContent);
    expect(decks).toEqual(["Lead trailer", "Rear trailer"]);
  });

  it("has a DG column with the placard code and class name, a dash for general freight", async () => {
    render(<PlacementTable id="t" placements={planDgConflict.result.placements} decks={vehicle.decks} typeName={typeName}
                           dg={dgByItem(planDgConflict.request)} />);
    await userEvent.click(screen.getByText("Show the plan as a table"));
    expect(screen.getByRole("columnheader", { name: "DG" })).toBeInTheDocument();
    const dgOf = (unit: string) => within(screen.getByRole("row", { name: new RegExp(unit) })).getAllByRole("cell")[2].textContent;
    expect(dgOf("chlorine#1")).toBe("5.1 Oxidising substance");
    expect(dgOf("paint#2")).toBe("3 Flammable liquid");
    expect(dgOf("acid#1")).toBe("8 Corrosive");
    expect(dgOf("gen#1")).toBe("–");
  });
});
