# 🚚 Freight Operations Platform

A local web app for a small freight company. Customers place delivery orders, a dispatcher turns them
into truck loads with an optimiser, and drivers deliver them with proof of delivery. It grew out of a
**1D bin packing demo** (FFD vs OR-Tools CP-SAT), which still runs at `/demo`.

| Role | What they do | Pages |
|---|---|---|
| **Customer** | Keep an item catalogue and address book, build and submit orders with a price quote, track status and the full history | `/portal/*` |
| **Dispatcher** | Accept or reject orders, zone addresses, run the optimiser per delivery date + zone, edit and lock load plans, assign vehicles and drivers, manage the fleet, export monthly invoices | `/ops/*` |
| **Driver** | See today's run on a phone, mark pickups, deliver with a signature name and photo, report problems | `/driver/*` |

---

## Architecture

```
bin-packing/
├── backend/                  Python 3.12, FastAPI, SQLModel / SQLAlchemy 2 (async), Alembic
│   ├── app/
│   │   ├── main.py           app, routers under /api, error handlers
│   │   ├── models.py         all tables and status enums
│   │   ├── schemas.py        request / response models (the API contract)
│   │   ├── auth.py           fastapi-users, JWT, role dependencies
│   │   ├── lifecycle.py      the ONLY place that changes Order.status (+ writes OrderEvent)
│   │   ├── pricing.py        quotes (cubic weight × zone rate) and monthly invoices / CSV
│   │   ├── solver/           1D demo solver + multi-dimension FFD and CP-SAT (weight, m³, pallets)
│   │   ├── workers.py        arq worker: runs solver jobs in the background
│   │   └── routers/          portal (customer), ops (dispatcher), driver, jobs, demo
│   ├── alembic/              migrations
│   ├── scripts/seed.py       demo data
│   └── tests/                pytest on a real Postgres (one test database per checkout)
├── frontend/                 React 19 + Vite, React Router, TanStack Query, plain CSS
│   └── src/
│       ├── api/              typed client generated from the OpenAPI schema, mock API for dev
│       ├── auth/, shell/     login, role guards, layout, shared UI
│       ├── portal/           customer pages
│       ├── ops/              dispatcher pages
│       ├── driver/           phone-first driver pages
│       ├── components/       2D and 3D truck views (weight / volume / pallet fill)
│       └── demo/             the original 1D bin packing demo
├── e2e/                      Playwright walkthrough of the whole order loop over real HTTP
├── docs/api.md               API contract: every endpoint, lifecycle, planning and driver flows
├── docker-compose.yml        Postgres 16 + Redis 7
├── scripts/                  services.sh (Postgres + Redis with or without Docker), dev.sh
└── Makefile                  `make help` lists every target
```

**How a plan is made.** `POST /api/ops/plans` reserves the accepted orders for one delivery date and
zone, checks every unit fits the chosen vehicle profile, and queues a job in Redis. The arq worker
expands order lines into units and packs them twice: **FFD** (fast rule of thumb) and **CP-SAT**
(optimiser, warm-started from FFD, 10 s limit, one capacity constraint per limited dimension). The UI
polls `GET /api/jobs/{id}` and shows both answers side by side in the truck views, with the lower bound
(the maximum over dimensions of `ceil(total / capacity)`).

See [`docs/api.md`](docs/api.md) for the full API, and `/docs` on a running backend for Swagger.

---

## Setup (once)

### 1. System packages (Linux Mint / Ubuntu)

```bash
sudo apt update
sudo apt install -y python3 python3-venv python3-pip curl git make
```

Docker is optional. With it, Postgres and Redis run from `docker-compose.yml`. Without it,
`scripts/services.sh` downloads Postgres and Redis binaries from pip packages into `.tools/` the first
time (no `sudo` needed).

### 2. Node.js 20.19+ or 22.12+

Check with `node --version`. If it's missing or older (the `apt` version often is), install it with nvm:

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
source ~/.bashrc
nvm install --lts
nvm use --lts
```

### 3. The project

```bash
cd ~/Projects/bin-packing
cp .env.example .env        # local defaults (APP_ENV=dev); change JWT_SECRET outside development
make install                # backend/.venv with the Python packages + frontend/node_modules
make seed                   # starts Postgres + Redis, applies migrations, loads the demo data
```

<details>
<summary>The same steps without <code>make</code></summary>

```bash
cd ~/Projects/bin-packing
cp .env.example .env

# Backend: virtual environment and packages (OR-Tools is ~25 MB)
python3 -m venv backend/.venv
backend/.venv/bin/pip install -r backend/requirements-dev.txt

# Frontend packages
cd frontend && npm install && cd ..

# Postgres + Redis, database tables, demo data
scripts/services.sh start
cd backend
.venv/bin/alembic upgrade head
.venv/bin/python -m scripts.seed
cd ..
```

</details>

## Run

```bash
cd ~/Projects/bin-packing
make dev
```

This starts three processes together, and Ctrl+C stops all three:

| Process | Address |
|---|---|
| API | <http://localhost:8000> (Swagger at `/docs`) |
| Solver worker | runs the optimiser jobs in the background |
| Web app | **<http://localhost:5173>**, open this one |

Other ports: `API_PORT=8010 WEB_PORT=5180 scripts/dev.sh`.

> `npm run dev` on its own only starts the web app. Without the API you can't log in, and without the
> worker a plan stays "queued". Use `make dev`, or start all three yourself.

To start them in separate terminals instead (Postgres and Redis must be running: `make services`):

```bash
# Terminal 1: API
cd ~/Projects/bin-packing/backend && .venv/bin/uvicorn app.main:app --reload --port 8000

