# Freight platform API

This is the contract that the backend routers, the solver worker and the web app are built against. The
request and response models live in [`backend/app/schemas.py`](../backend/app/schemas.py) and the tables
in [`backend/app/models.py`](../backend/app/models.py). The live schema is at `/docs` (Swagger) and
`/openapi.json` on a running backend. The frontend's types in `frontend/src/api/schema.d.ts` are generated
from it with `make api-types`.

**Changing the contract:** routers may change the code *inside* their endpoints, but the paths, methods,
roles and the schemas in `schemas.py` and `models.py` only change through the orchestrator.

## Conventions

* **Base path.** Every endpoint is under `/api`. The web app's routes `/portal/*`, `/ops/*` and
  `/driver/*` are browser pages; the Vite dev server forwards only `/api` to the backend.
* **Auth.** `POST /api/auth/jwt/login` takes a form (`username` = e-mail, `password`) and returns
  `{"access_token", "token_type": "bearer"}`. Send it as `Authorization: Bearer <token>`.
  Tokens last `JWT_LIFETIME_SECONDS` (default 24 h).
* **Roles.** `customer`, `dispatcher`, `driver`. A wrong role gets **403**; no token gets **401**.
* **Tenant isolation.** A customer only ever sees rows of their own `company_id`. Another company's
  row answers **404**, exactly like a row that doesn't exist.
* **Errors.** `{"detail": "readable message"}` with 400/403/404/409/413/415/422. Validation errors are
  FastAPI's 422 `{"detail": [{"loc", "msg", "type"}]}`. Two special cases:
  * Invalid order status changes give **409** with the message from `app/lifecycle.py`.
  * `POST /api/ops/plans` with units bigger than the vehicle gives **422** with
    `detail` = `InfeasibleDetail` `{message, misfits: [UnitMisfit]}`.
* **Status codes.** Create = 201, async start = 202, delete/archive = 204, otherwise 200.
* **Formats.** Dates are `YYYY-MM-DD`, times `HH:MM[:SS]`, timestamps ISO 8601 UTC. **Money is a
  decimal string** (`"123.45"`). Weight is in kg, volume in m³ and pallets in pallet spaces (all floats).
* **Updates.** PATCH bodies only change the fields that are sent. Sending `null` clears a nullable field.
* **Lists.** Plain JSON arrays. Order lists accept `limit` (≤ 500, default 200) and `offset`.
  `status` can be repeated: `?status=submitted&status=accepted`.
* **Body size.** Request bodies over 1 MiB get **413** while they stream in, before auth runs. The POD
  upload allows `MAX_UPLOAD_BYTES` plus 64 KiB for the form.
* **Staff identities.** In customer responses, timeline events by dispatchers and drivers have
  `actor_id: null` and show only the display name and role.
* **Addresses.** Changing an address's location (line1, line2, suburb, state, postcode, country) clears
  its zone, and gives **409** while an order past draft (other than rejected or cancelled) uses it.
* **Business timezone.** `BUSINESS_TZ` (default `Australia/Sydney`) defines the driver's "today" and
  invoice months.

## Order lifecycle

```
draft ──► submitted ──► accepted ──► planned ──► picked_up ──► in_transit ──► delivered
  │          │   └────► rejected        │             │               │
  │          │                          └─► exception └─► exception   └─► exception
  └──► cancelled ◄─┘
```

| From | To | Who | Through |
|---|---|---|---|
| draft | submitted | customer | `POST /api/portal/orders/{id}/submit` (stores the quote) |
| draft, submitted | cancelled | customer | `POST /api/portal/orders/{id}/cancel` |
| submitted | accepted / rejected | dispatcher | `POST /api/ops/orders/{id}/accept` / `reject` (reason required) |
| accepted | planned | dispatcher | `POST /api/ops/plans/{id}/lock` (every order in the plan) |
| planned | picked_up | driver | `POST /api/driver/orders/{id}/status` |
| picked_up | in_transit | driver | `POST /api/driver/orders/{id}/status` |
| in_transit | delivered | driver | `POST /api/driver/orders/{id}/pod` (proof of delivery) |
| planned, picked_up, in_transit | exception | driver | `POST /api/driver/orders/{id}/status` (note required) |

