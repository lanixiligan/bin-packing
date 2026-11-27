import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import ShipmentTable from "./ShipmentTable.jsx";
import { MAX_SHIPMENTS } from "../shipments.js";

const pallet = (uid, name, weight, palletType = "AU_STD", heightMm = 1200, stackable = false, dgClass = null) =>
  ({ uid, name, weight, kind: "pallet", palletType, heightMm, stackable, dgClass, subsidiary: [] });
const loose = (uid, name, weight, lengthMm, widthMm, heightMm) =>
  ({ uid, name, weight, kind: "loose", lengthMm, widthMm, heightMm, stackable: false, dgClass: null, subsidiary: [] });
const list = [
  pallet(101, "Steel 01", 534),
  pallet(102, "Paint 02", 422, "AU_STD", 1200, true, "3"),
  pallet(103, "Glass 03", 600, "EURO", 1600, false, "food"),
  loose(104, "Pipes 04", 250, 4600, 400, 300),
];
const RIGID = { payloadKg: 8000, decks: [{ id: "body", name: "Body", length_mm: 4800, width_mm: 2400, height_mm: 2700 }] };

function Harness({ initial = list, ...props }) {
  const [shipments, setShipments] = useState(initial);
  return <ShipmentTable shipments={shipments} fit={RIGID} onChange={setShipments} {...props} />;
}

const bodyRows = () => within(screen.getByRole("table")).getAllByRole("row").slice(1);

