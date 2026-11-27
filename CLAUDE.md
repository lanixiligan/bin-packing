# CLAUDE.md

## Context

- I'm an intern based in Cairo, Egypt, and this is my internship project. It is not a production
  system. It has no real customers, no live operations, and no compliance obligations.
- The reference data is Australian (vehicles, pallets, the ADG Code, Northline's rules, GML/HML).
  Treat it as sample data that already exists. Don't make it more accurate, complete or "compliant"
  unless I ask.

## The priority: visualizing bin packing

The point of this project is to **show the bin packing problem clearly**: how items get packed into
trucks, how few trucks are needed, and why. The deck views, the 3D view, the per-truck tabs, and the
comparison of the result with the lower bounds are the core of it.

Before you start a change, ask whether it makes the packing easier to see or understand. If it
doesn't, it's probably not needed. Check with me first.

## Don't over-engineer

- Make the smallest change that works. Edit existing files rather than adding new modules or layers.
- Don't add abstractions, plugin systems, config frameworks, databases, auth, caching, queues, or
  deployment infrastructure.
- Don't extend the regulatory side (DG segregation, axle mass schemes, permits, load restraint,
  acceptance rules) unless I ask for it. It's already more than enough.
- Don't add dependencies without asking.
- Don't refactor or "clean up" nearby code while doing something else.
- If a task looks like it needs something big, stop and propose the simple version first.
- I'm learning, so when you do something non-obvious, explain it in a sentence or two.

## Where things are

- **Bin packing view** (the most direct visualization) is in the load planner, as "Split across
  trucks": `frontend/src/planner/`, `backend/app/planner/fleet.py`, `backend/app/solver.py`. Shared
  data such as example shipments lives in `frontend/src/examples/`.
- **Truck load planner:** `frontend/src/planner/`, `backend/app/planner/`
- **Reference data** (the single source of truth): `backend/app/reference/`
- The README has the API details.

## Commands

```bash
make install   # backend/.venv + frontend/node_modules
make dev       # API on :8000, web app on :5173
make test      # pytest + Vitest + node tests
make lint      # ruff + ESLint + tsc
make build     # production build of the web app
make fixtures  # regenerate frontend sample responses after planner output changes
```

## Conventions

- Units are mm, kg and m³ everywhere. The UI converts them only for display.
- Freight is entered as **lines**: one row of the freight list per kind of goods (quantity × the
  same pallet/item, with one unit's size and weight), like a consignment note. The API calls them
  `items`. A line's **units** are its individual pallets or items (`unit_id` "<item_id>#n"), and
  each one is placed on its own. Call them "lines" in the UI. No consignments or orders above lines.
- Backend: Python 3.12, FastAPI, pydantic, no database.
- Frontend: React 19, Vite, TypeScript, plain CSS. Don't add a UI library or Tailwind.
- Keep the existing tests passing. Add a test when you change logic, not for every visual tweak.
