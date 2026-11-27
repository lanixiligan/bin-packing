// The split-across-trucks flow in the page: the button, the fleet call, the truck tabs and the way back.
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Planner } from "./PlannerApp.tsx";
import {
  fleetSample, planBdoubleContainers, planDgConflict, planMultidrop, planOverCapacity, planSuggest, reference,
} from "./test/fixtures.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** Answers /api/plan with `plan` and /api/plan/fleet with `fleet` (a body, or a [body, status] pair). */
function mockApi({ plan = planDgConflict.result as unknown, fleet = fleetSample.result as unknown | [unknown, number] } = {}) {
  const spy = vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
    const url = String(input);
    if (url === "/api/plan/fleet") return Promise.resolve(Array.isArray(fleet) ? json(fleet[0], fleet[1]) : json(fleet));
    if (url === "/api/plan") return Promise.resolve(json(plan));
    return Promise.resolve(json(reference));
  });
  const calls = (url: string) => spy.mock.calls.filter(([u]) => String(u) === url);
  const body = (call: unknown[]) => JSON.parse(String((call[1] as RequestInit).body));
  return { spy, calls, body };
}

const splitButton = () => screen.findByRole("button", { name: "Split across trucks" });
const tabs = () => screen.getAllByRole("tab");
const panel = () => screen.getByRole("tabpanel");

/** Render the page, wait for the single-truck plan, click "Split across trucks" and wait for the tabs. */
async function split(api = mockApi()) {
  const user = userEvent.setup();
  render(<Planner initialReference={reference} />);
  await user.click(await splitButton());
  await screen.findByRole("tablist", { name: "Trucks" });
  return { user, ...api };
}

