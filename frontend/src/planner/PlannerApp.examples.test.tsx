// Example shipments in the page: choosing one replaces the freight, picks its vehicle, splits
// across trucks and shows its caption until the freight changes.
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { exampleById } from "../examples/shipmentExamples.ts";
import { Planner } from "./PlannerApp.tsx";
import { fleetSample, planDgConflict, reference } from "./test/fixtures.ts";

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

function mockApi() {
  const spy = vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
    const url = String(input);
    if (url === "/api/plan/fleet") return Promise.resolve(json(fleetSample.result));
    if (url === "/api/plan") return Promise.resolve(json(planDgConflict.result));
    return Promise.resolve(json(reference));
  });
  const calls = (url: string) => spy.mock.calls.filter(([u]) => String(u) === url);
  const body = (call: unknown[]) => JSON.parse(String((call[1] as RequestInit).body));
  return { calls, body };
}

const select = () => screen.getByRole("combobox", { name: "Example shipments" });

describe("Planner: example shipments", () => {
  it("replaces the freight, uses the example's vehicle, splits and shows the caption", async () => {
    const { calls, body } = mockApi();
    const user = userEvent.setup();
    render(<Planner initialReference={reference} />);
    await screen.findByRole("button", { name: "Split across trucks" });

    await user.selectOptions(select(), "drinks-run");
    const example = exampleById("drinks-run")!;
    expect(screen.getByText(example.shows)).toHaveTextContent(`Drinks run: ${example.shows}`);
    await waitFor(() => expect(calls("/api/plan/fleet")).toHaveLength(1));
    const sent = body(calls("/api/plan/fleet")[0]);
    expect(sent).toMatchObject({ vehicle_id: "RIGID_MEDIUM", body_type: null });
    expect(sent.items.map((i: { label: string; quantity: number }) => [i.label, i.quantity]))
      .toEqual(example.lines.map((l) => [l.name, l.count]));
    await screen.findByRole("tablist", { name: "Trucks" });

    // An example with its own vehicle.
    await user.selectOptions(select(), "pipes-timber");
    await waitFor(() => expect(body(calls("/api/plan/fleet").at(-1)!).vehicle_id).toBe("RIGID_LARGE"));
    expect(screen.getByText(exampleById("pipes-timber")!.shows)).toBeInTheDocument();
  });

  it("clears the caption and the list's choice once the freight changes", async () => {
    mockApi();
    const user = userEvent.setup();
    render(<Planner initialReference={reference} />);
    await user.selectOptions(select(), "cement-tiles");
    const caption = exampleById("cement-tiles")!.shows;
    expect(screen.getByText(caption)).toBeInTheDocument();
    expect(select()).toHaveValue("cement-tiles");

    await user.click(screen.getByRole("button", { name: /^line 1\b/i }));
    await user.type(screen.getByLabelText("Quantity"), "1");
    expect(screen.queryByText(caption)).not.toBeInTheDocument();
    expect(select()).toHaveValue("");
  });

  it("Undo puts back the freight, the vehicle and one-truck mode the example replaced", async () => {
    const { calls, body } = mockApi();
    const user = userEvent.setup();
    render(<Planner initialReference={reference} />);
    await waitFor(() => expect(calls("/api/plan")).toHaveLength(1));
    const before = body(calls("/api/plan")[0]);

    await user.selectOptions(select(), "cement-tiles");
    await waitFor(() => expect(calls("/api/plan/fleet")).toHaveLength(1));
    await user.click(screen.getByRole("button", { name: "Undo" }));

    // Back to planning the original freight on the original vehicle, on one truck.
    await waitFor(() => expect(calls("/api/plan")).toHaveLength(2));
    expect(body(calls("/api/plan")[1])).toEqual(before);
    expect(calls("/api/plan/fleet")).toHaveLength(1);
    expect(screen.queryByText(exampleById("cement-tiles")!.shows)).not.toBeInTheDocument();
  });

  it("clears the caption when the vehicle changes", async () => {
    mockApi();
    const user = userEvent.setup();
    render(<Planner initialReference={reference} />);
    await user.selectOptions(select(), "pipes-timber");
    const caption = exampleById("pipes-timber")!.shows;
    expect(screen.getByText(caption)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /change/i }));
    await user.click(screen.getByRole("radio", { name: /semi-trailer/i }));
    expect(screen.queryByText(caption)).not.toBeInTheDocument();
  });
});
