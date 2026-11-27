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
│   │   ├── main.py              GET /api/health, mounts the planner router
│   │   ├── routers/planner.py   GET /api/reference, POST /api/plan
│   │   ├── reference/           reference data (schemas + pallets, containers, bodies, vehicles)
│   │   ├── planner/             models, LoadPlanner interface, heuristic, checks, axles, suggest
│   │   └── dg.py                ADG dangerous goods segregation (kept for wiring in later)
│   ├── scripts/export_fixtures.py   sample API responses for the frontend tests
│   └── tests/                   pytest (factories.py has small test vehicles)
├── frontend/                    React 19 + Vite + TypeScript, plain CSS, Vitest
│   └── src/planner/
│       ├── PlannerApp.tsx       the page: state, auto-planning, layout
│       ├── api/                 typed client and types mirroring the backend models
│       ├── components/          VehiclePicker, FreightTable, LoadPlanView (deck, elevation,
│       │                        legend, table), PlanStatus, UtilisationSummary, AxleLoadPanel,
│       │                        WarningsList, ExportMenu, EmptyState, Disclaimer
│       ├── lib/                 units, freight validation, CSV, colours, export
│       └── styles/              design tokens, base styles, print styles
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
make test       # pytest + Vitest component tests + the DG rules port
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

## Troubleshooting

| Problem | Fix |
|---|---|
| The page says it can't reach the planner | Start it with `make dev` (or `make api`) and check the port |
| `externally-managed-environment` from pip | Use `make install`, which installs into `backend/.venv` |
| `npm run dev` fails with a Node version error | Install a newer Node with nvm |
| Port 8000 or 5173 is in use | `API_PORT=8010 WEB_PORT=5180 scripts/dev.sh` |
