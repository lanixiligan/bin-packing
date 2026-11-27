import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./DemoApp.jsx";
import { reference } from "../planner/test/fixtures.ts";
import solved from "./__fixtures__/solve-sized.json";

const ok = (data) => ({ ok: true, status: 200, json: async () => data });

function mockApi({ referenceFails = false } = {}) {
  const fetchMock = vi.fn(async (url) => {
    if (url === "/api/reference") {
      return referenceFails ? { ok: false, status: 500, json: async () => ({ detail: "Reference is down." }) } : ok(reference);
    }
    if (url === "/api/solve") return ok(solved);
    throw new Error(`unexpected ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const solveBodies = (fetchMock) =>
  fetchMock.mock.calls.filter(([url]) => url === "/api/solve").map(([, init]) => JSON.parse(init.body));

// Whole-page tests type a lot; give them room when the full suite runs in parallel.
describe("Demo page", { timeout: 20_000 }, () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    Element.prototype.scrollIntoView = () => {};
  });

  it("solves the random shipments on the default vehicle straight away", async () => {
    const fetchMock = mockApi();
    render(<App />);
    expect(await screen.findByRole("heading", { name: "2 trucks for 8 shipments" })).toBeInTheDocument();
    const [body] = solveBodies(fetchMock);
    expect(body.vehicle_id).toBe("RIGID_MEDIUM");
    expect(body.body_type).toBeNull();
    expect(body.rule_set).toBe("adg");
    expect(body.shipments).toHaveLength(20);
    for (const s of body.shipments) {
      if (s.kind === "pallet") expect(s).not.toHaveProperty("length_mm");
      else expect(s).not.toHaveProperty("pallet_type");
    }
    expect(screen.getAllByRole("article")).toHaveLength(2);
  });

  it("shows the vehicle on one line, and Change opens the vehicle cards", async () => {
    const user = userEvent.setup();
    const fetchMock = mockApi();
    render(<App />);
    const toolbar = screen.getByRole("region", { name: "Trucks" });
    expect(await within(toolbar).findByText("Medium rigid (8 t) · 4.8 × 2.4 m deck · 2.7 m inside · 8 t")).toBeInTheDocument();
    await screen.findByRole("heading", { name: "2 trucks for 8 shipments" });

    const change = within(toolbar).getByRole("button", { name: "Change truck" });
    expect(change).toHaveAttribute("aria-expanded", "false");
    await user.click(change);
    expect(change).toHaveAttribute("aria-expanded", "true");
    const panel = screen.getByRole("region", { name: "Choose the truck" });
    const radios = within(panel).getAllByRole("radio");
    // No "Suggest one", no configurable or route-restricted vehicles.
    expect(radios).toHaveLength(5);
    expect(within(panel).queryByRole("radio", { name: /suggest/i })).not.toBeInTheDocument();
    expect(within(panel).queryByRole("radio", { name: /road train/i })).not.toBeInTheDocument();
    expect(within(panel).getByRole("radio", { name: /medium rigid/i })).toBeChecked();
    // Only bodies that carry pallets.
    const bodies = within(panel).getAllByRole("option").map((o) => o.value);
    expect(bodies).not.toContain("SKELETAL");

    await user.click(within(panel).getByRole("radio", { name: /b-double/i }));
    expect(within(toolbar).getByText("B-double · 7.4 + 13.6 × 2.48 m decks · 2.7 m inside · 42.5 t")).toBeInTheDocument();
    // The old answer no longer matches the vehicle.
    expect(screen.getByRole("heading", { name: "Ready to solve" })).toBeInTheDocument();

    await user.click(within(panel).getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("region", { name: "Choose the truck" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Solve" }));
    await screen.findByRole("heading", { name: "2 trucks for 8 shipments" });
    expect(solveBodies(fetchMock).at(-1).vehicle_id).toBe("B_DOUBLE");
  });

  it("closes the vehicle cards on Escape, back on Change", async () => {
    const user = userEvent.setup();
    mockApi();
    render(<App />);
    await screen.findByText(/Medium rigid \(8 t\) ·/);
    await user.click(screen.getByRole("button", { name: "Change truck" }));
    expect(screen.getByRole("radio", { name: /medium rigid/i })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("region", { name: "Choose the truck" })).not.toBeInTheDocument();
    await new Promise((r) => requestAnimationFrame(r));
    expect(screen.getByRole("button", { name: "Change truck" })).toHaveFocus();
  });

  it("says plainly when the vehicles can't be loaded, and still solves", async () => {
    mockApi({ referenceFails: true });
    render(<App />);
    expect(await screen.findByText(/Couldn’t load the vehicles \(Reference is down\.\)/)).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "2 trucks for 8 shipments" })).toBeInTheDocument();
  });

  it("won't solve a shipment that can never go on the vehicle", async () => {
    const user = userEvent.setup();
    const fetchMock = mockApi();
    render(<App />);
    await screen.findByText(/Medium rigid \(8 t\) ·/);
    await screen.findByRole("heading", { name: "2 trucks for 8 shipments" });
    await user.click(screen.getByRole("button", { name: "Clear" }));
    await user.type(screen.getByRole("combobox", { name: "New shipment name" }), "Crate");
    const kind = screen.getByRole("combobox", { name: "New shipment pallet type, or loose" });
    await user.selectOptions(kind, "loose");
    // Loose starts from the pallet's footprint.
    const length = screen.getByRole("spinbutton", { name: "New shipment length in mm" });
    expect(length).toHaveValue(1165);
    await user.clear(length);
    await user.type(length, "6000");
    const width = screen.getByRole("spinbutton", { name: "New shipment width in mm" });
    await user.clear(width);
    await user.type(width, "500");
    await user.type(screen.getByRole("spinbutton", { name: "New shipment weight in kg" }), "200");
    await user.click(screen.getByRole("button", { name: "Add" }));
    await user.click(screen.getByRole("button", { name: "Solve" }));
    await waitFor(() => expect(screen.getByRole("alert", { name: "" })).toHaveTextContent(
      "These shipments can never go on a Medium rigid (8 t): 'Crate' (too long or wide)."
    ));
    expect(solveBodies(fetchMock)).toHaveLength(1); // only the solve on load
  });
});
