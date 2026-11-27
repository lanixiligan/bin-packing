# 🚚 Truck Load Planner

Given freight (pallets, loose items such as pipes, or containers) and an Australian vehicle, the planner works out **whether the
load fits, where each item goes, and what capacity is left**. It also estimates axle group loads
against General or Higher Mass Limits, and warns about height, refrigeration, stacking and
dangerous goods: segregation under the ADG Code, plus Northline's acceptance rules. It can also suggest
the smallest vehicle that fits, or **split the load across the fewest trucks** of the chosen vehicle.

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
  - **Split across trucks** (pallets and loose items): up to 80 units, OR-Tools CP-SAT finds the
    fewest trucks and places every unit, with each axle group's limit as a constraint (the beam
    model is linear, so it fits the solver directly), and proves when no split uses fewer trucks.
    Bigger loads fill trucks one after another with the heuristic above, dangerous goods that can't
    travel together kept apart, and are marked "not proven". Every truck comes back as a full plan.
- **UI:** three steps.
  1. Choose a vehicle from cards, or ask for a suggestion.
  2. Add freight as **lines**: one line per kind of goods (e.g. "Rice, 4 × Euro pallet, 400 kg
     each, 1,000 mm high"), the way a consignment note lists freight. A line is pallet, loose or
     container freight with ADG dangerous goods data; its **units** are the individual pallets or
     items, and each one is placed on its own. Example shipments, random freight and pasted weights
     fill the list, with undo.
  3. Review the plan. When the freight doesn't fit one truck (too much, too heavy for the axles, or
     dangerous goods that can't share a vehicle), **Split across trucks** shows a tab per truck.
     This is the bin packing view: an "All trucks" tab draws every truck (or one 3D scene of them),
     and the number of trucks is compared with the weight, floor and volume lower bounds.

  The plan shows one view at a time: a to-scale top-down deck view, the side from either side
  against the 4.3 m limit, or the rear, coloured by line, DG class, weight or type, with DG
  diamonds and the pallet bases drawn brown. Below it: axle load bars, utilisation, warnings with
  next steps, and CSV and print export. It supports light and dark themes and works from phone width to desktop.

Units are millimetres, kilograms and cubic metres everywhere. The UI converts only for display, and
you can switch between mm · kg and m · t.

---

## Layout

```
bin-packing/
├── backend/                     Python 3.12, FastAPI, pydantic (no database)
│   ├── app/
│   │   ├── main.py              GET /api/health, mounts the planner router
│   │   ├── routers/planner.py   GET /api/reference, POST /api/plan, POST /api/plan/fleet
│   │   ├── reference/           reference data (schemas + pallets, containers, bodies, vehicles)
│   │   ├── planner/             models, LoadPlanner interface, heuristic, checks, axles, suggest, fleet
│   │   ├── solver.py            OR-Tools CP-SAT sized bin packing (split mode)
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
│   └── src/dg/                  ADG segregation rules port, DG placard colours and diamonds,
│                                the DG checker page (CheckerApp.tsx, served as checker.html)
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

The dangerous goods checker (can two DG classes travel together? ADG Table 9.1 / 9.2, with
Northline's rules) is at **<http://localhost:5173/checker.html>**, linked from the planner header.

## Tests

```bash
make test       # pytest + Vitest component tests + node tests (DG rules port)
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

### `POST /api/plan/fleet`

Same body as `POST /api/plan`, with a real `vehicle_id` (not `"suggest"`) and pallets or loose items
only (a loose item has `"kind": "loose"` with `length_mm`, `width_mm` and `height_mm`). The response
(`FleetResult` in `backend/app/planner/models.py`) has `num_trucks` and `trucks`, each a full
`/api/plan` result, plus `unplaced` units no truck of this type can take with the `reasons`,
`lower_bound` and `lower_bounds` (weight, floor, volume), `optimal`, `method` (`"exact"` or
`"heuristic"`), the CP-SAT `status` and `solve_time_ms`. Errors: 400 for containers, `"suggest"`, or
an unknown vehicle or body; 429 while 2 solves are already running.

### `GET /api/reference`

Returns all pallets, pallet defaults, containers, bodies and vehicles.

Set `CORS_ORIGINS` (comma-separated) to allow other browser origins to call the API directly.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| The page says it can't reach the planner | Start it with `make dev` (or `make api`) and check the port |
| `externally-managed-environment` from pip | Use `make install`, which installs into `backend/.venv` |
| `npm run dev` fails with a Node version error | Install a newer Node with nvm |
| Port 8000 or 5173 is in use | `API_PORT=8010 WEB_PORT=5180 scripts/dev.sh` |
