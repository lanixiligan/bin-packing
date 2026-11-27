"""
Axle group load estimate: a STATIC estimate for planning, not a weighbridge reading.

Model (see also app/reference/schemas.py)
-----------------------------------------
Every deck, including a `cargo=False` chassis such as the prime mover, is a rigid simple beam
resting on two supports at vehicle x positions `a` (front_support) and `b` (rear_support).

Point loads on a deck are:
  * each placement on it, at vehicle x = deck.x_mm + p.x_mm + p.length_mm / 2 (its centre), and
  * the reaction of every deck that rests on it (a support with `on_deck == this deck`), applied
    at that support's position.

Taking moments about the front support gives, for loads W at x:
    R_rear  = sum(W * (x - a)) / (b - a)
    R_front = sum(W) - R_rear
A support on an axle group adds its reaction to that group; a support on another deck becomes a
point load on that deck. Decks are resolved in dependency order (a deck resting on another is
done first), so a B-double's rear trailer loads the lead trailer, which loads the prime mover.

Group load = AxleGroup.tare_kg (the unladen load) + the cargo reactions reaching it.

What the estimate ignores: the tare's own shift with load, suspension and load-sharing between
axles within a group, braking/cornering/dynamic loads, road camber and deck flex. Reactions are
NOT clamped: a negative reaction means the load would lift that support (e.g. freight hanging
behind the rear axles unloads the front). That is physically meaningful in this model and shows
up as a group load below its tare.
"""

from collections import defaultdict

from app.planner.models import AxleLoad, Placement
from app.reference.schemas import Deck, MassScheme, VehicleConfig

NEAR_RATIO = 0.9  # "near" from 90 % of the limit
_EPS_KG = 1e-6


def _resolution_order(vehicle: VehicleConfig) -> list[Deck]:
    """Decks ordered so that every deck comes after all the decks resting on it.

    Raises ValueError for a support on an unknown deck or for a cycle of decks resting on each other.
    """
    ids = {d.id for d in vehicle.decks}
    # resting_on_me[d] = number of decks with a support on deck d still to be resolved
    pending: dict[str, int] = {d.id: 0 for d in vehicle.decks}
    for d in vehicle.decks:
        for s in (d.front_support, d.rear_support):
            if s.on_deck is not None:
                if s.on_deck not in ids:
                    raise ValueError(f"Deck '{d.id}' rests on unknown deck '{s.on_deck}'.")
                if s.on_deck == d.id:
                    raise ValueError(f"Deck '{d.id}' rests on itself.")
                pending[s.on_deck] += 1

    by_id = {d.id: d for d in vehicle.decks}
    ready = [d for d in vehicle.decks if pending[d.id] == 0]
    order: list[Deck] = []
    while ready:
        d = ready.pop(0)
        order.append(d)
        for s in (d.front_support, d.rear_support):
            if s.on_deck is not None:
                pending[s.on_deck] -= 1
                if pending[s.on_deck] == 0:
                    ready.append(by_id[s.on_deck])
    if len(order) != len(vehicle.decks):
        stuck = sorted(i for i, n in pending.items() if n > 0)
        raise ValueError(f"Decks rest on each other in a cycle: {', '.join(stuck)}.")
    return order


def estimate_axle_loads(vehicle: VehicleConfig, placements: list[Placement],
                        mass_scheme: MassScheme = "GML") -> list[AxleLoad]:
    """Estimated load per axle group (tare + cargo), in vehicle.axle_groups order."""
    group_ids = {g.id for g in vehicle.axle_groups}
    deck_ids = {d.id for d in vehicle.decks}

    # Point loads per deck: (vehicle x, weight kg)
    loads: dict[str, list[tuple[float, float]]] = defaultdict(list)
    for p in placements:
        if p.deck_id not in deck_ids:
            raise ValueError(f"Placement {p.unit_id} is on unknown deck '{p.deck_id}'.")
        deck = vehicle.deck(p.deck_id)
        loads[p.deck_id].append((deck.x_mm + p.x_mm + p.length_mm / 2, p.weight_kg))

    cargo_on_group: dict[str, float] = defaultdict(float)
    for deck in _resolution_order(vehicle):
        a = deck.front_support.position_mm
        b = deck.rear_support.position_mm
        if a == b:
            raise ValueError(f"Deck '{deck.id}' has both supports at x={a} mm.")
        total = sum(w for _, w in loads[deck.id])
        r_rear = sum(w * (x - a) for x, w in loads[deck.id]) / (b - a)
        r_front = total - r_rear
        for support, reaction in ((deck.front_support, r_front), (deck.rear_support, r_rear)):
            if support.axle_group is not None:
                if support.axle_group not in group_ids:
                    raise ValueError(f"Deck '{deck.id}' rests on unknown axle group '{support.axle_group}'.")
                cargo_on_group[support.axle_group] += reaction
            else:
                assert support.on_deck is not None
                loads[support.on_deck].append((support.position_mm, reaction))

    result: list[AxleLoad] = []
    for g in vehicle.axle_groups:
        load = g.tare_kg + cargo_on_group[g.id]
        limit = g.limit(mass_scheme)
        ratio = load / limit
        if load > limit + _EPS_KG:
            status = "over"
        elif ratio >= NEAR_RATIO:
            status = "near"
        else:
            status = "ok"
        result.append(AxleLoad(group_id=g.id, name=g.name, load_kg=load, limit_kg=limit, ratio=ratio,
                               status=status))
    return result