`app/lifecycle.py` is the only code that changes `Order.status`. Each change writes an `OrderEvent`
(timestamp, actor, optional note), and the first event of an order (`null → draft`) is written when it's
created. `OrderRead.events` is the timeline, oldest first. `rejected`, `cancelled`, `delivered` and
`exception` are final.

## Planning flow (dispatcher)

1. **Zone the addresses.** `PATCH /api/ops/addresses/{id}` `{zone}`. Orders are batched by
   `delivery_date` + the delivery address's `zone`. `GET /api/ops/batches` shows the groups.
2. **Run the optimiser.** `POST /api/ops/plans {delivery_date, zone, vehicle_id}` reserves every
   accepted, unreserved order of that batch (`Order.plan_id`), checks that every unit fits the vehicle
   (422 `InfeasibleDetail` if not), creates a queued solve `Job` and a draft `Plan`, and returns
   **202** `PlanRead` with `job_id`. The vehicle is the *capacity profile*: each limit (kg, m³, pallets)
   is optional, and every load is packed against it.
3. **Wait for the job.** `GET /api/jobs/{job_id}` → `queued` → `running` → `succeeded` | `failed`
   (`error`). Poll about once a second. The solver stops after `time_limit_s` (10 s).
4. **Compare the results.** `GET /api/jobs/{job_id}/result` → `SolveResult`: FFD and CP-SAT, each with
   its loads as unit ids, usage, fill % per dimension, `drop_order` for the animation, the lower bound
   (overall and per dimension) and the `recommended` method.
5. **Save a draft.** `POST /api/ops/plans/{id}/draft {method}` writes the loads (`Load` +
   `LoadAssignment` = units of an order line on a load). A line's units may be split over loads.
6. **Edit.** `POST /api/ops/plans/{id}/moves {order_line_id, from_load_id, to_load_id|null, quantity?}`.
   The server re-checks the capacity (422 if the target would be over capacity) and removes loads that
   end up empty.
7. **Lock.** `POST /api/ops/plans/{id}/lock` freezes the loads and moves every order to `planned`.
8. **Assign.** `PATCH /api/ops/loads/{id} {vehicle_id, driver_id}`, before or after locking. Changing the
   vehicle re-checks the load against that vehicle's capacity.

`DELETE /api/ops/plans/{id}` discards a draft plan and releases its orders.

## Driver flow

`GET /api/driver/run?date=` lists the driver's loads in **locked** plans for that date (default: today),
with the orders on each. Each `DriverOrder.next_statuses` says which actions to offer. Pickup:
`status=picked_up`, then `status=in_transit`. Delivery: `POST /api/driver/orders/{id}/pod` (multipart:
`signed_by`, `photo` as JPEG/PNG/WebP up to `MAX_UPLOAD_BYTES`, optional `note`) records the proof of delivery and
sets `delivered`. A problem: `status=exception` with a note.

**Split orders.** If an order is split over several drivers' loads, the first driver to reach
`picked_up` or `in_transit` moves the order; the others' requests for a step the order has already
reached return 200 without a second event. Each driver records a POD for their part (409 if they already
did, after which their `next_statuses` is empty), and the order becomes `delivered` with the last one.
An `exception` from any driver ends the order for everyone.

POD photos are stored on disk under `UPLOAD_DIR` with server-generated names. Fetch one with
`GET /api/pods/{id}/photo` (from `PodRead.photo_url`), sending the bearer token.

## Pricing and invoices

`cubic_weight_kg = max(total_kg, total_m³ × 250)` and `amount = cubic_weight_kg × zone.rate_per_kg`,
rounded to cents. If the delivery address has no zone yet, `DEFAULT_RATE_PER_KG` is used and the quote is
`provisional`. `POST /api/portal/quote-preview` prices a draft without storing anything. Submitting stores
the `Quote` on the order, and that price is final.

