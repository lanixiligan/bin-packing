import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import TruckCard from "./TruckCard.jsx";
import Summary from "./Summary.jsx";
import { deckPlan } from "./deck.ts";
import solved from "../__fixtures__/solve-sized.json";

const SIZE = { maxWidthPx: 80, maxLengthPx: 340 };
const dropIndexOf = (data) => Object.fromEntries(data.drop_order.map((id, k) => [id, k]));
/** The px a TruckCard writes for `mm` at `scale` (rounded to 0.1 px). */
const px = (mm, scale) => `${Math.round(mm * scale * 10) / 10}px`;

function renderCard(data, truck, props = {}) {
  const plan = deckPlan(data.capacity.decks, SIZE);
  const handlers = { onHover: vi.fn(), onFocusBlock: vi.fn(), onHoverTruck: vi.fn() };
  render(
    <TruckCard
      truck={truck}
      numTrucks={data.num_trucks}
      capacity={data.capacity}
      plan={plan}
      step={data.drop_order.length}
      dropIndex={dropIndexOf(data)}
      activeIds={null}
      activeTruck={null}
      {...handlers}
      {...props}
    />
  );
  return { plan, ...handlers };
}

describe("TruckCard", () => {
  const truck1 = solved.trucks[0];

  it("names the truck and says what's left, how full and how high", () => {
    renderCard(solved, truck1);
    const card = screen.getByRole("article", { name: "Truck 1" });
    expect(card).toHaveTextContent("5,950 kg free");
    expect(card).toHaveTextContent(/kg\s*25%/);
    expect(card).toHaveTextContent(/floor\s*56%/);
    expect(card).toHaveTextContent("2.4 of 2.7 m high");
    expect(card).toHaveTextContent("Weight 2,050 of 8,000 kg (25%), floor 56% used, 2.4 of 2.7 m high.");
    for (const s of truck1.shipments) expect(card).toHaveTextContent(s.name);
  });

  it("draws each footprint to scale where the solver placed it", () => {
    const { plan } = renderCard(solved, truck1);
    const deck = screen.getByRole("list", { name: "Truck 1: 4.8 × 2.4 m deck" });
    expect(deck.style.width).toBe(px(2400, plan.scale));
    expect(deck.style.height).toBe(px(4800, plan.scale));
    // Rice 08 was turned: 800 along the deck, 1200 across, at x 2330.
    const rice = within(deck).getByRole("listitem", { name: /^Rice 08,/ });
    expect(rice).toHaveAccessibleName("Rice 08, Euro pallet, 1.0 m high, 400 kg, truck 1 of 2");
    expect(rice.style.top).toBe(px(2330, plan.scale));
    expect(rice.style.left).toBe("0px");
    expect(rice.style.width).toBe(px(1200, plan.scale));
    expect(rice.style.height).toBe(px(800, plan.scale));
    const glass = within(deck).getByRole("listitem", { name: /^Glass 04,/ });
    expect(glass.style.left).toBe(px(1165, plan.scale));
    expect(glass.style.top).toBe("0px");
    // Five footprints: the two paint pallets share one.
    expect(within(deck).getAllByRole("listitem")).toHaveLength(5);
    within(deck).getAllByRole("listitem").forEach((el) => expect(el).toHaveAttribute("tabindex", "0"));
  });

  it("shows a stack as one footprint marked ×2, with both levels in its label", () => {
    const { onHover, onFocusBlock } = renderCard(solved, truck1);
    const stack = screen.getByRole("listitem", { name: /^Stack of 2/ });
    expect(stack).toHaveAccessibleName(
      "Stack of 2, 2.4 m high: level 1, Paint 01, AU pallet, 1.2 m high, 420 kg; " +
      "level 2, Paint 02, AU pallet, 1.2 m high, 380 kg; truck 1 of 2"
    );
    expect(stack).toHaveTextContent("×2");
    fireEvent.pointerEnter(stack);
    expect(onHover).toHaveBeenLastCalledWith([0, 1]);
    fireEvent.focus(stack);
    expect(onFocusBlock).toHaveBeenLastCalledWith([0, 1]);
  });

  it("draws a loose item as a long bar", () => {
    const { plan } = renderCard(solved, truck1);
    const pipes = screen.getByRole("listitem", { name: "Pipes 03, 4.6 × 0.4 × 0.3 m loose, 250 kg, truck 1 of 2" });
    expect(pipes).toHaveClass("loose");
    expect(pipes.style.height).toBe(px(4600, plan.scale));
    expect(pipes.style.width).toBe(px(400, plan.scale));
    expect(pipes.style.left).toBe(px(1965, plan.scale));
  });

  it("lights up the footprint and the card that hold the highlighted shipment", () => {
    renderCard(solved, truck1, { activeIds: [1] });
    expect(screen.getByRole("article", { name: "Truck 1" })).toHaveClass("holds-active");
    expect(screen.getByRole("listitem", { name: /^Stack of 2/ })).toHaveClass("active");
    expect(screen.getByRole("listitem", { name: /^Rice 08/ })).not.toHaveClass("active");
  });

  it("says Loading… and shows only what has dropped in so far", () => {
    // Drop order of truck 1 starts with Paint 01, Glass 04, Pipes 03.
    renderCard(solved, truck1, { step: 1 });
    const card = screen.getByRole("article", { name: "Truck 1" });
    expect(card).toHaveTextContent("Loading…");
    expect(within(card).getAllByRole("listitem").filter((el) => el.classList.contains("deck-item"))).toHaveLength(1);
  });

  it("draws every deck of a B-double, named, at one scale", () => {
    const decks = [
      { id: "lead", name: "Lead trailer", length_mm: 7400, width_mm: 2480, height_mm: 2700 },
      { id: "rear", name: "Rear trailer", length_mm: 13600, width_mm: 2480, height_mm: 2700 },
    ];
    const at = (deck_id, x_mm, y_mm, extra = {}) => ({
      deck_id, x_mm, y_mm, z_mm: 0, length_mm: 1165, width_mm: 1165, height_mm: 1200, rotated: false, level: 0, ...extra,
    });
    const shipment = (id, name, placement, extra = {}) => ({
      id, name, weight: 500, kind: "pallet", pallet_type: "AU_STD", length_mm: 1165, width_mm: 1165, height_mm: 1200,
      stackable: false, placement: { stack_base: id, ...placement }, ...extra,
    });
    const data = {
      capacity: { weight_kg: 42500, decks, floor_m2: 52.08, volume_m3: 140.6 },
      num_trucks: 1,
      drop_order: [0, 1, 2],
      trucks: [{
        truck: 1, load: 1500, empty: 41000, fill_percent: 3.5, floor_used_m2: 4.07, floor_percent: 7.8, max_height_mm: 1200,
        shipments: [
          shipment(0, "Tiles 01", at("lead", 0, 0)),
          shipment(1, "Steel 02", at("rear", 1000, 100, { length_mm: 12000, width_mm: 500, height_mm: 300 }),
            { kind: "loose", pallet_type: null, length_mm: 12000, width_mm: 500, height_mm: 300 }),
          shipment(2, "Books 03", at("rear", 12400, 1300)),
        ],
      }],
    };
    const { plan } = renderCard(data, data.trucks[0]);
    const card = screen.getByRole("article", { name: "Truck 1" });
    expect(card).toHaveTextContent("Lead trailer");
    expect(card).toHaveTextContent("Rear trailer");
    const lead = screen.getByRole("list", { name: "Truck 1, Lead trailer: 7.4 × 2.48 m deck" });
    const rear = screen.getByRole("list", { name: "Truck 1, Rear trailer: 13.6 × 2.48 m deck" });
    expect(lead.style.height).toBe(px(7400, plan.scale));
    expect(rear.style.height).toBe(px(13600, plan.scale));
    expect(within(lead).getAllByRole("listitem").map((el) => el.getAttribute("aria-label")))
      .toEqual(["Tiles 01, AU pallet, 1.2 m high, 500 kg, truck 1 of 1"]);
    const steel = within(rear).getByRole("listitem", { name: /^Steel 02, 12\.0 × 0\.5 × 0\.3 m loose/ });
    expect(steel.style.top).toBe(px(1000, plan.scale));
    expect(steel.style.height).toBe(px(12000, plan.scale));
    expect(within(rear).getByRole("listitem", { name: /^Books 03/ }).style.top).toBe(px(12400, plan.scale));
  });
});

describe("Summary", () => {
  it("shows the trucks, the badge and the weight, volume and floor bounds", () => {
    render(<Summary result={solved} />);
    expect(screen.getByRole("heading", { name: "2 trucks for 8 shipments" })).toBeInTheDocument();
    expect(screen.getByText("Proven optimal")).toBeInTheDocument();
    expect(screen.getByText(/Weight bound/)).toHaveTextContent("Weight bound ⌈2,900 ÷ 8,000 kg⌉ = 1");
    expect(screen.getByText(/Volume bound/)).toHaveTextContent("Volume bound ⌈11.9 ÷ 31.1 m³⌉ = 1");
    // Floor bound: the non-stackable footprints (everything but the two paint pallets).
    expect(screen.getByText(/Floor bound/)).toHaveTextContent(/Floor bound ⌈\d+(\.\d)? ÷ 11.5 m²⌉ = 1/);
  });
});
