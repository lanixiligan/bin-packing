import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import EmptyState from "./EmptyState.tsx";

describe("EmptyState", () => {
  it("renders a neutral title, body and action", () => {
    render(
      <EmptyState title="Add some freight" action={<button type="button">Load sample freight</button>}>
        <p>A plan appears here.</p>
      </EmptyState>,
    );
    expect(screen.getByRole("heading", { name: "Add some freight" })).toBeInTheDocument();
    expect(screen.getByText("A plan appears here.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Load sample freight" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByTestId("empty-state")).toHaveClass("empty-state--neutral");
  });

  it("renders the error tone as an alert with a labelled icon", () => {
    render(<EmptyState title="Can't load the data" tone="error"><p>Network down.</p></EmptyState>);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveClass("empty-state--error");
    expect(alert).toHaveTextContent("Can't load the data");
    expect(screen.getByRole("img", { name: "Error" })).toBeInTheDocument();
  });
});
