# 🚚 Truck Load Planner

Given freight (pallets or containers) and an Australian vehicle, the planner works out **whether the
load fits, where each item goes, and what capacity is left**. It also estimates axle group loads
against General or Higher Mass Limits, and warns about height, refrigeration, stacking and
multi-drop order. It can also suggest the smallest vehicle that fits.

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
  - **Pallets:** stacks pallets of the same type and stop, loads the last drop at the front (LIFO),
    and fills rows across the deck, rotating pallets where that fits more. It then reorders rows
    within each stop to bring heavy rows towards the axle centre.
  - **Containers:** looks up the vehicle's allowed combinations.
  - **Axle loads:** a static beam model, deck by deck through the kingpins.
- **UI:** three steps.
  1. Choose a vehicle from cards, or ask for a suggestion.
  2. Add freight: editable lines, presets, CSV paste or import, undo.
  3. Review the plan.

  The plan shows a to-scale top-down deck view, coloured by stop, weight or type, plus a side
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
│   │   ├── lib/                 units, freight validation, CSV, colours, export
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
      "gross_weight_kg": 820, "height_mm": 1200, "stackable": false, "stop": 2 },
    { "id": "dry", "kind": "pallet", "type_id": "EURO", "quantity": 4, "gross_weight_kg": 400,
      "height_mm": 900, "stackable": true, "stop": 1 }
  ],
  "overrides": { "vehicles": { "SEMI_TRAILER": { "max_payload_kg": 22000 } } }
}
```

| Field | Notes |
|---|---|
| `vehicle_id` | A vehicle id from `/api/reference`, or `"suggest"` for the smallest vehicle that fits |
| `body_type` | A body id, or `null` for the vehicle's default. In suggest mode, vehicles without it are skipped |
| `mass_scheme` | `"GML"` (default) or `"HML"` |
| `items[]` | Up to 500 units in total. `gross_weight_kg` is per unit, including the pallet. `height_mm` applies to pallets only. `stop` 1 is the first drop |
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
**bin packing problem**: load every shipment into identical trucks using the fewest trucks. Google
OR-Tools CP-SAT searches for the best loading (10 s limit, warm-started from first-fit decreasing) and
proves when no better one exists, then the loading drops into a 2D deck plan or a 3D view of the trucks.
The summary compares the answer with the lower bound, ⌈total ÷ capacity⌉ per dimension.

Shipments can take pallet spaces (the trucks can have a pallet limit) and carry an ADG class (or food /
fire-risk) with up to 4 subsidiary hazards. Incompatible goods (ADG Code Table 9.1) never share a truck,
and the *ADG + Northline* rule set also refuses goods Northline won't carry. *Load random shipments*
draws from a small catalogue where each item has its own DG data (Paint = Class 3, Methanol = 3 +
sub 6.1, Rice = food, …). The page has its own entry point (`frontend/demo.html`, `src/demo/`) and
shares only the design tokens, base styles and DG rules with the planner. three.js loads only when the
3D view is opened.

### `POST /api/solve`

```json
{
  "capacity": 1000,
  "max_pallets": 8,
  "rule_set": "adg",
  "shipments": [
    { "name": "Paint 01", "weight": 300, "pallets": 1, "dg_class": "3" },
    { "name": "Oxygen cylinders 02", "weight": 200, "dg_class": "2.2", "subsidiary": ["5.1"] }
  ]
}
```

| Field | Notes |
|---|---|
| `capacity` | Truck capacity in kg (whole number) |
| `max_pallets` | Optional pallet spaces per truck (1–100); omit for no pallet limit |
| `rule_set` | `"adg"` (default) or `"northline"` |
| `shipments[].weight` | kg, whole number, at most `capacity` |
| `shipments[].pallets` | Optional pallet spaces (0–100, default 0 = loose freight) |
| `shipments[].dg_class` | Optional: a DG class (`"1"`…`"9"`), `"food"` or `"fire_risk"` |
| `shipments[].subsidiary` | Optional, with a DG class only: up to 4 subsidiary hazards |

The response has `num_trucks` and `trucks` (each with its `shipments`, `load`, `empty` and
`fill_percent`), `optimal` and the CP-SAT `status`, `lower_bound` and `lower_bounds` per dimension,
`segregated` (some dangerous goods must travel apart), the input totals, `solve_time_ms`,
`time_limit_s`, and `drop_order` for the loading animation.

Errors: 400 for shipments that can never fit (too heavy, too many pallets) or that Northline refuses,
422 for invalid input, 429 while 2 solves are already running.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| The page says it can't reach the planner | Start it with `make dev` (or `make api`) and check the port |
| `externally-managed-environment` from pip | Use `make install`, which installs into `backend/.venv` |
| `npm run dev` fails with a Node version error | Install a newer Node with nvm |
| Port 8000 or 5173 is in use | `API_PORT=8010 WEB_PORT=5180 scripts/dev.sh` |
