# 🚚 Truck Load Planner

Given freight (pallets or containers) and an Australian vehicle, the planner works out **whether the
load fits, where each item goes, and what capacity is left**. It also estimates axle group loads
against General or Higher Mass Limits, and warns about height, refrigeration, stacking and
dangerous goods: segregation under the ADG Code, plus Northline's acceptance rules. It can also suggest the smallest vehicle that fits.

> **Planning tool only.** Results are estimates. They are not compliance with the NTC Load Restraint
> Guide or with mass and dimension limits, and every capacity is a typical value you can override.

- **Reference data:** six pallet types (AU standard 1165 × 1165 by default), ISO and domestic
  containers (reefers flagged), 12 body types, and seven vehicle configurations from a 4–6 t rigid to
  a road train. The configurations carry deck geometry, axle groups with GML/HML limits, allowed
  container combinations (a B-double takes 1 × 20' + 1 × 40', never 2 × 40'), and permit notes. All
  of it lives in `backend/app/reference/`, which is the single source of truth. The UI reads it from
  `GET /api/reference`.
- **Optimizer:** a documented heuristic behind a `LoadPlanner` interface, so a better solver can
  replace it.
  - **Pallets:** stacks pallets of the same type and fills rows across the deck, rotating pallets
    where that fits more. It then brings heavy rows towards the axles and centres each deck's load
    where the axles have the most spare capacity.
  - **Containers:** looks up the vehicle's allowed combinations.
  - **Axle loads:** a static beam model, deck by deck through the kingpins.
- **UI:** three steps.
  1. Choose a vehicle from cards, or ask for a suggestion.
  2. Add freight: editable lines with ADG dangerous goods data, or random freight, with undo.
  3. Review the plan.

  The plan shows a to-scale top-down deck view, coloured by DG class, weight or type, plus a side
  elevation against the 4.3 m limit, axle load bars, utilisation, warnings with next steps, and CSV
  and print export. It supports light and dark themes and works from phone width to desktop.

Units are millimetres, kilograms and cubic metres everywhere. The UI converts only for display, and
you can switch between mm · kg and m · t.

---

## Layout

```
bin-packing/
├── backend/                     Python 3.12, FastAPI, pydantic (no database)
│   ├── app/
│   │   ├── main.py              GET /api/health, mounts the planner and demo routers
│   │   ├── routers/planner.py   GET /api/reference, POST /api/plan
│   │   ├── routers/demo.py      POST /api/solve (bin-packing demo)
│   │   ├── reference/           reference data (schemas + pallets, containers, bodies, vehicles)
│   │   ├── planner/             models, LoadPlanner interface, heuristic, checks, axles, suggest
│   │   ├── solver.py            OR-Tools CP-SAT bin packing for the demo
│   │   └── dg.py                ADG dangerous goods segregation
│   ├── scripts/export_fixtures.py   sample API responses for the frontend tests
│   └── tests/                   pytest (factories.py has small test vehicles)
├── frontend/                    React 19 + Vite + TypeScript, plain CSS, Vitest
│   ├── src/planner/
│   │   ├── PlannerApp.tsx       the page: state, auto-planning, layout
│   │   ├── api/                 typed client and types mirroring the backend models
│   │   ├── components/          VehiclePicker, FreightTable, LoadPlanView (deck, elevation,
│   │   │                        legend, table), PlanStatus, UtilisationSummary, AxleLoadPanel,
│   │   │                        WarningsList, ExportMenu, EmptyState, Disclaimer
│   │   ├── lib/                 units, freight validation, random freight, DG, colours, export
│   │   └── styles/              design tokens, base styles, print styles
│   ├── src/demo/                the bin-packing demo page (demo.html), its own entry point
│   └── src/dg/                  ADG segregation rules port, DG class diamonds
├── scripts/dev.sh               runs the API and the web app together
└── Makefile                     `make help` lists every target
```

---

## Setup (once)

You need Python 3.12+ and Node.js 20.19+ or 22.12+.

```bash
make install      # backend/.venv + frontend/node_modules
```

## Run

```bash
make dev
```

The API runs on <http://localhost:8000> (Swagger at `/docs`) and the web app on
**<http://localhost:5173>**. The web app forwards `/api` to the API. Other ports:
`API_PORT=8010 WEB_PORT=5180 scripts/dev.sh`.

## Tests

```bash
make test       # pytest + Vitest component tests + node tests (DG rules port, demo helpers)
make lint       # ruff + ESLint and tsc
make build      # production build of the web app
make fixtures   # regenerate the frontend's sample API responses after planner changes
```

---

## API

### `POST /api/plan`

```json
{
  "vehicle_id": "SEMI_TRAILER",
  "body_type": null,
  "mass_scheme": "GML",
  "items": [
    { "id": "bev", "label": "Beverages", "kind": "pallet", "type_id": "AU_STD", "quantity": 6,
      "gross_weight_kg": 820, "height_mm": 1200, "stackable": false },
    { "id": "dry", "kind": "pallet", "type_id": "EURO", "quantity": 4, "gross_weight_kg": 400,
      "height_mm": 900, "stackable": true }
  ],
  "overrides": { "vehicles": { "SEMI_TRAILER": { "max_payload_kg": 22000 } } }
}
```

| Field | Notes |
|---|---|
| `vehicle_id` | A vehicle id from `/api/reference`, or `"suggest"` for the smallest vehicle that fits |
| `body_type` | A body id, or `null` for the vehicle's default. In suggest mode, vehicles without it are skipped |
| `mass_scheme` | `"GML"` (default) or `"HML"` |
| `rule_set` | Optional: `"northline"` (default, ADG Code plus Northline's acceptance rules) or `"adg"` (ADG Code only). The page always uses the default |
| `items[]` | Up to 500 units in total. `gross_weight_kg` is per unit, including the pallet. `height_mm` applies to pallets only. `dg` is optional dangerous goods data |
| `overrides` | Optional partial reference data, deep-merged and re-validated (lists replace) |

The response includes:
- `fits`, `reasons` and `warnings`: each warning has a code, severity, plain-language message,
  suggestion and the item ids it concerns.
- `placements`: deck, x/y/z in mm, size, rotation, stack and level for every unit.
- `unplaced`, `utilisation` (pallet spaces, TEU, payload, volume), `axle_loads` (load, limit, status),
  `total_weight_kg` and `max_load_height_mm`.
- `tried`: every vehicle tried, in suggest mode.

Errors are 400 for an unknown vehicle or body, or for invalid overrides, and 422 for invalid input
(e.g. repeated line ids or more than 500 units).

### `GET /api/reference`

Returns all pallets, pallet defaults, containers, bodies and vehicles.

Set `CORS_ORIGINS` (comma-separated) to allow other browser origins to call the API directly.

---

## Bin packing demo

A separate page at **<http://localhost:5173/demo.html>** (linked from the planner header) shows the
**bin packing problem**: load every shipment into identical trucks using the fewest trucks. The
trucks are a vehicle from the planner's list (a medium rigid by default; *Change* opens the same
vehicle cards), and every shipment has a real size:

- **On a pallet:** a pallet type (AU 1165 × 1165, Euro 1200 × 800, …), the total height and the
  weight. **Loose:** its own length × width × height, for long or odd items such as pipes.
- **Stackable** shipments can stand on others with the same footprint while the column fits under
  the truck's inside height. Everything else stands on the deck floor.

Google OR-Tools CP-SAT places every footprint on a deck (turned 90° when that fits better, never
overlapping), keeps each truck within its payload, refuses goods Northline won't carry and keeps
incompatible dangerous goods (ADG Code Table 9.1) apart. It searches for 10 s at most, starting from a quick greedy packing, and proves
when no packing uses fewer trucks. The summary compares the answer with lower bounds for weight,
volume and the floor area of non-stackable items. The page draws each truck's decks to scale from
the returned positions, with a 3D view (three.js loads only when it's opened). *Random shipments*
draws from a small catalogue where each item has its own size and DG data (Paint = AU pallet,
1.2 m, stackable, Class 3; Pipes = loose, 4.6 × 0.4 × 0.3 m; …). The page has its own entry point
(`frontend/demo.html`, `src/demo/`) and shares the design tokens, base styles, DG rules, reference
data and vehicle picker with the planner.

### `POST /api/solve`

```json
{
  "vehicle_id": "RIGID_MEDIUM",
  "body_type": null,
  "shipments": [
    { "name": "Paint 01", "weight": 420, "pallet_type": "AU_STD", "height_mm": 1200,
      "stackable": true, "dg_class": "3" },
    { "name": "Pipes 02", "weight": 250, "kind": "loose", "length_mm": 4600, "width_mm": 400,
      "height_mm": 300 }
  ]
}
```

| Field | Notes |
|---|---|
| `vehicle_id`, `body_type` | A vehicle and body from `/api/reference` (the body must carry pallets) |
| `rule_set` | Optional: `"northline"` (default, ADG Code plus Northline's acceptance rules) or `"adg"` (ADG Code only). The page always uses the default |
| `shipments[]` | Up to 40. `weight` in kg, `height_mm` the total height |
| `shipments[].kind` | `"pallet"` (default, with `pallet_type`, default AU_STD) or `"loose"` (with `length_mm` and `width_mm`) |
| `shipments[].stackable` | Optional, default false |
| `shipments[].dg_class`, `subsidiary` | Optional: a DG class (`"1"`…`"9"`), `"food"` or `"fire_risk"`, and up to 4 subsidiary hazards |

The full request and response models are in `backend/app/demo_models.py`. The response has the
vehicle and its per-truck capacity (payload, decks, floor area, volume), `num_trucks` and `trucks`
(each with its shipments and their deck, x/y/z position, rotation and stack level, plus weight and
floor use), `optimal` and the CP-SAT `status`, `lower_bound` and `lower_bounds`, `segregated`,
`solve_time_ms` and `drop_order` for the loading animation.

Errors: 400 for an unknown vehicle, body or pallet type, a body that doesn't carry pallets,
shipments that can never fit (too long, too wide, too tall or too heavy, each named) or that
Northline refuses; 422 for invalid input; 429 while 2 solves are already running.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| The page says it can't reach the planner | Start it with `make dev` (or `make api`) and check the port |
| `externally-managed-environment` from pip | Use `make install`, which installs into `backend/.venv` |
| `npm run dev` fails with a Node version error | Install a newer Node with nvm |
| Port 8000 or 5173 is in use | `API_PORT=8010 WEB_PORT=5180 scripts/dev.sh` |
