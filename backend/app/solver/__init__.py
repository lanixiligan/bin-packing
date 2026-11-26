"""
Bin packing for load planning. Owner: Agent B.

Multi-dimension API (weight, volume, pallets; each optional per vehicle).
These signatures are a CONTRACT used by the ops router and the worker:

    expand_lines(lines)               -> list[PackUnit]
    find_misfits(units, capacity)     -> list[UnitMisfit]   (one per order line)
    exceeded(usage, capacity)         -> list["weight" | "volume" | "pallets"]
    usage_of(units)                   -> Usage
    fill_percent(usage, capacity)     -> FillPercent
    pack(units, capacity, time_limit_s) -> SolveResult      (FFD + CP-SAT)
    dg_groups(units)                  -> (group per unit, conflicting group pairs)

Dangerous goods: units whose DG data conflict (app/dg.py, ADG Table 9.1/9.2)
are never packed on the same load, by either method.

Helpers live in app/solver/core.py, FFD and the CP-SAT model in
app/solver/multi.py. POST /api/solve (the 1D demo) also runs through `pack`,
with weight as the only limited dimension.

The original 1D functions are kept unchanged in app/solver/packing.py:
    ffd(shipments, capacity), solve_cpsat(...), lower_bound(weights, capacity)
"""

from app.solver.core import EPS, dg_groups, exceeded, expand_lines, fill_percent, find_misfits, usage_of
from app.solver.multi import pack
from app.solver.packing import ffd, lower_bound, solve_cpsat

__all__ = [
    "expand_lines", "find_misfits", "dg_groups", "exceeded", "usage_of", "fill_percent", "pack",
    "ffd", "lower_bound", "solve_cpsat", "EPS",
]
