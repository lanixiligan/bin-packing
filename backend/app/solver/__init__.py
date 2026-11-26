"""
Bin packing for load planning. Owner: Agent B.

1D demo API (unchanged, used by POST /api/solve), in app/solver/packing.py:
    ffd(shipments, capacity), solve_cpsat(...), lower_bound(weights, capacity)

Multi-dimension API (weight, volume, pallets; each optional per vehicle).
These signatures are a CONTRACT used by the ops router and the worker:

    expand_lines(lines)               -> list[PackUnit]
    find_misfits(units, capacity)     -> list[UnitMisfit]   (one per order line)
    exceeded(usage, capacity)         -> list["weight" | "volume" | "pallets"]
    usage_of(units)                   -> Usage
    fill_percent(usage, capacity)     -> FillPercent
    pack(units, capacity, time_limit_s) -> SolveResult      (FFD + CP-SAT)
"""

from collections.abc import Iterable, Sequence

from app.models import OrderLine
from app.schemas import Capacity, FillPercent, PackUnit, SolveResult, UnitMisfit, Usage
from app.solver.packing import ffd, lower_bound, solve_cpsat

__all__ = [
    "expand_lines", "find_misfits", "exceeded", "usage_of", "fill_percent", "pack",
    "ffd", "lower_bound", "solve_cpsat", "EPS",
]

EPS = 1e-9  # float tolerance for capacity comparisons

_DIMS = (("weight", "weight_kg", "kg"), ("volume", "volume_m3", "m³"), ("pallets", "pallets", "pallets"))


def expand_lines(lines: Iterable[OrderLine]) -> list[PackUnit]:
    """One PackUnit per unit of quantity, ids 0..n-1, in line order.
    Needs line.order loaded (it is, via selectin) for the order reference."""
    units: list[PackUnit] = []
    for line in lines:
        for _ in range(line.quantity):
            units.append(PackUnit(
                id=len(units),
                order_id=line.order_id,
                order_reference=line.order.reference,
                order_line_id=line.id,
                item_name=line.item_name,
                item_sku=line.item_sku,
                weight_kg=line.unit_weight_kg,
                volume_m3=line.unit_volume_m3,
                pallets=line.unit_pallet_spaces,
            ))
    return units


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
    for dim, attr, _ in _DIMS:
        cap = getattr(capacity, attr)
        if cap is not None and getattr(usage, attr) > cap + EPS:
            out.append(dim)
    return out


def fill_percent(usage: Usage, capacity: Capacity) -> FillPercent:
    vals = {}
    for dim, attr, _ in _DIMS:
        cap = getattr(capacity, attr)
        vals[dim] = None if cap is None else round(100 * getattr(usage, attr) / cap, 1)
    return FillPercent(**vals)


def find_misfits(units: Sequence[PackUnit], capacity: Capacity) -> list[UnitMisfit]:
    """Units that can't fit an empty vehicle of `capacity`, reported once per order line."""
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
        for dim, attr, unit in _DIMS:
            if dim in dims:
                parts.append(f"{getattr(u, attr):g} {unit} > {getattr(capacity, attr):g} {unit}")
        out.append(UnitMisfit(
            order_id=u.order_id, order_reference=u.order_reference, order_line_id=u.order_line_id,
            item_name=u.item_name, item_sku=u.item_sku, dimensions=dims,
            message=f"{u.order_reference}: {u.item_name} (SKU {u.item_sku}) is too big for the "
                    f"vehicle: {', '.join(parts)}",
        ))
    return out


def pack(units: Sequence[PackUnit], capacity: Capacity, time_limit_s: float = 10.0) -> SolveResult:
    """
    Pack `units` into the fewest loads of `capacity`, with multi-dimension FFD
    and CP-SAT (warm-started from FFD, `time_limit_s` limit), and return both.
    Raises ValueError if any unit can't fit (see find_misfits) or there are no units.
    """
    raise NotImplementedError("Agent B: multi-dimension packing")
