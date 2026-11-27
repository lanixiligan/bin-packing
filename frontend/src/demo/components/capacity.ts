// Shipment colours shared by the table and the truck views (2D and 3D).
// Truck capacity itself comes from the vehicle (vehicle.ts) and the solve response.
//
// Pure functions only (no React, no DOM), so they can be unit-tested with node.

// Same shipment = same color in both panels, so you can compare them.
// Lightness 74% keeps the near-black labels (#0f172a) above 6:1 for every hue
// (WCAG AA needs 4.5:1; at 62% the blue hues only reached 3.5:1).
export function colorFor(id: number): string {
  const hue = (id * 137.508) % 360; // golden angle spreads colors nicely
  return `hsl(${hue}, 55%, 74%)`;
}

