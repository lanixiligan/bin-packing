import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import ShipmentTable from "./ShipmentTable.jsx";
import TruckCard from "./TruckCard.jsx";

const ship = (uid, name, weight, pallets = 1, dgClass = null) => ({ uid, name, weight, pallets, dgClass, subsidiary: [] });
const list = [ship(101, "Steel 01", 534), ship(102, "Paint 02", 122, 2, "3"), ship(103, "Rice 03", 600, 3, "food")];

function Harness({ initial = list, ...props }) {
  const [shipments, setShipments] = useState(initial);
  return <ShipmentTable shipments={shipments} capacity={1000} onChange={setShipments} {...props} />;
}

describe("ShipmentTable", () => {
  it("shows one read-only line per shipment", () => {
    render(<Harness />);
    const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent(/Steel 01\s*534\s*1/);
    expect(screen.queryByRole("textbox", { name: "Shipment name" })).not.toBeInTheDocument();
    // No Truck column before solving.
    expect(screen.queryByRole("columnheader", { name: "Truck" })).not.toBeInTheDocument();
  });

  it("edits a row in place and returns focus to it on Escape", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Edit Paint 02" }));
    const weight = screen.getByRole("spinbutton", { name: "Weight of Paint 02 in kg" });
    await user.clear(weight);
    await user.type(weight, "250");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("spinbutton", { name: /Weight of/ })).not.toBeInTheDocument();
    expect(within(screen.getByRole("table")).getAllByRole("row")[2]).toHaveTextContent(/Paint 02\s*250/);
    await new Promise((r) => requestAnimationFrame(r));
    expect(screen.getByRole("button", { name: "Edit Paint 02" })).toHaveFocus();
  });

  it("flags a shipment heavier than a truck", () => {
    render(<Harness initial={[ship(101, "Steel 01", 1200)]} />);
    const edit = screen.getByRole("button", { name: "Edit Steel 01" });
    expect(edit).toHaveAccessibleDescription("Heavier than a truck can carry.");
  });

  it("adds a shipment, filling in the DG class of a catalogue item", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(screen.getByRole("combobox", { name: "New shipment name" }), "Methanol");
    await user.type(screen.getByRole("spinbutton", { name: "New shipment weight in kg" }), "150");
    await user.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.getByRole("button", { name: "Edit Methanol" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Dangerous goods for Methanol: Class 3 \(sub 6\.1\)/ })).toBeInTheDocument();
  });

  it("after solving, shows each shipment's truck and reports hover by row", () => {
    const onHover = vi.fn();
    render(<Harness placement={{ 0: { truck: 2 }, 1: { truck: 1 }, 2: { truck: 2 } }} activeTruck={2} onHover={onHover} />);
    expect(screen.getByRole("columnheader", { name: "Truck" })).toBeInTheDocument();
    const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1);
    expect(rows.map((r) => r.lastChild.previousSibling.textContent)).toEqual(["2", "1", "2"]);
    // Hovering truck 2's card lights up its rows.
    expect(rows.map((r) => r.classList.contains("lit"))).toEqual([true, false, true]);
    fireEvent.pointerOver(rows[1]);
    expect(onHover).toHaveBeenCalledWith(1);
  });
});

describe("TruckCard", () => {
  const truck = { truck: 3, load: 656, empty: 344, shipments: [
    { id: 0, name: "Steel 01", weight: 534, pallets: 1 },
    { id: 1, name: "Paint 02", weight: 122, pallets: 2, dg_class: "3" },
  ] };
  const props = { numTrucks: 4, deckAtLeast: 0, barHeight: 180, deckMaxHeight: 300, dropIndex: { 0: 0, 1: 1 },
    activeId: null, activeTruck: null, onHover: () => {}, onFocusBlock: () => {}, onHoverTruck: () => {} };

  it("names the truck, says what's left and lists what it carries", () => {
    render(<TruckCard truck={truck} capacity={{ weight_kg: 1000, pallets: 8 }} step={2} {...props} />);
    const card = screen.getByRole("article", { name: "Truck 3" });
    expect(card).toHaveTextContent("344 kg free · 5 spaces free");
    expect(card).toHaveTextContent("Steel 01");
    expect(card).toHaveTextContent("Paint 02");
    expect(within(card).getAllByRole("listitem", { hidden: false }).length).toBeGreaterThanOrEqual(2);
  });

  it("says Loading… while shipments are still dropping in", () => {
    render(<TruckCard truck={truck} capacity={1000} step={1} {...props} />);
    expect(screen.getByRole("article", { name: "Truck 3" })).toHaveTextContent("Loading…");
  });

  it("marks a truck that holds the highlighted shipment", () => {
    render(<TruckCard truck={truck} capacity={1000} step={2} {...props} activeId={1} />);
    expect(screen.getByRole("article", { name: "Truck 3" })).toHaveClass("holds-active");
  });
});