An invoice is the list of a company's orders delivered in a calendar month (by `delivered_at` in
`BUSINESS_TZ`), priced from their quotes. `GET /api/ops/invoices/{company_id}/csv?month=YYYY-MM` downloads
it as CSV with columns
`reference,customer_reference,delivered_at,delivery_suburb,zone,weight_kg,volume_m3,cubic_weight_kg,rate_per_kg,amount`
and a final `TOTAL` row. There are no payments.

## Seed logins (`make seed`)

| Role | E-mail | Password |
|---|---|---|
| customer (Acme Hardware Pty Ltd) | `alice@acme.example.com`, `bob@acme.example.com` | `demo-pass-123` |
| dispatcher | `dispatch@freightco.example.com` | `demo-pass-123` |
| driver | `driver1@freightco.example.com`, `driver2@freightco.example.com` | `demo-pass-123` |

## Endpoints

Request bodies are JSON unless marked form or multipart. `?` marks an optional query parameter. FastAPI's
own 401/403/422 responses are not repeated in every row.

### meta

| Method | Path | Role | Request | Response |
|---|---|---|---|---|
| GET | `/api/health` | public | — | 200 `{"status":"ok"}` |

### auth

| Method | Path | Role | Request | Response |
|---|---|---|---|---|
| POST | `/api/auth/jwt/login` | public | form: `username` (e-mail), `password` | 200 BearerResponse, 400 ErrorModel |
| POST | `/api/auth/jwt/logout` | public | — | 200, 401 |
| POST | `/api/auth/register` | public | UserCreate | 201 UserRead, 400 ErrorModel |

### users

| Method | Path | Role | Request | Response |
|---|---|---|---|---|
| GET | `/api/users/me` | any logged-in | — | 200 MeRead |

### portal

| Method | Path | Role | Request | Response |
|---|---|---|---|---|
| GET | `/api/portal/items` | customer | query: `include_archived`? | 200 list[ItemRead] |
| POST | `/api/portal/items` | customer | ItemCreate | 201 ItemRead |
| GET | `/api/portal/items/{item_id}` | customer | — | 200 ItemRead |
| PATCH | `/api/portal/items/{item_id}` | customer | ItemUpdate | 200 ItemRead |
| DELETE | `/api/portal/items/{item_id}` | customer | — | 204 |
| GET | `/api/portal/addresses` | customer | query: `include_archived`? | 200 list[AddressRead] |
| POST | `/api/portal/addresses` | customer | AddressCreate | 201 AddressRead |
| GET | `/api/portal/addresses/{address_id}` | customer | — | 200 AddressRead |
| PATCH | `/api/portal/addresses/{address_id}` | customer | AddressUpdate | 200 AddressRead |
| DELETE | `/api/portal/addresses/{address_id}` | customer | — | 204 |
| POST | `/api/portal/quote-preview` | customer | QuotePreviewRequest | 200 QuoteRead |
| GET | `/api/portal/orders` | customer | query: `status`?, `from_date`?, `to_date`?, `limit`?, `offset`? | 200 list[OrderSummary] |
| POST | `/api/portal/orders` | customer | OrderCreate | 201 OrderRead |
| GET | `/api/portal/orders/{order_id}` | customer | — | 200 OrderRead |
| PATCH | `/api/portal/orders/{order_id}` | customer | OrderUpdate | 200 OrderRead |
| POST | `/api/portal/orders/{order_id}/submit` | customer | StatusNote (optional) | 200 OrderRead |
| POST | `/api/portal/orders/{order_id}/cancel` | customer | StatusNote (optional) | 200 OrderRead |

### ops

