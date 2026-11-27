"""
Bin packing for the demo: FFD and CP-SAT over units with a weight, a volume and
pallet spaces, each dimension optionally limited (app/solver/multi.py).

    pack(units, capacity, time_limit_s) -> SolveResult      (FFD + CP-SAT)
    exceeded(usage, capacity)           -> dimensions over the capacity
    usage_of(units)                     -> Usage

Dangerous goods: units whose DG data conflict (app/dg.py, ADG Table 9.1/9.2)
are never packed on the same load, by either method.
"""

from app.solver.core import EPS, exceeded, usage_of
from app.solver.multi import pack

__all__ = ["pack", "exceeded", "usage_of", "EPS"]
