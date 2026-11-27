"""
The solver slots for the public endpoint that runs a solve (POST /api/plan/fleet). Each CP-SAT
solve can use 8 threads for up to its time limit, so only MAX_CONCURRENT_SOLVES run at once;
the rest get 429.
"""

import threading

MAX_CONCURRENT_SOLVES = 2
solve_slots = threading.BoundedSemaphore(MAX_CONCURRENT_SOLVES)
