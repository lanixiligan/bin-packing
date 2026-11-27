# 🚚 Bin packing demo

Load every shipment into identical trucks, using **as few trucks as possible**, and see where each one goes.

- **Shipments** have real sizes: a pallet (AU, Euro, …) with a height, or a loose item such as pipes with its own length × width × height. Stackable shipments can stand on others with the same footprint.
- **Solver:** a quick greedy packing first (biggest item first, stack it if possible, otherwise put it in the front-most free spot, otherwise open a new truck). Then Google OR-Tools CP-SAT tries to improve it for up to 10 s and proves when no packing uses fewer trucks.
- **Page:** pick a vehicle, add or randomise shipments, press Solve. Each truck's decks are drawn to scale from the solver's positions, and there's a 3D view.

The full load planner (axle loads, dangerous goods, vehicle suggestions, export) lives on the
[`full-planner`](../../tree/full-planner) branch.

## Layout

```
backend/    Python 3.12, FastAPI, OR-Tools
  app/solver.py          greedy + CP-SAT bin packing
  app/routers/demo.py    GET /api/reference, POST /api/solve
  app/demo_models.py     request and response models
  app/reference/         pallets, bodies, vehicles (the single source of truth)
frontend/   React 19 + Vite, plain CSS
  src/demo/              the page
  src/shared/            vehicle picker, API client, design tokens, test setup
```

## Run

You need Python 3.12+ and Node.js 20.19+ or 22.12+.

```bash
make install   # once
make dev       # API on :8000, page on http://localhost:5173
make test      # pytest + Vitest + node tests
make lint
```

## API

`POST /api/solve`

```json
{
  "vehicle_id": "RIGID_MEDIUM",
  "shipments": [
    { "name": "Paint 01", "weight": 420, "pallet_type": "AU_STD", "height_mm": 1200, "stackable": true },
    { "name": "Pipes 02", "weight": 250, "kind": "loose", "length_mm": 4600, "width_mm": 400, "height_mm": 300 }
  ]
}
```

Up to 40 shipments. Units are mm and kg. The response has `num_trucks`, each truck's shipments with
their deck, x/y/z position, rotation and stack level, the `lower_bound`, whether it's `optimal`, and
`drop_order` for the loading animation. Full models: `backend/app/demo_models.py`.
