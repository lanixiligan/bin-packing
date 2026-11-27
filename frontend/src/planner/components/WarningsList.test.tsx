import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import WarningsList from "./WarningsList.tsx";
import type { PlanWarning } from "../api/types.ts";
import { planOverCapacity, planSuggest } from "../test/fixtures.ts";

// The planner's over-capacity sample, plus a hand-written axle note naming both lines, so the tests
// don't depend on how the planner happens to balance the sample.
const axleNear: PlanWarning = {
  code: "AXLE_NEAR_LIMIT", severity: "warning", message: "The drive tandem is at 92 % of its GML limit.",
  suggestion: "It fits, but this is an estimate: leave margin.", item_ids: ["chill", "gen"],
};
const overCapacity = [...planOverCapacity.result.warnings.filter((w) => w.code !== "AXLE_NEAR_LIMIT"), axleNear];

const info: PlanWarning = {
  code: "ROUTE_RESTRICTED", severity: "info", message: "This vehicle is limited to approved routes.",
  suggestion: "", item_ids: [],
};

describe("WarningsList", () => {
  it("groups errors, then warnings, then info", () => {
    render(<WarningsList warnings={[...overCapacity, info]} request={planOverCapacity.request} />);
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
    render(<WarningsList warnings={overCapacity} request={planOverCapacity.request} />);
    const error = screen.getAllByRole("listitem")[0];
    // The planner's suggestion already starts with "Try", so no "Try:" prefix is added.
    expect(within(error).getByText("Try a B-double or split into 2 loads.")).toBeInTheDocument();
    expect(within(screen.getAllByRole("listitem")[1]).getByText("Try: Use a refrigerated pantech (reefer) to keep it cold."))
      .toBeInTheDocument();
    expect(error).toHaveTextContent("Line: Chilled");

    const axle = screen.getAllByRole("listitem")[2];
    // In the order the lines were entered, not the order the planner listed them.
    expect(axle).toHaveTextContent("Lines: General, Chilled");
  });

  it("falls back to the item id when a line has no label", () => {
    const request = { ...planOverCapacity.request, items: planOverCapacity.request.items.map((it) => ({ ...it, label: "" })) };
    render(<WarningsList warnings={[axleNear]} request={request} />);
    expect(screen.getByText(/^Lines:/)).toHaveTextContent("Lines: gen, chill");
  });

  it("leaves out the suggestion when there is none", () => {
    render(<WarningsList warnings={[info]} request={planSuggest.request} />);
    expect(screen.queryByText(/^Try:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Lines?:/)).not.toBeInTheDocument();
  });

  it("says so when there are no warnings", () => {
    render(<WarningsList warnings={planSuggest.result.warnings} request={planSuggest.request} />);
    expect(screen.getByText("No warnings: the plan is within every limit we check.")).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });
});
