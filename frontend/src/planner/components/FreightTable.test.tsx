import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { normalise, type DgClass } from "../../dg/rules.ts";
import { exampleRows, newLooseRow, newRow, validateRows, type FreightRow } from "../lib/freight.ts";
import { EXAMPLE_SECTIONS, exampleById } from "../../examples/shipmentExamples.ts";
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
/** The name button of a line: opens and closes its form. */
const toggle = (n: number) => within(line(n)).getByRole("button", { name: new RegExp(`^line ${n}\\b`, "i") });
const summary = (n: number) =>
  within(line(n)).getByTestId("freight-summary").textContent!.replace(/\u00a0/g, " ").trim();
/** Lines start closed: open line `n` to reach its fields. */
const openLine = (user: ReturnType<typeof userEvent.setup>, n: number) => user.click(toggle(n));

describe("FreightTable", () => {
  it("renders a closed summary row per line, with totals", () => {
    setup();
    expect(screen.getAllByRole("listitem", { name: /^line \d/i })).toHaveLength(3);
    expect(toggle(2)).toHaveAccessibleName("Line 2: Cartons");
    expect(toggle(2)).toHaveAttribute("aria-expanded", "false");
    expect(summary(1)).toBe("10 × Australian Standard pallet · 800 kg each · 1,200 mm high");
    expect(summary(2)).toBe("6 × Australian Standard pallet · 350 kg each · 900 mm high Stackable");
    expect(within(line(1)).getByTitle("Line weight")).toHaveTextContent("Line total: 8,000 kg");
    expect(screen.queryByLabelText("Label")).not.toBeInTheDocument(); // no form until a line is opened
    expect(screen.getByText(/18 pallets · 12,500 kg/)).toBeInTheDocument();
  });

  it("summarises loose items and containers, with their markers", () => {
    setup([
      newLooseRow(reference, { label: "Pipes", quantity: 3, gross_weight_kg: 600, length_mm: 6000, width_mm: 400,
                               height_mm: 300, stackable: true }),
      newRow(reference, { label: "Box", kind: "container", type_id: "HC40", quantity: 1, gross_weight_kg: 20000,
                          height_mm: null, temp_controlled: true }),
      newRow(reference, { label: "Paint", dg: dg("3"), temp_controlled: true }),
    ]);
    expect(summary(1)).toBe("3 × loose 6,000 × 400 × 300 mm · 600 kg each Stackable");
    expect(summary(2)).toBe("1 × 40' High cube container · 20,000 kg each Temp-controlled");
    expect(summary(3)).toBe(
      "1 × Australian Standard pallet · 500 kg each · 1,200 mm high Temp-controlled 3Dangerous goods: Class 3");
  });

  it("opens a line's form in place and closes it with Done, one line at a time", async () => {
    const user = setup();
    await openLine(user, 2);
    expect(toggle(2)).toHaveAttribute("aria-expanded", "true");
    expect(document.getElementById(toggle(2).getAttribute("aria-controls")!)).toBeVisible();
    expect(within(line(2)).getByLabelText("Label")).toHaveValue("Cartons");
    expect(within(line(2)).getByLabelText("Stackable")).toBeChecked();
    expect(summary(2)).toBe(""); // the form says it all

    await openLine(user, 1);
    expect(toggle(2)).toHaveAttribute("aria-expanded", "false");
    expect(screen.getAllByLabelText("Label")).toHaveLength(1);

    await user.click(within(line(1)).getByRole("button", { name: "Done editing line 1" }));
    expect(toggle(1)).toHaveAttribute("aria-expanded", "false");
    expect(toggle(1)).toHaveFocus();
    expect(screen.queryByLabelText("Label")).not.toBeInTheDocument();
  });

  it("opens with Enter on the name button and closes with Escape, keeping focus on the line", async () => {
    const user = setup();
    toggle(3).focus();
    await user.keyboard("{Enter}");
    expect(toggle(3)).toHaveAttribute("aria-expanded", "true");
    await user.click(within(line(3)).getByLabelText("Quantity"));
    await user.keyboard("{Escape}");
    expect(toggle(3)).toHaveAttribute("aria-expanded", "false");
    expect(toggle(3)).toHaveFocus();
  });

  it("opens a line from a click on its summary", async () => {
    const user = setup();
    await user.click(within(line(1)).getByTestId("freight-summary"));
    expect(toggle(1)).toHaveAttribute("aria-expanded", "true");
  });

  it("keeps a closed line's problems in view, in words", async () => {
    const user = setup([
      newRow(reference, { label: "Heavy", gross_weight_kg: null }),
      newRow(reference, { label: "Fine" }),
    ]);
    const problems = within(line(1)).getByRole("list", { name: "Problems with line 1" });
    expect(problems).toHaveTextContent("Enter the weight of one pallet in kg.");
    expect(line(1)).toHaveClass("ft-row-invalid");
    expect(summary(1)).toBe("1 × Australian Standard pallet · ? each · 1,200 mm high");
    expect(within(line(2)).queryByRole("list")).not.toBeInTheDocument();
    expect(line(2)).not.toHaveClass("ft-row-invalid");

    // Open: the field carries the message instead.
    await openLine(user, 1);
    expect(within(line(1)).queryByRole("list", { name: "Problems with line 1" })).not.toBeInTheDocument();
    expect(within(line(1)).getByLabelText("Weight per unit (kg)")).toHaveAccessibleDescription("Enter the weight of one pallet in kg.");
  });

  it("edits the quantity", async () => {
    const user = setup();
    await openLine(user, 1);
    const qty = within(line(1)).getByLabelText("Quantity");
    await user.clear(qty);
    await user.type(qty, "12");
    expect(store.rows[0].quantity).toBe(12);
    expect(qty).toHaveValue(12);
  });

  it("switches the type options with the kind", async () => {
    const user = setup();
    await openLine(user, 1);
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
    await openLine(user, 1);
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
    await openLine(user, 1);
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
    expect(toggle(1)).toHaveAttribute("aria-expanded", "false"); // a preset line is complete: it stays closed
    await openLine(user, 1);
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
    await openLine(user, 1);
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
    expect(toggle(1)).toHaveAttribute("aria-expanded", "true"); // a new line opens, ready to fill in
    expect(within(line(1)).getByLabelText("Label")).toHaveFocus();
  });

  it("opens only the new line on Add line", async () => {
    const user = setup();
    await openLine(user, 1);
    await user.click(screen.getByRole("button", { name: "Add line" }));
    expect(toggle(1)).toHaveAttribute("aria-expanded", "false");
    expect(toggle(4)).toHaveAttribute("aria-expanded", "true");
    expect(within(line(4)).getByLabelText("Label")).toHaveFocus();
  });

  it("shows the quick-add presets as short chips in one wrapping group, named in full", () => {
    setup();
    const group = screen.getByRole("group", { name: "Quick add" });
    const chips = within(group).getAllByRole("button");
    expect(chips.map((c) => c.textContent)).toEqual([
      "10 × AU pallets", "22 × AU pallets", "6 × Euro pallets", "4 × 6 m pipe bundles", "1 × 40' HC", "2 × 20' GP",
    ]);
    expect(chips[0]).toHaveAccessibleName("10 × AU pallets, 800 kg");
    expect(chips.every((c) => c.parentElement?.classList.contains("ft-presets-list"))).toBe(true);
    // Each chip's name starts with what it shows, so speaking the visible text activates it.
    for (const c of chips) expect(c.getAttribute("aria-label")!.startsWith(c.textContent!)).toBe(true);
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
    expect(screen.queryByRole("button", { expanded: true })).not.toBeInTheDocument(); // every random line stays closed
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

describe("FreightTable: example shipments", () => {
  const select = () => screen.getByRole("combobox", { name: "Example shipments" });

  it("lists the examples by section", () => {
    setup();
    const groups = within(select()).getAllByRole("group");
    expect(groups.map((g) => g.getAttribute("label"))).toEqual(EXAMPLE_SECTIONS.map((s) => s.name));
    expect(within(groups[0]).getAllByRole("option").map((o) => o.textContent))
      .toEqual(EXAMPLE_SECTIONS[0].examples.map((e) => e.title));
  });

  it("replaces the list with the example's lines, with undo", async () => {
    const user = setup();
    const before = labels();
    await user.selectOptions(select(), "hardware-store");
    const example = exampleById("hardware-store")!;
    expect(labels()).toEqual(example.lines.map((l) => l.name));
    expect(store.rows.map((r) => r.quantity)).toEqual(example.lines.map((l) => l.count));
    expect(store.rows.map((r) => r.dg?.dg_class ?? null)).toEqual(example.lines.map((l) => l.dgClass));
    const status = screen.getAllByRole("status").find((s) => s.textContent?.includes("example"))!;
    expect(status).toHaveTextContent("Replaced the list with the “Hardware store” example.");
    await user.click(within(status).getByRole("button", { name: "Undo" }));
    expect(labels()).toEqual(before);
  });

  it("hands the example and its rows to onExample, and shows the caption while exampleId is set", async () => {
    const user = userEvent.setup();
    const onExample = vi.fn();
    const onRowsChange = vi.fn();
    const rows = rowsFixture();
    const { rerender } = render(
      <FreightTable reference={reference} rows={rows} onRowsChange={onRowsChange} errors={{}} listErrors={[]}
                    exampleId="" onExample={onExample} />);
    expect(screen.queryByText(/Heavy pallets/)).not.toBeInTheDocument();
    await user.selectOptions(select(), "cement-tiles");
    expect(onRowsChange).not.toHaveBeenCalled();
    expect(onExample).toHaveBeenCalledWith(exampleById("cement-tiles"), expect.any(Array));
    const sent: FreightRow[] = onExample.mock.calls[0][1];
    const expected = exampleRows(exampleById("cement-tiles")!, reference);
    expect(sent.map((r) => [r.label, r.quantity])).toEqual(expected.map((r) => [r.label, r.quantity]));

    rerender(
      <FreightTable reference={reference} rows={sent} onRowsChange={onRowsChange} errors={{}} listErrors={[]}
                    exampleId="cement-tiles" onExample={onExample} />);
    expect(select()).toHaveValue("cement-tiles");
    const note = screen.getByText(/Heavy pallets/);
    expect(note).toHaveTextContent(`Cement & tiles: ${exampleById("cement-tiles")!.shows}`);
  });
});

describe("FreightTable: paste weights", () => {
  const open = (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByRole("button", { name: "Paste weights…" }));
  const box = () => screen.getByRole("textbox", { name: /Weights in kg/ });

  it("counts the weights and lists what it skips", async () => {
    const user = setup();
    await open(user);
    await user.type(box(), "560, 490 abc 0");
    expect(screen.getByText(/2 weights found/)).toBeInTheDocument();
    expect(screen.getByText(/Skipping these entries/)).toHaveTextContent('"abc", "0"');
  });

  it("adds a numbered AU pallet line per weight, with undo", async () => {
    const user = setup();
    const before = labels();
    await open(user);
    await user.type(box(), "560, 490");
    await user.click(screen.getByRole("button", { name: "Add to list" }));
    expect(labels()).toEqual([...before, "General freight 04", "General freight 05"]);
    expect(store.rows.slice(3).map((r) => [r.type_id, r.quantity, r.gross_weight_kg, r.height_mm, r.stackable]))
      .toEqual([["AU_STD", 1, 560, 1200, false], ["AU_STD", 1, 490, 1200, false]]);
    expect(screen.queryByRole("textbox", { name: /Weights in kg/ })).not.toBeInTheDocument();
    const status = screen.getAllByRole("status").find((s) => s.textContent?.includes("pasted"))!;
    expect(status).toHaveTextContent("Added 2 pasted weights.");
    await user.click(within(status).getByRole("button", { name: "Undo" }));
    expect(labels()).toEqual(before);
  });

  it("replaces the list, and Cancel leaves it alone", async () => {
    const user = setup();
    const before = labels();
    await open(user);
    await user.type(box(), "700");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(labels()).toEqual(before);
    await open(user);
    expect(box()).toHaveValue("");
    await user.type(box(), "700 800");
    await user.click(screen.getByRole("button", { name: "Replace list" }));
    expect(labels()).toEqual(["General freight 01", "General freight 02"]);
  });

  it("keeps within the units one plan takes", async () => {
    const user = setup([200, 200, 99].map((quantity) => newRow(reference, { quantity }))); // 499 units
    await open(user);
    fireEvent.change(box(), { target: { value: "500 600 700" } });
    expect(screen.getByText(/Adding keeps the first 1\b/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add to list" }));
    expect(store.rows).toHaveLength(4);
    expect(validateRows(store.rows, reference).listErrors).toEqual([]);
  });
});
