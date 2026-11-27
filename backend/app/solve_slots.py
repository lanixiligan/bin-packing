"""
The solver slots shared by the public endpoints that run a solve (POST /api/solve and
POST /api/plan/fleet). Each CP-SAT solve can use 8 threads for up to its time limit, so only
MAX_CONCURRENT_SOLVES run at once across both endpoints; the rest get 429.
"""

import threading

MAX_CONCURRENT_SOLVES = 2
solve_slots = threading.BoundedSemaphore(MAX_CONCURRENT_SOLVES)