describe("Planner: split across trucks", () => {
  it("offers the split when one truck isn't enough, and not when the plan fits", async () => {
    mockApi({ plan: planOverCapacity.result });
    const { unmount } = render(<Planner initialReference={reference} />);
    expect(await splitButton()).toBeInTheDocument();
    unmount();

    mockApi({ plan: planMultidrop.result });
    render(<Planner initialReference={reference} />);
    await screen.findByText(/planned on the semi-trailer/i);
    expect(screen.queryByRole("button", { name: "Split across trucks" })).not.toBeInTheDocument();
  });

  it("calls /api/plan/fleet with the same request and shows the trucks as tabs", async () => {
    const { calls, body } = await split();
    expect(calls("/api/plan/fleet")).toHaveLength(1);
    const sent = body(calls("/api/plan/fleet")[0]);
    expect(sent).toEqual(body(calls("/api/plan")[0]));
    expect(sent).toMatchObject({ vehicle_id: "SEMI_TRAILER", rule_set: "northline" });
    expect(calls("/api/plan/fleet")[0][1]).toMatchObject({ method: "POST" });

    expect(screen.getByRole("heading", { name: "2 trucks · Proven fewest" })).toBeInTheDocument();
    expect(screen.getByText("Split across 2 × Medium rigid (8 t).")).toBeInTheDocument();
    expect(tabs().map((t) => t.textContent)).toEqual(["Truck 168 % of payload, fits", "Truck 245 % of payload, fits"]);
    expect(tabs()[0]).toHaveAttribute("aria-selected", "true");
    // The single-truck plan's DG clash is why: say so.
    expect(screen.getByRole("note")).toHaveTextContent(/can’t travel together are on separate trucks/);
    // The split button is gone while split.
    expect(screen.queryByRole("button", { name: "Split across trucks" })).not.toBeInTheDocument();
  });

  it("shows the selected truck with the usual panels, labelled by its tab", async () => {
    await split();
    expect(panel()).toHaveAccessibleName("Truck 1 68 % of payload, fits");
    expect(tabs()[0]).toHaveAttribute("aria-controls", panel().id);
    const view = within(panel());
    expect(view.getByRole("heading", { name: "Fits on the Medium rigid (8 t)" })).toBeInTheDocument();
    expect(view.getByTestId("load-plan-view")).toBeInTheDocument();
    expect(view.getByRole("heading", { name: /Estimated axle loads/ })).toBeInTheDocument();
    expect(view.getByText("5,400 kg")).toBeInTheDocument(); // truck 1's total weight
    expect(view.getByText(/This load carries dangerous goods \(Class 3\)/)).toBeInTheDocument();
    // Every truck is in the page (for print), but only the selected one is shown.
    expect(screen.getAllByRole("tabpanel", { hidden: true })).toHaveLength(2);
    expect(screen.getAllByRole("tabpanel")).toHaveLength(1);
  });

  it("switches trucks with the arrow keys, and the axle panel follows", async () => {
    const { user } = await split();
    const axles = () => within(panel()).getByRole("heading", { name: /Estimated axle loads/ }).closest("section")!;
    expect(axles()).toHaveTextContent("4,604 kg / 6,000 kg"); // truck 1 steer
    expect(axles()).toHaveTextContent("6,296 kg / 9,000 kg");

    tabs()[0].focus();
    await user.keyboard("{ArrowRight}");
    expect(tabs()[1]).toHaveAttribute("aria-selected", "true");
    expect(tabs()[1]).toHaveFocus();
    expect(panel()).toHaveAccessibleName("Truck 2 45 % of payload, fits");
    expect(axles()).toHaveTextContent("4,261 kg / 6,000 kg"); // truck 2 steer
    expect(axles()).toHaveTextContent("4,839 kg / 9,000 kg");
    expect(axles()).not.toHaveTextContent("6,296 kg");
    expect(within(panel()).getByText(/This load carries dangerous goods \(Class 5\.1\)/)).toBeInTheDocument();

    await user.keyboard("{ArrowRight}"); // wraps
    expect(tabs()[0]).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{End}");
    expect(panel()).toHaveAccessibleName(/^Truck 2/);
    await user.keyboard("{Home}");
    expect(axles()).toHaveTextContent("4,604 kg / 6,000 kg");
  });

  it("re-splits when the freight changes", async () => {
    const { user, calls, body } = await split();
    const plans = calls("/api/plan").length;
    const qty = screen.getAllByLabelText("Quantity")[0];
    await user.clear(qty);
    await user.type(qty, "7");
    await waitFor(() => expect(calls("/api/plan/fleet").length).toBeGreaterThanOrEqual(2));
    const sent = body(calls("/api/plan/fleet").at(-1)!);
    expect(sent.items[0].quantity).toBe(7);
    expect(calls("/api/plan")).toHaveLength(plans); // still split: no single-truck call
    expect(screen.getByRole("tablist", { name: "Trucks" })).toBeInTheDocument();
  });

  it("goes back to one truck", async () => {
    const { user, calls } = await split();
    const plans = calls("/api/plan").length;
    await user.click(screen.getByRole("button", { name: "Back to one truck" }));
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.queryByTestId("fleet-summary")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Doesn't fit: \d problems?/ })).toBeInTheDocument();
    expect(await splitButton()).toBeInTheDocument();
    await waitFor(() => expect(calls("/api/plan").length).toBe(plans + 1));
    await screen.findByText(/planned on the semi-trailer/i);
    expect(calls("/api/plan/fleet")).toHaveLength(1);
  });

  it("exports every truck in split mode", async () => {
    const create = vi.fn((_blob: Blob) => "blob:fleet");
    const original = { createObjectURL: URL.createObjectURL, revokeObjectURL: URL.revokeObjectURL };
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: vi.fn() });
    try {
      const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
      const { user } = await split();
      await user.click(screen.getByRole("button", { name: "Download CSV" }));
      expect((click.mock.contexts[0] as HTMLAnchorElement).download).toMatch(/^load-plan-RIGID_MEDIUM-2-trucks-/);
    } finally {
      Object.assign(URL, original);
    }
  });

  it("shows the API's message when the split fails, with the way back", async () => {
    mockApi({ fleet: [{ detail: "Splitting across trucks isn't available yet." }, 501] });
    const user = userEvent.setup();
    render(<Planner initialReference={reference} />);
    await user.click(await splitButton());
    expect(await screen.findByText("Splitting across trucks isn't available yet.")).toBeInTheDocument();
    expect(screen.getByText("The planner couldn't split the load")).toBeInTheDocument();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Back to one truck" }));
    expect(screen.queryByText("Splitting across trucks isn't available yet.")).not.toBeInTheDocument();
    expect(await splitButton()).toBeInTheDocument();
  });

  it("explains instead of offering the split in suggest mode", async () => {
    mockApi({ plan: { ...planSuggest.result, fits: false, reasons: ["Too many pallets."], warnings: planOverCapacity.result.warnings } });
    const user = userEvent.setup();
    render(<Planner initialReference={reference} />);
    await splitButton();
    await user.click(screen.getByRole("radio", { name: /suggest/i }));
    expect(await screen.findByText("To split this load across trucks, pick a vehicle in step 1 first.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Split across trucks" })).not.toBeInTheDocument();
  });

  it("explains instead of offering the split for containers", async () => {
    mockApi({ plan: { ...planBdoubleContainers.result, fits: false, reasons: ["Too heavy."], warnings: planOverCapacity.result.warnings } });
    const user = userEvent.setup();
    render(<Planner initialReference={reference} />);
    await splitButton();
    await user.click(screen.getByRole("button", { name: "1 × 40' HC container, 20 t" }));
    expect(await screen.findByText("Splitting across trucks takes pallets and loose freight, not containers.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Split across trucks" })).not.toBeInTheDocument();
  });
});
