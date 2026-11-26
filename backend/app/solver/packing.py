"""
Two ways to solve 1D bin packing (shipments -> trucks):

1. First-Fit Decreasing (FFD): a fast "rule of thumb".
2. OR-Tools CP-SAT: a real optimizer that searches for the fewest trucks
   and can PROVE when it has found the best possible answer.
"""

import time

from ortools.sat.python import cp_model


def lower_bound(weights, capacity):
    """No solution can use fewer trucks than ceil(total weight / capacity)."""
    total = sum(weights)
    return -(-total // capacity)  # ceiling division with integers


def ffd(shipments, capacity):
    """
    First-Fit Decreasing:
      1. Sort shipments from heaviest to lightest.
      2. For each shipment, put it in the FIRST truck that still has room.
      3. If no truck has room, open a new truck.

    Returns (trucks, order), where trucks is a list of lists of shipment
    indices, and order is the order shipments were loaded (for animation).
    """
    start = time.perf_counter()
    order = sorted(range(len(shipments)), key=lambda i: -shipments[i]["weight"])

    trucks = []      # list of lists of shipment indices
    remaining = []   # remaining capacity of each truck

    for i in order:
        w = shipments[i]["weight"]
        for t, room in enumerate(remaining):
            if w <= room:
                trucks[t].append(i)
                remaining[t] -= w
                break
        else:
            trucks.append([i])
            remaining.append(capacity - w)

    elapsed = time.perf_counter() - start
    return trucks, order, elapsed


def solve_cpsat(shipments, capacity, time_limit=10.0, hint=None):
    """
    Exact model with CP-SAT.

    Decision variables:
      x[i][t] = 1 if shipment i is loaded in truck t
      y[t]    = 1 if truck t is used at all

    Constraints:
      - every shipment goes in exactly one truck
      - total weight in truck t <= capacity * y[t]   (unused trucks hold nothing)
      - y[t] >= y[t+1]   (use trucks in order: removes duplicate solutions)

    Objective:
      minimize sum(y[t])

    `hint` is an existing solution (e.g. from FFD). We use it both as a
    starting point and to cap the number of trucks we need to consider.
    """
    weights = [s["weight"] for s in shipments]
    n = len(weights)
    lb = lower_bound(weights, capacity)

    # We never need more trucks than the FFD answer (or n, one per shipment).
    max_trucks = len(hint) if hint else n

    model = cp_model.CpModel()
    x = [[model.NewBoolVar(f"x_{i}_{t}") for t in range(max_trucks)] for i in range(n)]
    y = [model.NewBoolVar(f"y_{t}") for t in range(max_trucks)]

    for i in range(n):
        model.AddExactlyOne(x[i])

    for t in range(max_trucks):
        model.Add(sum(weights[i] * x[i][t] for i in range(n)) <= capacity * y[t])

    for t in range(max_trucks - 1):
        model.Add(y[t] >= y[t + 1])

    # Helps the solver: the answer can't be below the lower bound.
    model.Add(sum(y) >= lb)

    # Symmetry breaking: shipment 0 always goes in truck 0.
    if n > 0:
        model.Add(x[0][0] == 1)

    if hint:
        # Re-order hint so the truck containing shipment 0 is truck 0
        # (to match the symmetry-breaking constraint above).
        hint = sorted(hint, key=lambda truck: 0 if 0 in truck else 1)
        where = {i: t for t, truck in enumerate(hint) for i in truck}
        for i in range(n):
            for t in range(max_trucks):
                model.AddHint(x[i][t], 1 if where[i] == t else 0)
        for t in range(max_trucks):
            model.AddHint(y[t], 1)

    model.Minimize(sum(y))

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = time_limit
    solver.parameters.num_workers = 8

    start = time.perf_counter()
    status = solver.Solve(model)
    elapsed = time.perf_counter() - start

    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return None, False, elapsed, solver.StatusName(status)

    trucks = []
    for t in range(max_trucks):
        if solver.Value(y[t]):
            loaded = [i for i in range(n) if solver.Value(x[i][t])]
            if loaded:
                trucks.append(loaded)

    # Load heaviest first inside each truck so stacks look tidy.
    trucks = [sorted(tr, key=lambda i: -weights[i]) for tr in trucks]

    # CP-SAT proves optimality itself; matching the lower bound also proves it.
    optimal = status == cp_model.OPTIMAL or len(trucks) == lb
    return trucks, optimal, elapsed, solver.StatusName(status)
