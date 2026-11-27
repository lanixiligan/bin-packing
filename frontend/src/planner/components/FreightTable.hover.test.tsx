// The freight table's side of the hover link with the load plan (closed rows only).
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { sampleRows } from "../lib/freight.ts";
import { reference } from "../test/fixtures.ts";
import FreightTable from "./FreightTable.tsx";

const rows = sampleRows(reference);
const rowEl = (id: string) => document.querySelector<HTMLElement>(`li[data-row-id="${id}"]`)!;

describe("FreightTable hover link", () => {
  it("reports the line under the pointer or with focus, and highlights lit lines", async () => {
    const onLineHover = vi.fn();
    const onLineFocus = vi.fn();
    const { rerender } = render(<FreightTable reference={reference} rows={rows} onRowsChange={() => {}} errors={{}} listErrors={[]}
                                              onLineHover={onLineHover} onLineFocus={onLineFocus} />);
    fireEvent.pointerEnter(rowEl(rows[1].id));
    expect(onLineHover).toHaveBeenLastCalledWith(rows[1].id);
    fireEvent.pointerLeave(rowEl(rows[1].id));
    expect(onLineHover).toHaveBeenLastCalledWith(null);

    await userEvent.tab();
    expect(onLineFocus).toHaveBeenLastCalledWith(rows[0].id);

    rerender(<FreightTable reference={reference} rows={rows} onRowsChange={() => {}} errors={{}} listErrors={[]}
                           litIds={[rows[1].id]} />);
    expect(rowEl(rows[1].id)).toHaveClass("ft-row-lit");
    expect(rowEl(rows[0].id)).not.toHaveClass("ft-row-lit");
    expect(screen.getAllByRole("listitem").filter((li) => li.classList.contains("ft-row-lit"))).toHaveLength(1);
  });
});
