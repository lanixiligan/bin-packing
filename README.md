# 🚚 Truck Loading Optimizer: a 1D Bin Packing Demo

A small local web app that shows the **1D bin packing problem** with a freight example:

| Bin packing term | In our world |
|---|---|
| Item (with a size) | **Shipment** (with a weight in kg) |
| Bin (with a capacity) | **Truck** (all trucks have the same max load, e.g. 1000 kg) |
| Goal | Load **every** shipment using the **fewest trucks** |

The app solves the same shipments two ways and shows them side by side:

1. **FFD (First-Fit Decreasing)** is a quick rule of thumb. It sorts the shipments from heaviest to lightest. Each shipment goes in the first truck that still has room, and if none has room, it opens a new truck. It is very fast and usually good, but **not guaranteed** to find the best answer.
2. **OR-Tools CP-SAT** is Google's optimization solver. It searches for the plan with the fewest trucks and can **prove** that no better plan exists. It has a time limit of 10 seconds. If it runs out of time, it shows the best plan found so far and says the result is "not proven".

The **lower bound** is `ceil(total weight / capacity)`. No plan can ever use fewer trucks than this. If a method reaches the lower bound, its answer is definitely optimal.

---

## Project structure

```
bin-packing/
├── README.md
├── backend/                 Python + FastAPI + OR-Tools
│   ├── requirements.txt
│   ├── main.py              API: POST /solve, input validation
│   └── solver.py            FFD and the CP-SAT model (well commented)
└── frontend/                React + Vite
    ├── package.json
    ├── vite.config.js       forwards /solve to the backend on port 8000
    ├── index.html
    └── src/
        ├── main.jsx
        ├── App.jsx          state, form, summary, animation timer
        ├── App.css
        └── components/
            ├── ShipmentForm.jsx
            ├── ResultPanel.jsx
            └── Truck.jsx    one truck drawn as a bar of stacked shipments
```

---

## 1. One-time setup (Linux Mint / Ubuntu)

### System packages

```bash
sudo apt update
sudo apt install -y python3 python3-venv python3-pip curl git
```

### Node.js (via nvm)

Vite needs Node **20.19+ or 22.12+**. Check what you have:

```bash
node --version
```

If the command is not found, or the version is older than that (the version from `apt` often is), install Node with **nvm**:

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
# close and reopen your terminal (or run:  source ~/.bashrc)
nvm install --lts
nvm use --lts
node --version    # should now be v22 or newer
```

### Backend (Python virtual environment)

```bash
cd ~/Projects/bin-packing/backend
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
```

> OR-Tools is a big download (~25 MB), so the first install can take a minute.

### Frontend

```bash
cd ~/Projects/bin-packing/frontend
npm install
```

---

## 2. Running the app (two terminals)

**Terminal 1: backend**

```bash
cd ~/Projects/bin-packing/backend
source .venv/bin/activate
uvicorn main:app --reload --port 8000
```

You should see `Uvicorn running on http://127.0.0.1:8000`.
Interactive API docs: <http://localhost:8000/docs>

**Terminal 2: frontend**

```bash
cd ~/Projects/bin-packing/frontend
npm run dev
```

Open **<http://localhost:5173>** in your browser.

To stop either part, press `Ctrl+C` in its terminal.

---

## 3. Using the app

1. Set the **truck capacity** (default 1000 kg).
2. Add or remove shipments, or click **🎲 Load random shipments** (20 shipments, 50–600 kg each).
3. Click **▶ Solve**.
4. Watch the shipments drop into the trucks:
   * **FFD** loads them in the order the algorithm actually uses (heaviest first).
   * **OR-Tools** loads them truck by truck.
5. Compare the **summary** to see how many trucks each method used and the lower bound.

Each shipment keeps **the same color in both panels**, so you can see where each method put it. Hover over a block to see its full name and weight. Click **↻ Replay animation** to watch it again.

**Validation:** a shipment heavier than the truck capacity can never be loaded. Its row turns red and Solve shows an error that names it. The backend also checks this and rejects such input with HTTP 400.

### Demo tip: a case where FFD loses

FFD is often already optimal on random data. To show a case where it uses an extra truck, keep **capacity = 1000**, click **Clear all**, and add these 8 shipments:

```
560, 490, 440, 370, 360, 340, 190, 150   (kg)
```

The total is 2900 kg, so the lower bound is 3 trucks.

* **FFD needs 4 trucks.** It puts 560 + 440 in truck 1, 490 + 370 in truck 2 and 360 + 340 + 190 in truck 3. The last 150 kg shipment doesn't fit anywhere, so it opens a 4th truck.
* **OR-Tools uses 3 trucks**, for example 560 + 440, 490 + 340 + 150 and 370 + 360 + 190. There's more than one optimal split, so your screen may show a different one.

Picking the "first truck that fits" early on can leave awkward gaps later. An optimizer looks at the whole plan at once.

---

## 4. The API

`POST /solve`

```json
{
  "capacity": 1000,
  "shipments": [
    { "name": "Rice 01", "weight": 420 },
    { "name": "Steel 02", "weight": 310 }
  ]
}
```

The response looks like this (shortened):

```json
{
  "capacity": 1000,
  "total_weight": 730,
  "lower_bound": 1,
  "ffd": {
    "num_trucks": 1,
    "trucks": [ { "truck": 1, "shipments": [...], "load": 730, "empty": 270, "fill_percent": 73.0 } ],
    "solve_time_ms": 0.01,
    "hits_lower_bound": true,
    "drop_order": [0, 1]
  },
  "ortools": {
    "num_trucks": 1,
    "trucks": [...],
    "solve_time_ms": 12.3,
    "optimal": true,
    "status": "OPTIMAL",
    "time_limit_s": 10.0,
    "drop_order": [0, 1]
  }
}
```

Try it from the command line:

```bash
curl -s -X POST http://localhost:8000/solve \
  -H "Content-Type: application/json" \
  -d '{"capacity":1000,"shipments":[{"name":"A","weight":600},{"name":"B","weight":500},{"name":"C","weight":400}]}'
```

---

## 5. How the OR-Tools model works (in `backend/solver.py`)

* **Variables**
  * `x[i][t]` = 1 if shipment *i* goes in truck *t*
  * `y[t]` = 1 if truck *t* is used
* **Constraints**
  * Every shipment is in exactly one truck: `sum over t of x[i][t] = 1`
  * No truck is overloaded: `sum over i of weight[i] * x[i][t] <= capacity * y[t]`
  * Trucks are used in order (`y[t] >= y[t+1]`). This speeds up the search because the solver doesn't try the same plan with the trucks renumbered.
* **Objective:** minimize `sum of y[t]`, the number of trucks used.
* The FFD answer is given to the solver as a starting point (a *hint*). It also caps how many trucks the model needs to consider.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `The virtual environment was not created successfully because ensurepip is not available` | `sudo apt install python3-venv`, then delete `.venv` and create it again |
| `error: externally-managed-environment` when running pip | You forgot `source .venv/bin/activate` |
| The app says "Cannot reach the backend" | Start the backend (Terminal 1) and check that it's on port 8000 |
| `npm run dev` fails with a Node version error | Install a newer Node with nvm (see above) |
| `npm install` warns `esbuild ... has install scripts not yet covered by allowScripts` | Usually harmless. If `npm run dev` then fails with an esbuild error, run `npm install-scripts approve esbuild` and `npm install` again |
| Port 5173 or 8000 is already in use | Stop the other program, or use `--port 8001` for uvicorn (and update `vite.config.js`) |
