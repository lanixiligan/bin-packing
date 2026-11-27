"""
Shared helpers for multi-dimension packing: dimensions, usage and capacity
checks. Every capacity check goes through `exceeded()`.
"""

from collections.abc import Iterable, Sequence

from app import dg as dgrules
from app.schemas import Capacity, FillPercent, PackUnit, UnitMisfit, Usage

EPS = 1e-9  # float tolerance for capacity comparisons

# (dimension name, attribute on Capacity/Usage/PackUnit, unit label)
DIMS = (("weight", "weight_kg", "kg"), ("volume", "volume_m3", "m³"), ("pallets", "pallets", "pallets"))


def limited_dims(capacity: Capacity) -> list[tuple[str, str, float]]:
    """(dimension, attribute, capacity) for every dimension `capacity` limits."""
    out = []
    for dim, attr, _ in DIMS:
        cap = getattr(capacity, attr)
        if cap is not None:
            out.append((dim, attr, float(cap)))
    return out


def usage_of(units: Iterable[PackUnit]) -> Usage:
    units = list(units)
    return Usage(
        weight_kg=round(sum(u.weight_kg for u in units), 6),
        volume_m3=round(sum(u.volume_m3 for u in units), 6),
        pallets=round(sum(u.pallets for u in units), 6),
    )


def exceeded(usage: Usage, capacity: Capacity) -> list[str]:
    """Dimensions in which `usage` is over `capacity` (unlimited dimensions never are)."""
    out = []
    for dim, attr, _ in DIMS:
        cap = getattr(capacity, attr)
        if cap is not None and getattr(usage, attr) > cap + EPS:
            out.append(dim)
    return out


def fill_percent(usage: Usage, capacity: Capacity) -> FillPercent:
    vals = {}
    for dim, attr, _ in DIMS:
        cap = getattr(capacity, attr)
        vals[dim] = None if cap is None else round(100 * getattr(usage, attr) / cap, 1)
    return FillPercent(**vals)


def dg_groups(units: Sequence[PackUnit]) -> tuple[list[int], set[tuple[int, int]]]:
    """Segregation: (group of each unit, conflicting group pairs g < h). Units with the
    same DG data share a group; two groups conflict when ADG Table 9.1 / 9.2 says
    their goods can't travel on the same vehicle (app.dg.conflicts)."""
    keys: dict[str, int] = {}
    profiles: list[dgrules.DgInfo | None] = []
    group: list[int] = []
    for u in units:
        k = "" if dgrules.is_general(u.dg) else u.dg.key()
        if k not in keys:
            keys[k] = len(profiles)
            profiles.append(None if k == "" else u.dg)
        group.append(keys[k])
    pairs = {(g, h) for g in range(len(profiles)) for h in range(g + 1, len(profiles))
             if dgrules.conflicts(profiles[g], profiles[h])}
    return group, pairs


def find_misfits(units: Sequence[PackUnit], capacity: Capacity) -> list[UnitMisfit]:
    """Units that can't fit an empty load of `capacity`, reported once per line."""
    seen: set[int] = set()
    out: list[UnitMisfit] = []
    for u in units:
        if u.order_line_id in seen:
            continue
        dims = exceeded(Usage(weight_kg=u.weight_kg, volume_m3=u.volume_m3, pallets=u.pallets), capacity)
        if not dims:
            continue
        seen.add(u.order_line_id)
        parts = []
        for dim, attr, unit in DIMS:
            if dim in dims:
                parts.append(f"{getattr(u, attr):g} {unit} > {getattr(capacity, attr):g} {unit}")
        out.append(UnitMisfit(
            order_id=u.order_id, order_reference=u.order_reference, order_line_id=u.order_line_id,
            item_name=u.item_name, item_sku=u.item_sku, dimensions=dims,
            message=f"{u.order_reference}: {u.item_name} (SKU {u.item_sku}) is too big for the "
                    f"vehicle: {', '.join(parts)}",
        ))
    return out