# Terminal 2: solver worker
cd ~/Projects/bin-packing/backend && .venv/bin/arq app.workers.WorkerSettings

# Terminal 3: web app
cd ~/Projects/bin-packing/frontend && npm run dev
```

Run only one worker at a time: a worker that starts up fails any job another worker is still running.

Other commands:

| Command | What it does |
|---|---|
| `make seed` | Reset the database to the demo data (also fixes a failed login after testing) |
| `make services-status` / `make services-stop` | Check or stop Postgres and Redis |
| `cd frontend && npm run dev:mock` | The UI with an in-browser mock API, no backend needed. Any password works; an e-mail containing "dispatch" or "driver" picks that role |

## Seed logins

**In development you don't need to type these.** The login page shows a **Log in as…** panel with one
button per seed account: click a name and you're in. Log out to switch roles. The panel only exists in
the Vite dev server (`make dev`, `npm run dev`, `npm run dev:mock`), never in a production build
(`npm run build`), so the known password isn't shipped.

To type them instead, all passwords are `demo-pass-123`:

| Role | E-mail |
|---|---|
| Customer (Acme Hardware Pty Ltd) | `alice@acme.example.com`, `bob@acme.example.com` |
| Dispatcher | `dispatch@freightco.example.com` |
| Driver | `driver1@freightco.example.com`, `driver2@freightco.example.com` |

The seed has about 36 orders in every status, three zones (NORTH, SOUTH, WEST), four vehicles with
different capacity mixes, accepted orders for today and tomorrow ready to plan, a run today for both
drivers, and delivered orders last month for the invoices page. `make seed` resets the database.

---

## The workflow

```
draft ─► submitted ─► accepted ─► planned ─► picked_up ─► in_transit ─► delivered
            └─► rejected                └──────────┴────────────┴─► exception
draft / submitted ─► cancelled
```

1. **Customer** creates an order (items and quantities, pickup and delivery address, date and time
   window), sees the quote, and submits it. Price = `max(kg, m³ × 250)` × the delivery zone's rate.
2. **Dispatcher** accepts it (or rejects it with a reason) and makes sure the delivery address has a zone.
3. **Dispatcher** opens *Plans*, picks the batch (date + zone) and a vehicle profile, and runs the
   optimiser. When the job finishes, they compare FFD and OR-Tools, save one as a draft, move lines
   between loads if needed (the server re-checks capacity), lock the plan, and assign a vehicle and a
   driver to each load. Locking moves the orders to `planned`.
4. **Driver** opens today's run, marks the pickup, then delivers with the receiver's name and a photo
   (or reports a problem with a note).
5. **Customer** sees `delivered`, the proof of delivery and every step in the order's history.
6. **Dispatcher** downloads the month's invoice CSV per customer company.

Every status change goes through `backend/app/lifecycle.py`, which allows only valid transitions for the
right role and writes an event with the time, the actor and an optional note.

---

## Tests

```bash
make test          # ruff + pytest (needs Postgres; starts it if needed)
make lint          # backend ruff + frontend ESLint and tsc
make build         # production build of the web app
make e2e           # Playwright walkthrough against a running stack (make dev first)
cd frontend && npm test   # frontend unit tests (pure helpers and the mock API)
```

`make e2e` drives the whole loop over real HTTP with the real worker: customer submits → dispatcher
accepts → plans → locks → assigns → driver picks up and delivers with POD → customer sees the timeline →
the order is on the month's invoice CSV. Point it elsewhere with `E2E_API_URL` and `E2E_WEB_URL`.

After changing an endpoint or schema, run `make api-types` to regenerate `frontend/src/api/schema.d.ts`.

---

## The 1D bin packing demo (`/demo`)

The original demo is still there: shipments (items with a weight) go into trucks (bins with the same
capacity) using the fewest trucks. It solves the same input with **FFD** (sort heaviest first, put each
in the first truck with room) and **OR-Tools CP-SAT** (searches for the fewest trucks and can prove it's
optimal), and animates both in 2D bars or 3D trucks. `POST /api/solve` is its API.

**A case where FFD loses:** capacity 1000, shipments `560, 490, 440, 370, 360, 340, 190, 150` kg. The
lower bound is 3. FFD needs 4 trucks (560+440, 490+370, 360+340+190, then 150 fits nowhere); CP-SAT
finds 3, for example 560+440, 490+340+150, 370+360+190.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `make seed` or `make test` can't connect to Postgres | `make services-status`, then `make services` |
| The web app says it can't reach the backend | Start it with `make dev` (or `make api`) and check the port |
| A plan stays "queued" | The worker isn't running: `make worker` (or use `make dev`, which starts it) |
| `externally-managed-environment` from pip | Use `make install`, which installs into `backend/.venv` |
| `npm run dev` fails with a Node version error | Install a newer Node with nvm |
| Port 8000 or 5173 is in use | `API_PORT=8010 WEB_PORT=5180 scripts/dev.sh` |
