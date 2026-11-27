import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import ExportMenu from "./ExportMenu.tsx";
import { planMultidrop, reference } from "../test/fixtures.ts";

const original = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };

afterEach(() => {
  Object.assign(URL, { createObjectURL: original.create, revokeObjectURL: original.revoke });
});

describe("ExportMenu", () => {
  it("downloads the plan as a CSV file through an object URL", async () => {
    const create = vi.fn((_blob: Blob) => "blob:load-plan");
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    render(<ExportMenu result={planMultidrop.result} request={planMultidrop.request} reference={reference} />);
    await userEvent.click(screen.getByRole("button", { name: "Download CSV" }));

    expect(create).toHaveBeenCalledOnce();
    const blob = create.mock.calls[0][0];
    expect(blob.type).toBe("text/csv;charset=utf-8");
    const text = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.readAsText(blob);
    });
    expect(text).toContain("Semi-trailer (13.7 m class)");
    expect(click).toHaveBeenCalledOnce();
    const link = click.mock.contexts[0] as HTMLAnchorElement;
    expect(link.download).toMatch(/^load-plan-SEMI_TRAILER-\d{4}-\d{2}-\d{2}\.csv$/);
  });

  it("opens the print dialog", async () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    render(<ExportMenu result={planMultidrop.result} request={planMultidrop.request} reference={reference} />);
    await userEvent.click(screen.getByRole("button", { name: "Print / PDF" }));
    expect(print).toHaveBeenCalledOnce();
  });

  it("is hidden from print", () => {
    render(<ExportMenu result={planMultidrop.result} request={planMultidrop.request} reference={reference} />);
    expect(screen.getByRole("group", { name: "Export the load plan" })).toHaveClass("no-print");
  });
});
