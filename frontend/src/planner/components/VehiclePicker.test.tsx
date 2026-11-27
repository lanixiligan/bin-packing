import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SUGGEST } from "../api/types.ts";
import { reference } from "../test/fixtures.ts";
import VehiclePicker, { type VehiclePickerProps } from "./VehiclePicker.tsx";

function renderPicker(props: Partial<VehiclePickerProps> = {}) {
  const onVehicleChange = vi.fn();
  const onBodyChange = vi.fn();
  render(<VehiclePicker reference={reference} vehicleId="SEMI_TRAILER" bodyType={null}
                        onVehicleChange={onVehicleChange} onBodyChange={onBodyChange} {...props} />);
  return { onVehicleChange, onBodyChange };
}

describe("VehiclePicker", () => {
  it("renders a card per vehicle, smallest first, plus Suggest", () => {
    renderPicker();
    const group = screen.getByRole("group", { name: "Vehicle" });
    const radios = within(group).getAllByRole("radio");
    expect(radios).toHaveLength(Object.keys(reference.vehicles).length + 1);
    expect(radios[0]).toHaveAccessibleName(/suggest one: the smallest vehicle that fits/i);
    expect(radios[1]).toHaveAccessibleName(/small rigid/i);
    expect(radios[radios.length - 1]).toHaveAccessibleName(/road train/i);

    const semi = screen.getByRole("radio", { name: /semi-trailer/i });
    expect(semi).toBeChecked();
    expect(semi).toHaveAccessibleName(/22 pallet spaces/);
    expect(semi).toHaveAccessibleName(/24,000 kg payload/);
    expect(semi).toHaveAccessibleName(/1 × 40' or 1 × 45' or 2 × 20'/);
  });

  it("shows route approval and configurable badges, with the permit note", () => {
    renderPicker();
    const card = screen.getByRole("radio", { name: /super b-double/i }).closest("label")!;
    const badge = within(card).getByText("Route approval");
    expect(badge).toHaveAttribute("title", reference.vehicles.SUPER_B_DOUBLE.permit_note);
    expect(within(card).getByText("Configurable")).toBeInTheDocument();
    const semiCard = screen.getByRole("radio", { name: /semi-trailer/i }).closest("label")!;
    expect(within(semiCard).queryByText("Route approval")).not.toBeInTheDocument();
  });

  it("calls onVehicleChange when a card is chosen", async () => {
    const { onVehicleChange } = renderPicker();
    await userEvent.click(screen.getByRole("radio", { name: /^b-double/i }));
    expect(onVehicleChange).toHaveBeenCalledWith("B_DOUBLE");
    await userEvent.click(screen.getByRole("radio", { name: /suggest one/i }));
    expect(onVehicleChange).toHaveBeenLastCalledWith(SUGGEST);
  });

  it("lists only the vehicle's in-scope bodies, default first and marked", async () => {
    const { onBodyChange } = renderPicker({ vehicleId: "RIGID_MEDIUM" });
    const select = screen.getByRole("combobox", { name: "Body type" });
    const options = within(select).getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual([
      "Tautliner (curtainsider) (default)",
      "Pantech (van)",
      "Refrigerated pantech (reefer)",
      "Flat top (flat bed)",
    ]);
    expect(screen.getByText("Side + rear loading")).toBeInTheDocument();

    await userEvent.selectOptions(select, "REFRIGERATED_PANTECH");
    expect(onBodyChange).toHaveBeenCalledWith("REFRIGERATED_PANTECH");
    await userEvent.selectOptions(select, "TAUTLINER");
    expect(onBodyChange).toHaveBeenLastCalledWith(null);
  });

  it("shows the chosen body's access and refrigeration", () => {
    renderPicker({ vehicleId: "RIGID_MEDIUM", bodyType: "REFRIGERATED_PANTECH" });
    expect(screen.getByRole("combobox", { name: "Body type" })).toHaveValue("REFRIGERATED_PANTECH");
    expect(screen.getByText("Rear loading")).toBeInTheDocument();
    expect(screen.getByText("Refrigerated")).toBeInTheDocument();
  });

  it("badges the suggested vehicle in suggest mode and hides the body select", () => {
    renderPicker({ vehicleId: SUGGEST, suggestedVehicleId: "RIGID_MEDIUM" });
    expect(screen.getByRole("radio", { name: /suggest one/i })).toBeChecked();
    const card = screen.getByRole("radio", { name: /^medium rigid/i }).closest("label")!;
    expect(within(card).getByText("Suggested")).toBeInTheDocument();
    expect(screen.getAllByText("Suggested")).toHaveLength(1);
    expect(screen.queryByRole("combobox", { name: "Body type" })).not.toBeInTheDocument();
  });
});
