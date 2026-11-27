// The DG picker in a freight line's form (FreightTable + HazardPicker).
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeAll, describe, expect, it } from "vitest";
import { normalise, type DgClass } from "../../dg/rules.ts";
import { newRow, validateRows, type FreightRow } from "../lib/freight.ts";
import { reference } from "../test/fixtures.ts";
import FreightTable from "./FreightTable.tsx";

// jsdom has no <dialog> methods: open/close it by the attribute, and Escape cancels as a browser does.
beforeAll(() => {
  const proto = HTMLDialogElement.prototype as HTMLDialogElement & { _esc?: boolean };
  proto.showModal = function (this: HTMLDialogElement & { _esc?: boolean }) {
    this.setAttribute("open", "");
    if (!this._esc) {
      this._esc = true;
      this.addEventListener("keydown", (e) => { if (e.key === "Escape") this.close(); });
    }
  };
  proto.close = function (this: HTMLDialogElement) {
    if (!this.hasAttribute("open")) return;
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
});

const store: { rows: FreightRow[] } = { rows: [] };
const dg = (dg_class: DgClass) => normalise({ dg_class, t92: [], container: "package" });

function Harness({ initial }: { initial: FreightRow[] }) {
  const [rows, setRows] = useState(initial);
  const v = validateRows(rows, reference);
  return <FreightTable reference={reference} rows={rows} errors={v.errors} listErrors={v.listErrors}
                       onRowsChange={(next) => { store.rows = next; setRows(next); }} />;
}

const setup = (initial: FreightRow[]) => {
  store.rows = initial;
  const user = userEvent.setup();
  render(<Harness initial={initial} />);
  return user;
};

const line = (n: number) => screen.getByRole("listitem", { name: new RegExp(`^line ${n}\\b`, "i") });
const toggle = (n: number) => within(line(n)).getByRole("button", { name: new RegExp(`^line ${n}\\b`, "i") });
const chip = () => screen.getByRole("button", { name: /^Dangerous goods for/ });
const dialog = () => screen.getByRole("dialog", { name: "Dangerous goods" });
const tile = (code: string) => within(dialog()).getByRole("radio", { name: new RegExp(`^${code.replace(".", "\\.")}\\b`) });

/** Open line `n`, then its DG picker. */
async function openPicker(user: ReturnType<typeof userEvent.setup>, n = 1) {
  await user.click(toggle(n));
  await user.click(chip());
  return dialog();
}

describe("Dangerous goods in the freight line form", () => {
  it("picks a class: the row gets DG data that validateRows accepts", async () => {
    const user = setup([newRow(reference, { label: "Paint" })]);
    await user.click(toggle(1));
    expect(chip()).toHaveAccessibleName("Dangerous goods for Paint: Not dangerous goods. Change");
    await user.click(chip());
    await user.click(tile("3"));
    expect(within(dialog()).getByText("Class 3")).toBeInTheDocument(); // the live preview
    await user.click(within(dialog()).getByRole("button", { name: "Done" }));

    expect(store.rows[0].dg).toEqual(dg("3"));
    const v = validateRows(store.rows, reference);
    expect(v.errors).toEqual({});
    expect(v.items?.[0].dg).toEqual(dg("3"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(chip()).toHaveAccessibleName("Dangerous goods for Paint: Class 3. Change");
    // Closed, the row shows the read-only badge.
    await user.click(toggle(1));
    expect(line(1)).toHaveTextContent("Dangerous goods: Class 3");
  });

  it("adds a subsidiary hazard, keeping the line's other DG details", async () => {
    const acid = normalise({ dg_class: "8", un_number: "1789", packing_group: "II", container: "drum", t92: ["acid_strong"] })!;
    const user = setup([newRow(reference, { label: "Acid", dg: acid })]);
    await openPicker(user);
    expect(within(dialog()).queryByRole("checkbox", { name: /^8 Corrosive/ })).not.toBeInTheDocument(); // not the class itself
    await user.click(within(dialog()).getByRole("checkbox", { name: /^6\.1 Toxic/ }));
    await user.click(within(dialog()).getByRole("button", { name: "Done" }));

    expect(store.rows[0].dg).toEqual({ ...acid, subsidiary: ["6.1"] });
    expect(validateRows(store.rows, reference).errors).toEqual({});
    expect(chip()).toHaveAccessibleName("Dangerous goods for Acid: Class 8 (sub 6.1). Change");
  });

  it("Cancel and Escape discard the edit and keep the line open", async () => {
    const user = setup([newRow(reference, { label: "Paint", dg: dg("3") })]);
    await openPicker(user);
    await user.click(tile("8"));
    await user.click(within(dialog()).getByRole("button", { name: "Cancel" }));
    expect(store.rows[0].dg).toEqual(dg("3"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(chip()).toHaveFocus();

    await user.click(chip());
    await user.click(tile("8"));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(store.rows[0].dg).toEqual(dg("3"));
    expect(toggle(1)).toHaveAttribute("aria-expanded", "true"); // only the dialog closed
  });

  it("lists the other lines it can't share a truck with", async () => {
    const user = setup([
      newRow(reference, { label: "Paint" }),
      newRow(reference, { label: "Pool chlorine", dg: dg("5.1") }),
      newRow(reference, { label: "Rice", dg: normalise({ food: true }) }),
      newRow(reference, { label: "Tiles" }),
    ]);
    await openPicker(user);
    expect(within(dialog()).getByText("General freight can share a truck with anything.")).toBeInTheDocument();
    await user.click(tile("3"));
    expect(within(dialog()).getByText("Can’t share a truck with 1 line:")).toBeInTheDocument();
    const list = within(dialog()).getByRole("list");
    expect(list).toHaveTextContent("Pool chlorine (Class 5.1)");
    await user.click(tile("8"));
    expect(within(dialog()).getByText("Can’t share a truck with 2 lines:")).toBeInTheDocument();
    expect(within(dialog()).getByRole("list")).toHaveTextContent("Rice (Food)");
    await user.click(tile("9"));
    expect(within(dialog()).getByText(/No conflicts with the other lines/)).toBeInTheDocument();
  });

  it("shows Northline's refusal; validateRows still sends the line, and the plan reports it", async () => {
    const user = setup([newRow(reference, { label: "Calcium carbide" })]);
    await openPicker(user);
    await user.click(tile("4.3"));
    expect(within(dialog()).getByRole("alert")).toHaveTextContent("Northline does not transport Division 4.3.");
    await user.click(within(dialog()).getByRole("button", { name: "Done" }));
    // As before for refused goods (e.g. from Random freight): the backend's DG_CARRIER_REFUSED says so.
    const v = validateRows(store.rows, reference);
    expect(v.errors).toEqual({});
    expect(v.items?.[0].dg?.dg_class).toBe("4.3");
  });

  it("shows a DG problem under the field, and picking a class can fix it", async () => {
    const user = setup([newRow(reference, { label: "Gas", dg: normalise({ dg_class: "2.1", packing_group: "II", t92: [] }) })]);
    await user.click(toggle(1));
    expect(within(line(1)).getAllByText("Class 2.1 has no packing groups.")).toHaveLength(1); // once, under the field
    expect(chip()).toHaveAccessibleDescription("Class 2.1 has no packing groups.");
    await user.click(chip());
    await user.click(tile("2.2"));
    await user.click(within(dialog()).getByRole("button", { name: "Done" }));
    expect(store.rows[0].dg).toMatchObject({ dg_class: "2.2", packing_group: null });
    expect(within(line(1)).queryByText("Class 2.1 has no packing groups.")).not.toBeInTheDocument();
  });
});