| Method | Path | Role | Request | Response |
|---|---|---|---|---|
| GET | `/api/ops/orders` | dispatcher | query: `status`?, `delivery_date`?, `zone`?, `company_id`?, `limit`?, `offset`? | 200 list[OrderSummary] |
| GET | `/api/ops/orders/{order_id}` | dispatcher | — | 200 OrderRead |
| POST | `/api/ops/orders/{order_id}/accept` | dispatcher | StatusNote (optional) | 200 OrderRead |
| POST | `/api/ops/orders/{order_id}/reject` | dispatcher | RejectBody | 200 OrderRead |
| GET | `/api/ops/batches` | dispatcher | query: `from_date`?, `to_date`? | 200 list[BatchSummary] |
| GET | `/api/ops/zones` | dispatcher | — | 200 list[ZoneRead] |
| POST | `/api/ops/zones` | dispatcher | ZoneCreate | 201 ZoneRead |
| PATCH | `/api/ops/zones/{code}` | dispatcher | ZoneUpdate | 200 ZoneRead |
| GET | `/api/ops/addresses` | dispatcher | query: `zone`?, `company_id`? | 200 list[OpsAddressRead] |
| PATCH | `/api/ops/addresses/{address_id}` | dispatcher | AddressZoneUpdate | 200 OpsAddressRead |
| GET | `/api/ops/vehicles` | dispatcher | query: `include_inactive`? | 200 list[VehicleRead] |
| POST | `/api/ops/vehicles` | dispatcher | VehicleCreate | 201 VehicleRead |
| PATCH | `/api/ops/vehicles/{vehicle_id}` | dispatcher | VehicleUpdate | 200 VehicleRead |
| GET | `/api/ops/drivers` | dispatcher | query: `include_inactive`? | 200 list[DriverRead] |
| POST | `/api/ops/drivers` | dispatcher | DriverCreate | 201 DriverRead |
| PATCH | `/api/ops/drivers/{driver_id}` | dispatcher | DriverUpdate | 200 DriverRead |
| POST | `/api/ops/plans` | dispatcher | PlanCreate | 202 PlanRead, 422 string or InfeasibleDetail |
| GET | `/api/ops/plans` | dispatcher | query: `delivery_date`?, `zone`?, `status`? | 200 list[PlanSummary] |
| GET | `/api/ops/plans/{plan_id}` | dispatcher | — | 200 PlanRead |
| DELETE | `/api/ops/plans/{plan_id}` | dispatcher | — | 204 |
| POST | `/api/ops/plans/{plan_id}/draft` | dispatcher | PlanSaveDraft | 200 PlanRead |
| POST | `/api/ops/plans/{plan_id}/moves` | dispatcher | LineMove | 200 PlanRead |
| POST | `/api/ops/plans/{plan_id}/lock` | dispatcher | — | 200 PlanRead |
| PATCH | `/api/ops/loads/{load_id}` | dispatcher | LoadUpdate | 200 LoadRead |
| GET | `/api/ops/invoices` | dispatcher | query: `month` | 200 list[InvoiceSummary] |
| GET | `/api/ops/invoices/{company_id}` | dispatcher | query: `month` | 200 Invoice |
| GET | `/api/ops/invoices/{company_id}/csv` | dispatcher | query: `month` | 200 text/csv |

### driver

| Method | Path | Role | Request | Response |
|---|---|---|---|---|
| GET | `/api/driver/run` | driver | query: `date`? | 200 DriverRun |
| GET | `/api/driver/orders/{order_id}` | driver | — | 200 DriverOrder |
| POST | `/api/driver/orders/{order_id}/status` | driver | DriverStatusUpdate | 200 DriverOrder |
| POST | `/api/driver/orders/{order_id}/pod` | driver | multipart: `signed_by`, `photo` (file), `note`? | 200 DriverOrder |
| GET | `/api/pods/{pod_id}/photo` | customer (own company) / dispatcher / driver (own POD) | — | 200 image (jpeg/png/webp) |

### jobs

| Method | Path | Role | Request | Response |
|---|---|---|---|---|
| GET | `/api/jobs/{job_id}` | dispatcher | — | 200 JobRead |
| GET | `/api/jobs/{job_id}/result` | dispatcher | — | 200 SolveResult |

### demo

| Method | Path | Role | Request | Response |
|---|---|---|---|---|
| POST | `/api/solve` | public | SolveRequest | 200 (unchanged demo response); 429 while 2 solves are already running |
