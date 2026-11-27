import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import WarningsList from "./WarningsList.tsx";
import type { PlanWarning } from "../api/types.ts";
import { planMultidrop, planOverCapacity, planSuggest } from "../test/fixtures.ts";

const info: PlanWarning = {
  code: "ROUTE_RESTRICTED", severity: "info", message: "This vehicle is limited to approved routes.",
  suggestion: "", item_ids: [],
};

describe("WarningsList", () => {
  it("groups errors, then warnings, then info", () => {
    render(<WarningsList warnings={[...planOverCapacity.result.warnings, info]} request={planOverCapacity.request} />);
    const groups = screen.getAllByRole("heading", { level: 4 });
    expect(groups.map((h) => h.textContent)).toEqual(["Errors (1)", "Warnings (2)", "Information (1)"]);

    const items = screen.getAllByRole("listitem");
    expect(items.map((li) => li.dataset.code)).toEqual(
      ["OVER_CAPACITY", "REEFER_ON_NON_REEFER", "AXLE_NEAR_LIMIT", "ROUTE_RESTRICTED"]);
    expect(items[0]).toHaveTextContent(/^Error: Over by 1 pallet/);
    expect(items[1]).toHaveTextContent(/^Warning: Temperature-controlled/);
    expect(items[3]).toHaveTextContent(/^Info: This vehicle/);
    const header = screen.getByRole("heading", { level: 3, name: "Warnings" }).parentElement!;
    expect(header).toHaveTextContent("1 error2 warnings1 note");
  });

  it("shows the suggestion as 'Try: ...' and names the freight lines by label", () => {
    render(<WarningsList warnings={planOverCapacity.result.warnings} request={planOverCapacity.request} />);
    const error = screen.getAllByRole("listitem")[0];
    // The planner's suggestion already starts with "Try", so no "Try:" prefix is added.
    expect(within(error).getByText("Try a B-double or split into 2 loads.")).toBeInTheDocument();
    expect(within(screen.getAllByRole("listitem")[1]).getByText("Try: Use a refrigerated pantech (reefer) to keep it cold."))
      .toBeInTheDocument();
    expect(error).toHaveTextContent("Freight line: Chilled");

    const axle = screen.getAllByRole("listitem")[2];
    // In the order the lines were entered, not the order the planner listed them.
    expect(axle).toHaveTextContent("Freight lines: General, Chilled");
  });

  it("falls back to the item id when a line has no label", () => {
    const request = { ...planMultidrop.request, items: planMultidrop.request.items.map((it) => ({ ...it, label: "" })) };
    render(<WarningsList warnings={planMultidrop.result.warnings} request={request} />);
    expect(screen.getByText(/Freight lines:/)).toHaveTextContent("Freight lines: bev, dry, euro, hw");
  });

  it("leaves out the suggestion when there is none", () => {
    render(<WarningsList warnings={[info]} request={planSuggest.request} />);
    expect(screen.queryByText(/^Try:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Freight line/)).not.toBeInTheDocument();
  });

  it("says so when there are no warnings", () => {
    render(<WarningsList warnings={planSuggest.result.warnings} request={planSuggest.request} />);
    expect(screen.getByText("No warnings: the plan is within every limit we check.")).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });
});
