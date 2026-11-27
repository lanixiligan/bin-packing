import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Planner } from "./PlannerApp.tsx";
import { planMultidrop, reference } from "./test/fixtures.ts";

function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  return vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => Promise.resolve(handler(String(input), init)));
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("Planner shell", () => {
  it("plans the sample freight on first load", async () => {
    const fetch = mockFetch((url) => (url === "/api/plan" ? json(planMultidrop.result) : json(reference)));
    render(<Planner initialReference={reference} />);
    expect(screen.getByRole("heading", { name: /choose a vehicle/i })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/planned on the semi-trailer/i)).toBeInTheDocument());
    const body = JSON.parse(String(fetch.mock.calls[0][1]?.body));
    expect(body.vehicle_id).toBe("SEMI_TRAILER");
    expect(body.items).toHaveLength(2);
  });

  it("shows the API's message when planning fails", async () => {
    mockFetch(() => json({ detail: "Unknown vehicle 'X'." }, 400));
    render(<Planner initialReference={reference} />);
    expect(await screen.findByText("Unknown vehicle 'X'.")).toBeInTheDocument();
  });

  it("offers a retry when the reference data can't load", async () => {
    const fetch = mockFetch(() => { throw new TypeError("Failed to fetch"); });
    render(<Planner />);
    expect(await screen.findByText(/can't reach the planner/i)).toBeInTheDocument();
    fetch.mockImplementation(() => Promise.resolve(json(reference)));
    await userEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(await screen.findByRole("heading", { name: /add freight/i })).toBeInTheDocument();
  });

  it("switches the colour theme", async () => {
    mockFetch(() => json(planMultidrop.result));
    render(<Planner initialReference={reference} />);
    await userEvent.click(screen.getByRole("radio", { name: "Dark" }));
    expect(document.documentElement.dataset.theme).toBe("dark");
    await userEvent.click(screen.getByRole("radio", { name: "Auto" }));
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });
});
