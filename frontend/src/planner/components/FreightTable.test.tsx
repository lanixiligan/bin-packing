import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { normalise, type DgClass } from "../../dg/rules.ts";
import { newLooseRow, newRow, validateRows, type FreightRow } from "../lib/freight.ts";
import { randomFreight, seededRandom } from "../lib/randomFreight.ts";
import { reference } from "../test/fixtures.ts";
import FreightTable from "./FreightTable.tsx";

/** The rows the table last reported through onRowsChange. */
const store: { rows: FreightRow[] } = { rows: [] };

/** DG data for a class, as the random freight catalogue builds it. */
const dg = (dg_class: DgClass) => normalise({ dg_class, t92: [], container: "package" });

function Harness({ initial, random }: { initial: FreightRow[]; random?: () => number }) {
  const [rows, setRows] = useState(initial);
  const onRowsChange = (next: FreightRow[]) => {
    store.rows = next;
    setRows(next);
  };
  const v = validateRows(rows, reference);
  return <FreightTable reference={reference} rows={rows} onRowsChange={onRowsChange} errors={v.errors} listErrors={v.listErrors}
                       random={random} />;
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

  it("turns a line into a loose item from the type list and shows its size fields", async () => {
    const user = setup();
    const row = () => within(line(1));
    expect(row().queryByLabelText("Length (mm)")).not.toBeInTheDocument();
    await user.selectOptions(row().getByLabelText("Type"), "Loose item (enter size)");
    expect(store.rows[0]).toMatchObject({ kind: "loose", type_id: "LOOSE", length_mm: 3000, width_mm: 1000, height_mm: 1200 });
    expect(row().getByLabelText("Type")).toHaveDisplayValue("Loose item (enter size)");
    expect(row().getByLabelText("Length (mm)")).toHaveValue(3000);
    expect(row().getByLabelText("Width (mm)")).toHaveValue(1000);
    expect(row().getByLabelText("Height (mm)")).toHaveValue(1200);
    expect(row().getByLabelText("Stackable")).toBeInTheDocument();
    expect(screen.getByText(/8 pallets · 10 loose items · 12,500 kg/)).toBeInTheDocument();

    const length = row().getByLabelText("Length (mm)");
    await user.clear(length);
    await user.type(length, "6000");
    expect(store.rows[0].length_mm).toBe(6000);
    const item = validateRows(store.rows, reference).items![0];
    expect(item).toMatchObject({ kind: "loose", type_id: "LOOSE", length_mm: 6000, width_mm: 1000, height_mm: 1200 });

    // Back to a pallet type: the size fields go and the request drops the length and width.
    await user.selectOptions(row().getByLabelText("Type"), "EURO");
    expect(store.rows[0]).toMatchObject({ kind: "pallet", type_id: "EURO" });
    expect(row().queryByLabelText("Length (mm)")).not.toBeInTheDocument();
    expect(validateRows(store.rows, reference).items![0]).not.toHaveProperty("length_mm");
  });

  it("validates a loose item's size inline", async () => {
    const user = setup([newLooseRow(reference, { label: "Pipes" })]);
    const width = within(line(1)).getByLabelText("Width (mm)");
    expect(width).not.toHaveAttribute("aria-invalid");
    await user.clear(width);
    expect(width).toHaveAttribute("aria-invalid", "true");
    expect(width).toHaveAccessibleDescription("Enter the item's width in mm.");
    await user.type(width, "25000");
    expect(width).toHaveAccessibleDescription("That's 25 m; the width can be at most 20 m.");
    const height = within(line(1)).getByLabelText("Height (mm)");
    await user.clear(height);
    await user.type(height, "2400");
    expect(height).not.toHaveAttribute("aria-invalid");
  });

  it("offers a loose preset and keeps a loose line's size when it becomes a container and back", async () => {
    const user = setup([]);
    await user.click(screen.getByRole("button", { name: "4 × 6 m pipe bundles, 600 kg" }));
    expect(store.rows[0]).toMatchObject({ kind: "loose", type_id: "LOOSE", quantity: 4, length_mm: 6000, width_mm: 800 });
    expect(within(line(1)).getByRole("radio", { name: "Pallet" })).toBeChecked();
    await user.click(within(line(1)).getByRole("radio", { name: "Container" }));
    expect(store.rows[0].kind).toBe("container");
    expect(within(line(1)).queryByLabelText("Length (mm)")).not.toBeInTheDocument();
    expect(within(within(line(1)).getByLabelText("Type")).queryByRole("option", { name: /loose item/i })).not.toBeInTheDocument();
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

  it("replaces the rows with random freight, and Undo restores them", async () => {
    store.rows = rowsFixture();
    const user = userEvent.setup();
    render(<Harness initial={store.rows} random={seededRandom(3)} />);
    const before = labels();
    await user.click(screen.getByRole("button", { name: "Random freight" }));
    const expected = randomFreight(reference, { random: seededRandom(3) });
    expect(labels()).toEqual(expected.map((r) => r.label));
    expect(store.rows.map((r) => r.dg)).toEqual(expected.map((r) => r.dg));
    expect(screen.getAllByRole("listitem", { name: /^line \d/i })).toHaveLength(expected.length);
    const status = screen.getAllByRole("status").find((s) => s.textContent?.includes("random"))!;
    expect(status).toHaveTextContent(`Replaced the list with ${expected.length} random lines.`);
    await user.click(within(status).getByRole("button", { name: "Undo" }));
    expect(labels()).toEqual(before);
  });

  it("shows a read-only DG badge on DG rows and nothing on general freight", () => {
    setup([
      newRow(reference, { label: "Paint", dg: dg("3") }),
      newRow(reference, { label: "Rice", dg: normalise({ food: true }) }),
      newRow(reference, { label: "Timber" }),
    ]);
    expect(line(1)).toHaveTextContent("Dangerous goods: Class 3");
    expect(within(line(1)).getByTitle("Flammable liquid")).toHaveTextContent("3Dangerous goods: Class 3");
    expect(line(2)).toHaveTextContent("Dangerous goods: Food");
    expect(line(3)).not.toHaveTextContent(/dangerous goods/i);
    expect(within(line(1)).queryByRole("combobox", { name: /dangerous|class/i })).not.toBeInTheDocument();
  });

  it("warns early for Class 3 + 5.1 but not for Class 3 + 8", async () => {
    const user = setup([
      newRow(reference, { label: "Paint", dg: dg("3") }),
      newRow(reference, { label: "Battery acid", dg: dg("8") }),
    ]);
    expect(screen.queryByText(/can't share a vehicle/)).not.toBeInTheDocument();
    expect(screen.queryByText(/dangerous goods to check/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Duplicate line 1" }));
    expect(screen.queryByText(/can't share a vehicle/)).not.toBeInTheDocument();
  });

  it("shows the hint when a Class 5.1 line joins a Class 3 line", () => {
    setup([
      newRow(reference, { label: "Paint", dg: dg("3") }),
      newRow(reference, { label: "Pool chlorine", dg: dg("5.1") }),
    ]);
    const hint = screen.getAllByRole("status").find((s) => s.textContent?.includes("can't share a vehicle"))!;
    expect(hint).toHaveTextContent(
      "Paint (Class 3) and Pool chlorine (Class 5.1) can't travel on the same vehicle (ADG Table 9.1).");
  });

  it("names the incompatible pair in plain language", () => {
    setup([
      newRow(reference, { label: "Paint", dg: dg("3") }),
      newRow(reference, { label: "Timber" }),
      newRow(reference, { label: "", dg: dg("5.1") }),
    ]);
    expect(screen.getByText("Dangerous goods that can't share a vehicle")).toBeInTheDocument();
    expect(screen.getByText(
      "Paint (Class 3) and Line 3 (Class 5.1) can't travel on the same vehicle (ADG Table 9.1).")).toBeInTheDocument();
    expect(screen.getByText("The plan will show this as a problem.")).toBeInTheDocument();
  });

  it("gives a softer note when Table 9.2 goods aren't recorded", () => {
    setup([
      newRow(reference, { label: "Paint", dg: normalise({ dg_class: "3" }) }),
      newRow(reference, { label: "Pesticide", dg: dg("6.1") }),
    ]);
    expect(screen.getByText("Dangerous goods to check")).toBeInTheDocument();
    expect(screen.getByText(/Paint \(Class 3\) and Pesticide \(Class 6\.1\) may need a check against ADG Table 9\.2/))
      .toBeInTheDocument();
    expect(screen.queryByText(/can't share a vehicle/)).not.toBeInTheDocument();
  });

  it("has no CSV import or export", () => {
    setup();
    expect(screen.queryByRole("button", { name: /csv|import/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/csv/i)).not.toBeInTheDocument();
  });
});
