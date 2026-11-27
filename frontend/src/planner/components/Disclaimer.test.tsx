import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import Disclaimer from "./Disclaimer.tsx";

describe("Disclaimer", () => {
  it("shows one short line and reveals the full text on demand", async () => {
    render(<Disclaimer variant="banner" />);
    expect(screen.getByText(/Planning tool only: results are estimates/)).toBeInTheDocument();
    const full = screen.getByText(/driver and operator remain responsible/);
    expect(full).not.toBeVisible();

    const toggle = screen.getByRole("button", { name: "More" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(document.getElementById(toggle.getAttribute("aria-controls")!)).toContainElement(full);

    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toHaveAccessibleName("Less");
    expect(full).toBeVisible();

    await userEvent.click(toggle);
    expect(full).not.toBeVisible();
  });

  it("defaults to the banner", () => {
    render(<Disclaimer />);
    expect(screen.getByRole("button", { name: "More" })).toBeInTheDocument();
  });

  it("shows the full text with no toggle", () => {
    render(<Disclaimer variant="full" />);
    const text = screen.getByText(/driver and operator remain responsible/);
    expect(text).toBeVisible();
    expect(text).toHaveTextContent(/NTC Load Restraint Guide/);
    expect(text).toHaveTextContent(/GML or HML/);
    expect(text).toHaveTextContent(/NHVR permit/);
    expect(text).toHaveTextContent(/state route approval/);
    expect(text).toHaveTextContent(/typical values/);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
