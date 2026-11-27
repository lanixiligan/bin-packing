# 🚚 Truck Loading Optimizer

A small demo of the **bin packing problem**: load every shipment into trucks of the same capacity using
the fewest trucks. It packs with **Google OR-Tools CP-SAT**, which searches every possible loading for
the fewest trucks (10 s limit) and proves when no better one exists, then animates the loading in 2D or
3D. A quick first-fit packing gives CP-SAT its starting point; CP-SAT improves on it.

The summary compares the answer with the **lower bound**: no packing can use fewer trucks than
⌈total ÷ capacity⌉ in any dimension. When CP-SAT reaches the bound, or proves optimality, the answer is
the best possible.

Extras:

- **Pallets.** Each shipment can take pallet spaces, and the trucks can have a pallet limit. Pallets are
  drawn at real size (Australian 1165 × 1165 mm pallets, two across a 2.4 m deck) as a top-down deck
  plan in 2D and on real-length trailers in 3D.
- **Dangerous goods.** Shipments can carry an ADG class (or food / fire-risk) and up to 4 subsidiary
  hazards. Incompatible goods (ADG Code Table 9.1) never share a truck, in either method. The *ADG +
  Northline* rule set also refuses goods Northline won't carry. The matrix comes from ADG Edition 7.8:
  check it against Edition 7.9 (mandatory from 1 October 2025).
- 🎲 **Random shipments** come from a small catalogue where each item has its own DG data (Paint =
  Class 3, Methanol = 3 + sub 6.1, Rice = food, …).

**Why not a simple rule?** With capacity 1000 and shipments `560, 490, 440, 370, 360, 340, 190, 150` kg
(paste them with *Paste a list of weights…*), "heaviest first into the first truck with room" needs 4
trucks. CP-SAT finds 3 (for example 560+440, 490+340+150, 370+360+190), and 3 is the lower bound.

---

## Layout

```
bin-packing/
├── backend/                 Python 3.12, FastAPI, OR-Tools (no database)
│   ├── app/
│   │   ├── main.py          the app: GET /api/health, POST /api/solve
│   │   ├── routers/demo.py  the /api/solve endpoint
│   │   ├── solver.py        the OR-Tools CP-SAT model: weight (and pallets), with DG segregation
│   │   └── dg.py            dangerous goods: ADG Table 9.1/9.2 segregation, Northline acceptance
│   └── tests/               pytest
├── frontend/                React 19 + Vite, three.js for the 3D view, plain CSS
│   └── src/
│       ├── demo/            the page
│       ├── components/      shipment form, hazard picker, 2D and 3D truck views, deck geometry
│       └── dg/              the same DG rules in TypeScript (for the hazard picker)
├── scripts/dev.sh           runs the API and the web app together
└── Makefile                 `make help` lists every target
```

---

## Setup (once)

You need Python 3.12+ and Node.js 20.19+ or 22.12+ (`node --version`; install a newer one with
[nvm](https://github.com/nvm-sh/nvm) if needed).

```bash
cd ~/Projects/bin-packing
make install      # backend/.venv with the Python packages + frontend/node_modules
```

<details>
<summary>The same without <code>make</code></summary>

```bash
python3 -m venv backend/.venv
backend/.venv/bin/pip install -r backend/requirements-dev.txt
cd frontend && npm install
```

</details>

## Run

```bash
make dev
```

This starts the API on <http://localhost:8000> (Swagger at `/docs`) and the web app on
**<http://localhost:5173>**; Ctrl+C stops both. Other ports: `API_PORT=8010 WEB_PORT=5180 scripts/dev.sh`.
The web app forwards `/api` to the API, so it needs both running.

## Tests

```bash
make test     # pytest + frontend unit tests
make lint     # ruff + ESLint and tsc
make build    # production build of the web app
```

---

## API

`POST /api/solve` (public, stateless)

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

The response:

| Field | Notes |
|---|---|
| `num_trucks`, `trucks` | The packing: each truck has its `shipments`, `load`, `empty` (kg) and `fill_percent` |
| `optimal`, `status` | `true` when proven optimal (or equal to the lower bound); the CP-SAT status: `OPTIMAL`, `FEASIBLE`, or `UNKNOWN` when it found nothing in time and its first-fit starting packing is returned |
| `lower_bound`, `lower_bounds` | No packing can use fewer trucks; the bound per limited dimension (`weight`, `pallets`) |
| `segregated` | `true` when some dangerous goods must travel apart (the lower bound ignores that) |
| `capacity`, `total_weight`, `total_pallets` | The inputs' totals; `max_pallets` is echoed when sent |
| `solve_time_ms`, `time_limit_s` | How long CP-SAT ran, and its limit |
| `drop_order` | Shipment ids truck by truck, for the loading animation |

Per-shipment `pallets` is echoed only when sent.

Errors: 400 for shipments that can never fit (too heavy, too many pallets) or that Northline refuses,
422 for invalid input, 429 while 2 solves are already running.

Set `CORS_ORIGINS` (comma-separated) to allow other browser origins to call the API directly.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| The page says it can't reach the backend | Start it with `make dev` (or `make api`) and check the port |
| `externally-managed-environment` from pip | Use `make install`, which installs into `backend/.venv` |
| `npm run dev` fails with a Node version error | Install a newer Node with nvm |
| Port 8000 or 5173 is in use | `API_PORT=8010 WEB_PORT=5180 scripts/dev.sh` |
