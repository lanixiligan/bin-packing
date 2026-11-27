// Example shipments, grouped by industry: fixed loads that each show one packing idea (what
// runs out first: weight, floor space, deck length, or DG rules that keep goods apart).
//
// They are illustrative, not real Northline consignments (Northline publishes none). They
// cover the freight that travels palletised on trucks: construction goods, ambient food and
// drinks (Northline doesn't carry chilled freight), dangerous goods, and retail. Mining and
// fuel move as bulk by rail, ship and tanker, so they have no examples.
//
// Plain data for the load planner. A line is `count` identical units (the planner's
// `quantity`); the planner turns it into freight rows (exampleRows in planner/lib/freight.ts).
// Units: mm and kg. Weights are gross, pallet included.
//
// The numbers are tuned against the load planner's split (POST /api/plan/fleet), which stacks
// two pallets only when together they stay within the 1.8 m max stack height: that's why the
// stackable lines are 900 mm or less.

export interface ExampleLine {
  name: string;
  count: number;
  weightKg: number;
  /** Total height, pallet included. */
  heightMm: number;
  stackable: boolean;
  /** A pallet line: the pallet type id (AU_STD, EURO, ISO_UK, SQUARE…). */
  palletType?: string;
  /** A loose line: its own length × width, no pallet. */
  lengthMm?: number;
  widthMm?: number;
  /** DG class ("3", "5.1"…), "food", "fire_risk", or null for general freight. */
  dgClass: string | null;
  subsidiary: string[];
}

export interface ShipmentExample {
  id: string;
  title: string;
  /** One line: what this load shows about the packing. */
  shows: string;
  /** The vehicle `shows` was worked out on; omitted = the default 8 t medium rigid (RIGID_MEDIUM). */
  vehicleId?: string;
  lines: ExampleLine[];
}

export interface ExampleSection {
  name: string;
  examples: ShipmentExample[];
}

const pallet = (name: string, count: number, weightKg: number, palletType: string, heightMm: number,
  stackable: boolean, dgClass: string | null = null, subsidiary: string[] = []): ExampleLine =>
  ({ name, count, weightKg, palletType, heightMm, stackable, dgClass, subsidiary });

const loose = (name: string, count: number, weightKg: number, lengthMm: number, widthMm: number,
  heightMm: number): ExampleLine =>
  ({ name, count, weightKg, lengthMm, widthMm, heightMm, stackable: false, dgClass: null, subsidiary: [] });

export const EXAMPLE_SECTIONS: ExampleSection[] = [
  {
    name: "Construction",
    examples: [
      {
        id: "cement-tiles",
        title: "Cement & tiles",
        shows: "Heavy pallets: the trucks run out of payload before they run out of floor.",
        lines: [
          pallet("Cement", 10, 950, "AU_STD", 900, true),
          pallet("Tiles", 6, 900, "AU_STD", 900, false),
        ],
      },
      {
        id: "pipes-timber",
        title: "Pipes & timber",
        shows: "Lengths up to 6 m need the large rigid's 7.2 m deck, and long loose items can't stack: floor space decides.",
        vehicleId: "RIGID_LARGE",
        lines: [
          loose("Pipes", 8, 300, 6000, 400, 300),
          loose("Timber", 6, 500, 5400, 600, 500),
        ],
      },
      {
        id: "site-fit-out",
        title: "Site fit-out",
        shows: "Tall goods that can't stack: floor space decides, with most of the payload unused.",
        lines: [
          pallet("Glass", 6, 600, "EURO", 1600, false),
          pallet("Furniture", 8, 250, "AU_STD", 1800, false),
        ],
      },
    ],
  },
  {
    name: "Food & drinks",
    examples: [
      {
        id: "pantry-restock",
        title: "Pantry restock",
        shows: "Stackable sacks go two high, so 18 pallets fit on an 8-space deck.",
        lines: [
          pallet("Rice", 6, 350, "EURO", 900, true, "food"),
          pallet("Flour", 6, 400, "AU_STD", 900, true, "food"),
          pallet("Coffee", 6, 300, "EURO", 900, true, "food"),
        ],
      },
      {
        id: "drinks-run",
        title: "Drinks run",
        shows: "Drinks are dense: the deck is half empty but the trucks are full by weight.",
        lines: [
          pallet("Bottled water", 8, 1000, "AU_STD", 900, true, "food"),
          pallet("Soft drinks", 6, 900, "AU_STD", 900, true, "food"),
        ],
      },
      {
        id: "groceries-pesticide",
        title: "Groceries with pesticide",
        shows: "Food can't share a truck with poisons or corrosives, so a small load needs two trucks.",
        lines: [
          pallet("Rice", 4, 400, "EURO", 1000, true, "food"),
          pallet("Flour", 4, 450, "AU_STD", 1000, true, "food"),
          pallet("Pesticide", 2, 500, "AU_STD", 1200, true, "6.1"),
          pallet("Battery acid", 2, 600, "AU_STD", 1000, false, "8"),
        ],
      },
    ],
  },
  {
    name: "Dangerous goods",
    examples: [
      {
        id: "hardware-store",
        title: "Hardware store",
        shows: "Pool chlorine (an oxidiser) can't travel with paint, thinners or LPG: a one-truck load needs two.",
        lines: [
          pallet("Paint", 4, 400, "AU_STD", 900, true, "3"),
          pallet("Thinners", 4, 400, "AU_STD", 900, true, "3"),
          pallet("Pool chlorine", 4, 500, "AU_STD", 900, true, "5.1"),
          pallet("LPG cylinders", 2, 400, "AU_STD", 1400, false, "2.1"),
        ],
      },
      {
        id: "workshop-supplies",
        title: "Workshop supplies",
        shows: "Not all dangerous goods clash: corrosives, lithium batteries and tyres share one truck.",
        lines: [
          pallet("Battery acid", 3, 700, "AU_STD", 1000, false, "8"),
          pallet("Lithium batteries", 3, 500, "EURO", 1200, false, "9"),
          pallet("Tyres", 2, 300, "AU_STD", 1800, false),
        ],
      },
    ],
  },
  {
    name: "Retail & general",
    examples: [
      {
        id: "retail-restock",
        title: "Retail restock",
        shows: "Light, bulky goods: floor space runs out with most of the payload unused.",
        lines: [
          pallet("Toys", 6, 200, "AU_STD", 1600, false),
          pallet("Books", 6, 600, "AU_STD", 1200, true),
          pallet("Furniture", 4, 250, "AU_STD", 1800, false),
        ],
      },
      {
        id: "mixed-pallets",
        title: "Mixed pallet sizes",
        shows: "Every bound says one truck, but only matching pallets stack and mixed sizes leave gaps: it takes two.",
        lines: [
          pallet("Parts", 7, 400, "ISO_UK", 800, true),
          pallet("Fabric", 7, 250, "EURO", 800, true),
          pallet("Books", 7, 450, "AU_STD", 800, true),
        ],
      },
    ],
  },
];

/** Every example, in menu order. */
export const EXAMPLES: ShipmentExample[] = EXAMPLE_SECTIONS.flatMap((s) => s.examples);

/** The example with this id, or undefined. */
export const exampleById = (id: string): ShipmentExample | undefined => EXAMPLES.find((e) => e.id === id);
