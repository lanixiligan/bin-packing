import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { newRow, validateRows, type FreightRow } from "../lib/freight.ts";
import { reference } from "../test/fixtures.ts";
import FreightTable from "./FreightTable.tsx";

/** The rows the table last reported through onRowsChange. */
const store: { rows: FreightRow[] } = { rows: [] };

function Harness({ initial }: { initial: FreightRow[] }) {
  const [rows, setRows] = useState(initial);
  const onRowsChange = (next: FreightRow[]) => {
    store.rows = next;
    setRows(next);
  };
  const v = validateRows(rows, reference);
  return <FreightTable reference={reference} rows={rows} onRowsChange={onRowsChange} errors={v.errors} listErrors={v.listErrors} />;
}

const rowsFixture = () => [
  newRow(reference, { label: "General", quantity: 10, gross_weight_kg: 800 }),
  newRow(reference, { label: "Cartons", quantity: 6, gross_weight_kg: 350, height_mm: 900, stackable: true }),
  newRow(reference, { label: "Steel", quantity: 2, gross_weight_kg: 1200 }),
];

const setup = (initial: FreightRow[] = rowsFixture()) => {
  store.rows = initial;
  const user = userEvent.setup();
  render(<Harness initial={initial} />);
  return user;
};

const line = (n: number) => screen.getByRole("listitem", { name: new RegExp(`^line ${n}\\b`, "i") });
const labels = () => store.rows.map((r) => r.label);

