import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import type { MassScheme } from "../api/types.ts";
import { SUGGEST } from "../api/types.ts";
import { reference } from "../test/fixtures.ts";
import VehicleStep from "./VehicleStep.tsx";

function Harness({ initial = "SEMI_TRAILER", suggested = null }: { initial?: string; suggested?: string | null }) {
  const [vehicleId, setVehicleId] = useState(initial);
  const [bodyType, setBodyType] = useState<string | null>(null);
  const [massScheme, setMassScheme] = useState<MassScheme>("GML");
  return (
    <VehicleStep reference={reference} vehicleId={vehicleId} bodyType={bodyType} massScheme={massScheme}
                 onVehicleChange={(id) => { setVehicleId(id); setBodyType(null); }} onBodyChange={setBodyType}
                 onMassSchemeChange={setMassScheme} suggestedVehicleId={vehicleId === SUGGEST ? suggested : null} />
  );
}

const summary = () => screen.getByTestId("vehicle-summary").textContent!.replace(/\u00a0/g, " ");
const change = () => screen.getByRole("button", { name: "Change vehicle" });

describe("VehicleStep", () => {
  it("shows the chosen vehicle on one line, with the picker closed", () => {
    render(<Harness />);
    expect(summary()).toBe("Semi-trailer (13.7 m class) · 22 pallet spaces · 24,000 kg payload · Tautliner · GML");
    expect(change()).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Body type" })).not.toBeInTheDocument();
  });

  it("opens the cards, body type and mass limits from Change, with focus on the selected card", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(change());
    expect(change()).toHaveAttribute("aria-expanded", "true");
    expect(document.getElementById(change().getAttribute("aria-controls")!)).toBeVisible();
    expect(screen.getByRole("radio", { name: /semi-trailer/i })).toHaveFocus();
    expect(screen.getByRole("radio", { name: /suggest one/i })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Body type" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Mass limits" })).toBeInTheDocument();
  });

  it("updates the line when a vehicle, body or mass limit is picked, and stays open until Done", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(change());
    await user.click(screen.getByRole("radio", { name: /^medium rigid/i }));
    expect(summary()).toMatch(/^Medium rigid \(8 t\) · \d+ pallet spaces · [\d,]+ kg payload · Tautliner · GML$/);
    expect(change()).toHaveAttribute("aria-expanded", "true");
    await user.selectOptions(screen.getByRole("combobox", { name: "Body type" }), "REFRIGERATED_PANTECH");
    await user.click(screen.getByRole("radio", { name: "Higher Mass Limits" }));
    expect(summary()).toMatch(/· Refrigerated pantech · HML$/);

    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(change()).toHaveAttribute("aria-expanded", "false");
    expect(change()).toHaveFocus();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
  });

  it("closes on Escape and returns focus to Change", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(change());
    await user.keyboard("{Escape}");
    expect(change()).toHaveAttribute("aria-expanded", "false");
    expect(change()).toHaveFocus();
  });

  it("says so in suggest mode, and names the vehicle the plan picked", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<Harness />);
    await user.click(change());
    await user.click(screen.getByRole("radio", { name: /suggest one/i }));
    expect(summary()).toBe("Suggest the smallest vehicle · GML");
    unmount();

    render(<Harness initial={SUGGEST} suggested="RIGID_MEDIUM" />);
    expect(summary()).toBe("Suggest the smallest vehicle · Picked: Medium rigid (8 t) · GML");
  });

  it("flags a route-restricted vehicle on the line", () => {
    render(<Harness initial="SUPER_B_DOUBLE" />);
    expect(summary()).toMatch(/· GML · Route approval$/);
  });
});
