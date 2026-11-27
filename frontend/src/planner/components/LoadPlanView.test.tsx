import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { planMultidrop, planOverCapacity, reference } from "../test/fixtures.ts";
import LoadPlanView from "./LoadPlanView.tsx";

describe("LoadPlanView", () => {
  it("lists unplaced units grouped by item, with a pointer to the warnings", () => {
    render(<LoadPlanView result={planOverCapacity.result} reference={reference} request={planOverCapacity.request} />);
    const section = screen.getByRole("region", { name: /not placed/i });
    expect(within(section).getByText("Chilled")).toBeInTheDocument();
    expect(within(section).getByText("× 1")).toBeInTheDocument();
    expect(within(section).getByText("(chill#3)")).toBeInTheDocument();
    expect(within(section).getByText(/see the warnings/i)).toBeInTheDocument();
  });

  it("has no unplaced list when everything fits", () => {
    render(<LoadPlanView result={planMultidrop.result} reference={reference} request={planMultidrop.request} />);
    expect(screen.queryByRole("region", { name: /not placed/i })).not.toBeInTheDocument();
  });

  it("zooms the drawings in steps and fits them back", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <LoadPlanView result={planMultidrop.result} reference={reference} request={planMultidrop.request} />,
    );
    const zoom = () => screen.getByLabelText("Zoom level").textContent;
    expect(zoom()).toBe("100 %");
    expect(screen.getByRole("button", { name: "Zoom out" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Fit to width" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Zoom in" }));
    await user.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(zoom()).toBe("200 %");
    await user.click(screen.getByRole("button", { name: "Zoom out" }));
    expect(zoom()).toBe("150 %");
    await user.click(screen.getByRole("button", { name: "Fit to width" }));
    expect(zoom()).toBe("100 %");
    // Both drawings share the x scale: same viewBox x range.
    const [deck, elev] = [container.querySelector(".deck-view")!, container.querySelector(".elevation-view")!];
    const xRange = (svg: Element) => svg.getAttribute("viewBox")!.split(" ").filter((_, i) => i % 2 === 0);
    expect(xRange(deck)).toEqual(xRange(elev));
  });

  it("offers the three colour modes", () => {
    render(<LoadPlanView result={planMultidrop.result} reference={reference} request={planMultidrop.request} />);
    const group = screen.getByRole("group", { name: "Colour by" });
    expect(within(group).getAllByRole("radio").map((r) => r.getAttribute("value"))).toEqual(["dg", "weight", "type"]);
  });
});
