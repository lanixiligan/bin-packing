import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import CheckerApp from "./CheckerApp.tsx";
import { evaluate, type Load } from "./checker.ts";

const flags = { big500: false, cyl500: true, fireRisk: false };
const load = (p: string, subs: string[] = []) => ({ p, subs }) as Load;

describe("evaluate (the checker's verdict, from the shared rules engine)", () => {
  it("matches Table 9.1 for plain pairs", () => {
    expect(evaluate(load("3"), load("5.1"), flags).overall).toBe("bad");
    expect(evaluate(load("3"), load("8"), flags).overall).toBe("ok");
    expect(evaluate(load("6"), load("F"), flags).overall).toBe("bad");
    expect(evaluate(load("5.1"), load("5.1"), flags).overall).toBe("check"); // Table 9.2
    expect(evaluate(load("1"), load("9"), flags).overall).toBe("ex");
  });

  it("applies the exception questions", () => {
    expect(evaluate(load("2.1"), load("3"), flags).overall).toBe("ok");
    expect(evaluate(load("2.1"), load("3"), { ...flags, big500: true }).overall).toBe("bad"); // exception 2
    expect(evaluate(load("5.1"), load("9"), flags).overall).toBe("ok");
    expect(evaluate(load("5.1"), load("9"), { ...flags, fireRisk: true }).overall).toBe("bad"); // exception 5
    expect(evaluate(load("2.1"), load("2.2", ["5.1"]), flags).overall).toBe("ok");
    expect(evaluate(load("2.1"), load("2.2", ["5.1"]), { ...flags, cyl500: false }).overall).toBe("bad"); // exception 3
  });

  it("checks subsidiary hazards", () => {
    expect(evaluate(load("3"), load("8"), flags).overall).toBe("ok");
    expect(evaluate(load("3"), load("8", ["5.1"]), flags).overall).toBe("bad");
  });
});

describe("CheckerApp", () => {
  it("starts on Class 3 with Class 5.1: incompatible", () => {
    render(<CheckerApp />);
    expect(screen.getByTestId("verdict")).toHaveTextContent(/^Incompatible/);
  });

  it("asks about exception 2 for 2.1 with 3, and the answer changes the verdict", async () => {
    const user = userEvent.setup();
    render(<CheckerApp />);
    await user.click(screen.getByRole("button", { name: "Class 2.1 with Class 3: 0(2)" }));
    const verdict = screen.getByTestId("verdict");
    expect(verdict).toHaveTextContent(/^Compatible/);
    await user.click(within(verdict).getByRole("checkbox", { name: /exception 2/ }));
    expect(verdict).toHaveTextContent(/^Incompatible/);
  });

  it("loads a matrix cell's pair into the pickers", async () => {
    const user = userEvent.setup();
    render(<CheckerApp />);
    await user.click(screen.getByRole("button", { name: "Class 8 with Food or food empties: N(8)" }));
    const a = screen.getByRole("group", { name: "Load A primary class" });
    const b = screen.getByRole("group", { name: "Load B primary class or other goods" });
    expect(within(a).getByRole("button", { pressed: true })).toHaveTextContent("8");
    expect(within(b).getByRole("button", { pressed: true })).toHaveTextContent("Food");
    expect(screen.getByTestId("verdict")).toHaveTextContent(/^Incompatible/);
  });

  it("shows the explosives verdict for Class 1", async () => {
    const user = userEvent.setup();
    render(<CheckerApp />);
    const a = screen.getByRole("group", { name: "Load A primary class" });
    await user.click(within(a).getByRole("button", { name: /^1\b/ }));
    expect(screen.getByTestId("verdict")).toHaveTextContent(/^Incompatible: explosives/);
  });
});