describe("ShipmentTable", () => {
  it("shows one read-only line per shipment: size, kg, whether it stacks, DG", () => {
    render(<Harness />);
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent))
      .toEqual(["Shipment", "kg", "Stack", "DG", "Remove"]);
    const rows = bodyRows();
    expect(rows).toHaveLength(4);
    const cells = (r) => within(r).getAllByRole("cell");
    // The size sits under the name, in the first cell.
    expect(cells(rows[0])[0]).toHaveTextContent("AU · 1.2 m");
    expect(cells(rows[0])[0]).toHaveTextContent("AU pallet, 1.2 m high");
    expect(cells(rows[0])[1]).toHaveTextContent("534");
    expect(cells(rows[2])[0]).toHaveTextContent("Euro · 1.6 m");
    expect(cells(rows[3])[0]).toHaveTextContent("4.6 × 0.4 × 0.3 m");
    expect(within(rows[1]).getByRole("img", { name: "Stackable" })).toBeInTheDocument();
    expect(within(rows[0]).getByRole("img", { name: "Not stackable" })).toBeInTheDocument();
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
    await user.click(screen.getByRole("checkbox", { name: "Paint 02 stacks" }));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("spinbutton", { name: /Weight of/ })).not.toBeInTheDocument();
    expect(bodyRows()[1]).toHaveTextContent(/Paint 02.*250/);
    expect(within(bodyRows()[1]).getByRole("img", { name: "Not stackable" })).toBeInTheDocument();
    await new Promise((r) => requestAnimationFrame(r));
    expect(screen.getByRole("button", { name: "Edit Paint 02" })).toHaveFocus();
  });

  it("turns a pallet into a loose item with its own length and width", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Edit Steel 01" }));
    expect(screen.queryByRole("spinbutton", { name: /Length of/ })).not.toBeInTheDocument();
    await user.selectOptions(screen.getByRole("combobox", { name: "Pallet type of Steel 01, or loose" }), "loose");
    const length = screen.getByRole("spinbutton", { name: "Length of Steel 01 in mm" });
    const width = screen.getByRole("spinbutton", { name: "Width of Steel 01 in mm" });
    expect(length).toHaveValue(1165); // starts from the pallet's footprint
    await user.clear(length);
    await user.type(length, "3000");
    await user.clear(width);
    await user.type(width, "500");
    const height = screen.getByRole("spinbutton", { name: "Height of Steel 01 in mm" });
    await user.clear(height);
    await user.type(height, "300");
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(within(bodyRows()[0]).getAllByRole("cell")[0]).toHaveTextContent("3.0 × 0.5 × 0.3 m");
  });

  it("flags shipments that can never go on the vehicle", () => {
    render(<Harness initial={[
      loose(101, "Pipes 01", 300, 6000, 400, 300),
      pallet(102, "Tyres 02", 300, "AU_STD", 2800),
      pallet(103, "Steel 03", 9000),
      pallet(104, "Books 04", 500),
    ]} />);
    expect(screen.getByRole("button", { name: "Edit Pipes 01" }))
      .toHaveAccessibleDescription("Too long or wide for the 4.8 × 2.4 m deck, even turned.");
    expect(screen.getByRole("button", { name: "Edit Tyres 02" }))
      .toHaveAccessibleDescription("Taller than the 2.7 m inside height.");
    expect(screen.getByRole("button", { name: "Edit Steel 03" }))
      .toHaveAccessibleDescription("Heavier than the 8,000 kg payload.");
    expect(screen.getByRole("button", { name: "Edit Books 04" })).not.toHaveAttribute("aria-describedby");
    const cells = within(screen.getByRole("button", { name: "Edit Pipes 01" }).closest("tr")).getAllByRole("cell");
    expect(cells[0].querySelector(".name-size")).toHaveClass("bad"); // the size
    expect(cells[1]).not.toHaveClass("bad"); // the weight
  });

  it("checks nothing against the vehicle until it is known", () => {
    render(<Harness fit={null} initial={[loose(101, "Pipes 01", 300, 15000, 400, 300)]} />);
    expect(screen.getByRole("button", { name: "Edit Pipes 01" })).not.toHaveAttribute("aria-describedby");
  });

  it("adds a shipment, filling in the DG class and size of a catalogue item", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(screen.getByRole("combobox", { name: "New shipment name" }), "Methanol");
    expect(screen.getByRole("combobox", { name: "New shipment pallet type, or loose" })).toHaveValue("AU_STD");
    expect(screen.getByRole("spinbutton", { name: "New shipment height in mm" })).toHaveValue(1300);
    await user.type(screen.getByRole("spinbutton", { name: "New shipment weight in kg" }), "150");
    await user.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.getByRole("button", { name: "Edit Methanol" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Dangerous goods for Methanol: Class 3 \(sub 6\.1\)/ })).toBeInTheDocument();
    expect(bodyRows()[4]).toHaveTextContent("AU · 1.3 m");
  });

  it("adds a loose catalogue item at a length that fits the deck", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(screen.getByRole("combobox", { name: "New shipment name" }), "Pipes");
    expect(screen.getByRole("combobox", { name: "New shipment pallet type, or loose" })).toHaveValue("loose");
    expect(screen.getByRole("spinbutton", { name: "New shipment length in mm" })).toHaveValue(4600);
    await user.type(screen.getByRole("spinbutton", { name: "New shipment weight in kg" }), "200");
    await user.click(screen.getByRole("button", { name: "Add" }));
    expect(within(bodyRows()[4]).getAllByRole("cell")[0]).toHaveTextContent("4.6 × 0.4 × 0.3 m");
  });

  it(`stops adding at ${MAX_SHIPMENTS} shipments`, () => {
    const full = Array.from({ length: MAX_SHIPMENTS }, (_, i) => pallet(200 + i, `Books ${i + 1}`, 100));
    render(<Harness initial={full} />);
    expect(screen.getByRole("button", { name: "Add" })).toBeDisabled();
    expect(screen.getByRole("form", { name: "Add a shipment" }))
      .toHaveAccessibleDescription(`${MAX_SHIPMENTS} shipments is the most one solve takes. Remove one to add another.`);
  });

  it("after solving, shows each shipment's truck and reports hover by row", () => {
    const onHover = vi.fn();
    render(<Harness placement={{ 0: { truck: 2 }, 1: { truck: 1 }, 2: { truck: 2 }, 3: { truck: 1 } }} activeTruck={2} onHover={onHover} />);
    expect(screen.getByRole("columnheader", { name: "Truck" })).toBeInTheDocument();
    const rows = bodyRows();
    expect(rows.map((r) => r.lastChild.previousSibling.textContent)).toEqual(["2", "1", "2", "1"]);
    // Hovering truck 2's card lights up its rows.
    expect(rows.map((r) => r.classList.contains("lit"))).toEqual([true, false, true, false]);
    fireEvent.pointerOver(rows[1]);
    expect(onHover).toHaveBeenCalledWith([1]);
  });

  it("lights up the rows of a hovered stack", () => {
    render(<Harness placement={{ 0: { truck: 1 }, 1: { truck: 1 }, 2: { truck: 1 }, 3: { truck: 1 } }} activeIds={[0, 1]} />);
    expect(bodyRows().map((r) => r.classList.contains("lit"))).toEqual([true, true, false, false]);
  });
});
