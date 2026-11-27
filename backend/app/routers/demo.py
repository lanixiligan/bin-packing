"""
The stateless truck loading demo: GET /api/reference and POST /api/solve (public).

GET /api/reference returns all reference data (pallets, bodies, vehicles); the frontend
reads its options from here and keeps no copy of its own.

Shipments have real sizes (pallets of a reference pallet type, or loose items
with their own length x width) and are packed onto the cargo decks of a vehicle
from the reference data (app/reference): each footprint is placed on a
deck, stackable shipments with the same footprint may form columns, and the
fewest trucks of that vehicle are used. The request and response models, with
the coordinate conventions, are in app/demo_models.py.

It packs with Google OR-Tools CP-SAT (app/solver.py) and returns the fewest
trucks it finds, with whether that is proven optimal.
"""

import threading

from fastapi import APIRouter, HTTPException

from app.demo_models import (
    DeckOut,
    Placement,
    ShipmentOut,
    SolveRequest,
    SolveResponse,
    TruckCapacity,
    TruckOut,
)
from app.reference import ReferenceData, load_reference
from app.solver import DeckSpec, Item, Truck, loose_key, pallet_key
from app.solver import solve as solve_items

TIME_LIMIT_SECONDS = 10.0
# The endpoint is public and each solve can use 8 solver threads for up to
# TIME_LIMIT_SECONDS, so only this many run at once; the rest get 429.
MAX_CONCURRENT_SOLVES = 2
_solve_slots = threading.BoundedSemaphore(MAX_CONCURRENT_SOLVES)

router = APIRouter()


@router.get("/reference", response_model=ReferenceData, tags=["demo"])
def reference() -> ReferenceData:
    return load_reference()


def _truck(req: SolveRequest):
    """(reference, vehicle, body id, Truck) for the request; HTTPException 400 for a vehicle or
    body that is unknown, not allowed together, or doesn't carry pallets."""
    ref = load_reference()
    vehicle = ref.vehicles.get(req.vehicle_id)
    if vehicle is None:
        raise HTTPException(400, f"Unknown vehicle '{req.vehicle_id}'.")
    body_id = req.body_type or vehicle.default_body
    body = ref.bodies.get(body_id)
    if body is None:
        raise HTTPException(400, f"Unknown body type '{body_id}'.")
    if body_id not in vehicle.allowed_bodies:
        raise HTTPException(400, f"A {vehicle.name} can't have a {body.name} body.")
    if not body.carries_pallets or not body.in_scope:
        raise HTTPException(400, f"A {body.name} body doesn't carry pallets or loose freight; "
                                 f"choose another body.")
    decks = tuple(
        DeckSpec(id=d.id, name=d.name, length=d.length_mm, width=d.width_mm,
                 height=body.internal_height_mm if body.internal_height_mm is not None
                 else vehicle.overall_height_limit_mm - d.deck_height_mm)
        for d in vehicle.cargo_decks)
    if not decks or any(d.length <= 0 or d.width <= 0 or d.height <= 0 for d in decks):
        raise HTTPException(400, f"A {vehicle.name} has no usable cargo deck.")
    truck = Truck(payload_kg=int(vehicle.max_payload_kg), decks=decks, name=vehicle.name)
    return ref, vehicle, body_id, truck


@router.post("/solve", tags=["demo"], response_model=SolveResponse)
def solve(req: SolveRequest) -> SolveResponse:
    # ---- Validation -------------------------------------------------------
    if not req.shipments:
        raise HTTPException(400, "Add at least one shipment.")
    ref, vehicle, body_id, truck = _truck(req)

    unknown = sorted({s.pallet_type for s in req.shipments
                      if s.pallet_type is not None and s.pallet_type not in ref.pallets})
    if unknown:
        raise HTTPException(400, "Unknown pallet type: " + ", ".join(f"'{p}'" for p in unknown) + ".")

    # Each shipment's id is its position in the request, so the frontend can track it.
    items: list[Item] = []
    pallet_types: list[str | None] = []
    for i, s in enumerate(req.shipments):
        if s.kind == "pallet":
            pid = s.pallet_type or ref.pallet_defaults.default_pallet
            pallet = ref.pallets[pid]
            length, width, key = pallet.length_mm, pallet.width_mm, pallet_key(pid)
        else:
            pid = None
            length, width, key = s.length_mm, s.width_mm, loose_key(s.length_mm, s.width_mm)
        pallet_types.append(pid)
        items.append(Item(id=i, name=s.name, weight=s.weight, length=length, width=width, height=s.height_mm,
                          stackable=s.stackable, footprint=key))

    # ---- OR-Tools CP-SAT ------------------------------------------------
    if not _solve_slots.acquire(blocking=False):
        raise HTTPException(429, "The solver is busy with other requests. Try again in a few seconds.")
    try:
        result = solve_items(items, truck, TIME_LIMIT_SECONDS)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(500, str(exc)) from exc
    finally:
        _solve_slots.release()

    # ---- Response -------------------------------------------------------
    floor_mm2 = truck.floor_mm2
    trucks: list[TruckOut] = []
    for number, placed in enumerate(result.trucks, start=1):
        shipments = []
        for p in placed:
            s, it = req.shipments[p.id], items[p.id]
            shipments.append(ShipmentOut(
                id=p.id, name=s.name, weight=s.weight, kind=s.kind, pallet_type=pallet_types[p.id],
                length_mm=it.length, width_mm=it.width, height_mm=it.height, stackable=s.stackable,
                placement=Placement(
                    deck_id=truck.decks[p.deck].id, x_mm=p.x, y_mm=p.y, z_mm=p.z, length_mm=p.length,
                    width_mm=p.width, height_mm=p.height, rotated=p.rotated, stack_base=p.base,
                    level=p.level)))
        load = sum(s.weight for s in shipments)
        used = sum(p.length * p.width for p in placed if p.level == 0)
        trucks.append(TruckOut(
            truck=number, shipments=shipments, load=load, empty=truck.payload_kg - load,
            fill_percent=round(100 * load / truck.payload_kg, 1),
            floor_used_m2=round(used / 1e6, 2), floor_percent=round(100 * used / floor_mm2, 1),
            max_height_mm=max(p.z + p.height for p in placed)))

    return SolveResponse(
        vehicle_id=vehicle.id,
        vehicle_name=vehicle.name,
        body_type=body_id,
        capacity=TruckCapacity(
            weight_kg=truck.payload_kg,
            decks=[DeckOut(id=d.id, name=d.name, length_mm=d.length, width_mm=d.width, height_mm=d.height)
                   for d in truck.decks],
            floor_m2=round(floor_mm2 / 1e6, 2),
            volume_m3=round(truck.volume_mm3 / 1e9, 2)),
        total_weight=sum(s.weight for s in req.shipments),
        total_volume_m3=round(sum(it.area * it.height for it in items) / 1e9, 2),
        lower_bound=result.lower_bound,
        lower_bounds=result.lower_bounds,
        num_trucks=len(result.trucks),
        trucks=trucks,
        solve_time_ms=result.solve_time_ms,
        optimal=result.optimal,
        status=result.status,
        time_limit_s=TIME_LIMIT_SECONDS,
        # Truck by truck, the order the shipments drop in (animation).
        drop_order=[s.id for t in trucks for s in t.shipments],
    )