describe("FreightTable", () => {
  it("renders a labelled card per row with totals", () => {
    setup();
    expect(screen.getAllByRole("listitem", { name: /^line \d/i })).toHaveLength(3);
    expect(within(line(2)).getByLabelText("Label")).toHaveValue("Cartons");
    expect(within(line(2)).getByLabelText("Stackable")).toBeChecked();
    expect(within(line(1)).getByLabelText("Stop (1 = first drop)")).toHaveValue(null);
    expect(screen.getByText(/18 pallets · 12,500 kg/)).toBeInTheDocument();
  });

  it("edits the quantity", async () => {
    const user = setup();
    const qty = within(line(1)).getByLabelText("Quantity");
    await user.clear(qty);
    await user.type(qty, "12");
    expect(store.rows[0].quantity).toBe(12);
    expect(qty).toHaveValue(12);
  });

  it("switches the type options with the kind", async () => {
    const user = setup();
    const type = within(line(1)).getByLabelText("Type");
    expect(within(type).getByRole("option", { name: /australian standard/i })).toBeInTheDocument();
    await user.click(within(line(1)).getByRole("radio", { name: "Container" }));
    expect(store.rows[0]).toMatchObject({ kind: "container", type_id: "GP20" });
    const options = within(within(line(1)).getByLabelText("Type")).getAllByRole("option").map((o) => o.textContent);
    expect(options).toContain("40' High cube");
    expect(options).not.toContain(expect.stringMatching(/australian/i));
    expect(within(line(1)).queryByLabelText("Height (mm)")).not.toBeInTheDocument();
    expect(within(line(1)).queryByLabelText("Stackable")).not.toBeInTheDocument();
  });

  it("duplicates a row right after it, with a new id", async () => {
    const user = setup();
    await user.click(screen.getByRole("button", { name: "Duplicate line 2" }));
    expect(labels()).toEqual(["General", "Cartons", "Cartons", "Steel"]);
    expect(store.rows[2].id).not.toBe(store.rows[1].id);
    expect(store.rows[2]).toMatchObject({ quantity: 6, stackable: true });
  });

  it("deletes a row and Undo puts it back at the same index", async () => {
    const user = setup();
    const id = store.rows[1].id;
    await user.click(screen.getByRole("button", { name: "Delete line 2" }));
    expect(labels()).toEqual(["General", "Steel"]);
    const status = screen.getAllByRole("status").find((s) => s.textContent?.includes("Deleted"))!;
    expect(status).toHaveTextContent("Deleted “Cartons”.");
    await user.click(within(status).getByRole("button", { name: "Undo" }));
    expect(labels()).toEqual(["General", "Cartons", "Steel"]);
    expect(store.rows[1].id).toBe(id);
    expect(screen.queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();
  });

  it("hides the undo toast after a few seconds", () => {
    vi.useFakeTimers();
    try {
      setup();
      fireEvent.click(screen.getByRole("button", { name: "Delete line 1" }));
      expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument();
      act(() => { vi.advanceTimersByTime(6100); });
      expect(screen.queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("adds rows from a preset", async () => {
    const user = setup();
    await user.click(screen.getByRole("button", { name: "1 × 40' HC container, 20 t" }));
    expect(store.rows).toHaveLength(4);
    expect(store.rows[3]).toMatchObject({ kind: "container", type_id: "HC40", quantity: 1, gross_weight_kg: 20000 });
    await user.click(screen.getByRole("button", { name: "6 × Euro pallets, 500 kg" }));
    expect(store.rows[4]).toMatchObject({ kind: "pallet", type_id: "EURO", quantity: 6, gross_weight_kg: 500 });
  });

  it("shows an inline error with aria-invalid and aria-describedby", async () => {
    const user = setup();
    const height = within(line(1)).getByLabelText("Height (mm)");
    expect(height).not.toHaveAttribute("aria-invalid");
    await user.clear(height);
    await user.type(height, "2100");
    expect(height).toHaveAttribute("aria-invalid", "true");
    expect(height).toHaveAccessibleDescription("This pallet is 2.1 m tall; the max stack height is 1.8 m.");
  });

  it("shows the empty state and list errors, and adds a line", async () => {
    const user = setup([]);
    expect(screen.getByText("No freight yet: add a line or use a preset.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add line" }));
    expect(store.rows).toHaveLength(1);
    expect(within(line(1)).getByLabelText("Label")).toHaveFocus();
  });

  it("shows list-level errors above the rows", () => {
    const rows = [1, 2, 3].map(() => newRow(reference, { quantity: 200 }));
    setup(rows);
    expect(screen.getByText(/one plan takes at most 500/)).toBeInTheDocument();
  });

  it("adds rows from pasted CSV and reports a bad line", async () => {
    const user = setup();
    await user.click(screen.getByRole("button", { name: "Paste CSV" }));
    const panel = screen.getByRole("region", { name: "Import CSV" });
    const text = within(panel).getByLabelText("Paste CSV");
    await user.click(text);
    await user.paste("label,type,quantity,weight_kg,height_mm\nBoxes,EURO,4,300,1000\nBad,AU_STD,2,,1200\nBox,40hc,1,18000,");
    expect(within(panel).getByText("Line 3: weight is missing.")).toBeInTheDocument();
    expect(within(panel).getByRole("status")).toHaveTextContent("2 lines ready to add (5 units).");
    await user.click(within(panel).getByRole("button", { name: "Add 2 lines" }));
    expect(labels()).toEqual(["General", "Cartons", "Steel", "Boxes", "Box"]);
    expect(store.rows[4]).toMatchObject({ kind: "container", type_id: "HC40" });
    expect(screen.queryByRole("region", { name: "Import CSV" })).not.toBeInTheDocument();
    expect(screen.getByText(/added 2 lines from csv\. skipped 1 line with problems/i)).toBeInTheDocument();
  });

  it("replaces the list from an imported CSV file", async () => {
    const user = setup();
    const file = new File(["Pallets,pallet,AU_STD,5,600,1100,no,no,"], "freight.csv", { type: "text/csv" });
    await user.upload(screen.getByLabelText("Import a CSV file"), file);
    const panel = await screen.findByRole("region", { name: "Import CSV" });
    await user.click(within(panel).getByRole("radio", { name: "Replace" }));
    await user.click(within(panel).getByRole("button", { name: "Replace with 1 line" }));
    expect(labels()).toEqual(["Pallets"]);
  });
});
