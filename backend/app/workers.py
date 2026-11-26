"""
Background jobs with arq + Redis. Owner: Agent B.

Contract used by the ops router (call through the module so tests can patch it):

    from app import workers
    await workers.enqueue_solve(job.id)   # after the Job row is COMMITTED

Run the worker:  cd backend && arq app.workers.WorkerSettings
"""

import uuid

from app.config import settings


async def enqueue_solve(job_id: uuid.UUID) -> None:
    """Queue the solve job `job_id` (a committed Job row with kind=solve, status=queued)."""
    raise NotImplementedError("Agent B: arq enqueue")


async def run_solve(ctx: dict, job_id: str) -> None:
    """arq task: load Job + payload, expand the orders' lines into units, pack,
    store SolveResult in Job.result (status succeeded) or the error (failed)."""
    raise NotImplementedError("Agent B: solve task")


async def close_pool() -> None:
    """Close the Redis pool used by enqueue_solve (called on app shutdown)."""
    return None


class WorkerSettings:
    functions = [run_solve]
    queue_name = settings.ARQ_QUEUE_NAME
    # redis_settings = RedisSettings.from_dsn(settings.REDIS_URL)  # Agent B
