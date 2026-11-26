"""
Background jobs with arq + Redis. Owner: Agent B.

Contract used by the ops router (call through the module so tests can patch it):

    from app import workers
    await workers.enqueue_solve(job.id)   # after the Job row is COMMITTED

Run the worker:  cd backend && arq app.workers.WorkerSettings

The Job row in Postgres is the source of truth for status and results; Redis
only carries "please run job X". A job moves queued -> running -> succeeded |
failed exactly once (the queued -> running step is an atomic UPDATE, so a
duplicate delivery of the same job is a no-op).
"""

import asyncio
import logging
import uuid
from typing import Any

from arq import create_pool
from arq.connections import ArqRedis, RedisSettings
from pydantic import ValidationError
from sqlalchemy import update
from sqlmodel import col, select

from app.config import settings
from app.db import SessionLocal
from app.models import Job, JobStatus, Order, OrderStatus, utcnow
from app.schemas import SolveJobPayload
from app.solver import expand_lines, pack

log = logging.getLogger(__name__)

TASK_NAME = "run_solve"
JOB_TIMEOUT_S = 120          # well above the solver's time limit
MAX_JOBS = 2                 # CP-SAT already uses 8 threads per solve
RESTARTED_ERROR = "The worker restarted while this job was running."
STOPPED_ERROR = "The solver job was stopped before it finished (it timed out or the worker shut down)."

_pool: ArqRedis | None = None
_pool_lock = asyncio.Lock()


def _redis_settings() -> RedisSettings:
    return RedisSettings.from_dsn(settings.REDIS_URL)


async def _get_pool() -> ArqRedis:
    global _pool
    async with _pool_lock:
        if _pool is None:
            _pool = await create_pool(_redis_settings(), default_queue_name=settings.ARQ_QUEUE_NAME)
        return _pool


async def enqueue_solve(job_id: uuid.UUID) -> None:
    """Queue the solve job `job_id` (a committed Job row with kind=solve, status=queued).
    The arq job id is the Job id, so queueing the same job twice runs it once."""
    pool = await _get_pool()
    await pool.enqueue_job(TASK_NAME, str(job_id), _job_id=str(job_id),
                           _queue_name=settings.ARQ_QUEUE_NAME)


async def close_pool() -> None:
    """Close the Redis pool used by enqueue_solve (called on app shutdown)."""
    global _pool
    if _pool is not None:
        pool, _pool = _pool, None
        await pool.aclose()


# ---------------------------------------------------------------------------
# The task
# ---------------------------------------------------------------------------

async def _claim(job_id: uuid.UUID) -> bool:
    """queued -> running (with started_at). False if the job is missing or not queued."""
    async with SessionLocal() as session:
        claimed = (await session.exec(
            update(Job)
            .where(col(Job.id) == job_id, col(Job.status) == JobStatus.queued)
            .values(status=JobStatus.running, started_at=utcnow())
            .returning(col(Job.id))
        )).first()
        await session.commit()
    return claimed is not None


async def _finish(job_id: uuid.UUID, *, result: dict[str, Any] | None = None,
                  error: str | None = None) -> None:
    """running -> succeeded (with result) or failed (with error), with finished_at."""
    values: dict[str, Any] = {"finished_at": utcnow()}
    if error is None:
        values.update(status=JobStatus.succeeded, result=result, error=None)
    else:
        values.update(status=JobStatus.failed, error=error)
    async with SessionLocal() as session:
        await session.exec(
            update(Job)
            .where(col(Job.id) == job_id, col(Job.status) == JobStatus.running)
            .values(**values)
        )
        await session.commit()


def _refs(orders: list[Order]) -> str:
    return ", ".join(o.reference for o in orders)


async def _load_units(job_id: uuid.UUID) -> tuple[SolveJobPayload, list]:
    """Read the payload and its orders, check them, and expand their lines into units."""
    async with SessionLocal() as session:
        job = await session.get(Job, job_id)
        if job is None:
            raise ValueError("The job was deleted while it was running.")
        try:
            payload = SolveJobPayload.model_validate(job.payload)
        except ValidationError as exc:
            raise ValueError(f"The job payload is not a valid solve request: {exc}") from exc
        if not payload.order_ids:
            raise ValueError("There are no orders to plan.")

        orders = list((await session.exec(
            select(Order).where(col(Order.id).in_(payload.order_ids)).order_by(col(Order.id))
        )).all())
        missing = sorted(set(payload.order_ids) - {o.id for o in orders})
        if missing:
            raise ValueError("Some orders of this plan no longer exist: "
                             + ", ".join(f"ORD-{i:06d}" for i in missing) + ".")
        not_accepted = [o for o in orders if o.status != OrderStatus.accepted]
        if not_accepted:
            raise ValueError("Some orders are no longer accepted: "
                             + ", ".join(f"{o.reference} ({o.status.value})" for o in not_accepted)
                             + ". Discard this plan and create a new one.")
        released = [o for o in orders if o.plan_id != payload.plan_id]
        if released:
            raise ValueError(f"Some orders are no longer reserved by plan {payload.plan_id}: "
                             f"{_refs(released)}. Discard this plan and create a new one.")
        units = expand_lines(line for o in orders for line in o.lines)
    return payload, units


async def run_solve(ctx: dict, job_id: str) -> None:
    """arq task: load Job + payload, expand the orders' lines into units, pack,
    store SolveResult in Job.result (status succeeded) or the error (failed)."""
    try:
        jid = uuid.UUID(str(job_id))
    except ValueError:
        log.error("run_solve: %r is not a job id", job_id)
        return
    if not await _claim(jid):
        log.info("run_solve: job %s is missing or not queued; skipping", jid)
        return

    try:
        payload, units = await _load_units(jid)
        result = await asyncio.to_thread(pack, units, payload.capacity, payload.time_limit_s)
    except asyncio.CancelledError:
        log.error("run_solve: job %s was cancelled (timeout or shutdown)", jid)
        await asyncio.shield(_finish(jid, error=STOPPED_ERROR))
        raise
    except ValueError as exc:
        log.warning("run_solve: job %s failed: %s", jid, exc, exc_info=True)
        await _finish(jid, error=str(exc))
        return
    except Exception as exc:
        log.exception("run_solve: job %s crashed", jid)
        await _finish(jid, error=f"Solver failed: {type(exc).__name__}: {exc}")
        return

    try:
        await _finish(jid, result=result.model_dump(mode="json"))
    except Exception as exc:
        log.exception("run_solve: could not store the result of job %s", jid)
        await _finish(jid, error=f"Solver failed: could not store the result: {type(exc).__name__}: {exc}")
        return
    log.info("run_solve: job %s succeeded (%d units, recommended %s)", jid, len(units),
             result.recommended)


# ---------------------------------------------------------------------------
# Worker
# ---------------------------------------------------------------------------

async def fail_stale_running_jobs() -> int:
    """Mark every `running` job failed. Only correct while ONE worker runs
    (a restarted worker can't still be working on them)."""
    async with SessionLocal() as session:
        ids = (await session.exec(
            update(Job)
            .where(col(Job.status) == JobStatus.running)
            .values(status=JobStatus.failed, error=RESTARTED_ERROR, finished_at=utcnow())
            .returning(col(Job.id))
        )).all()
        await session.commit()
    return len(ids)


async def requeue_queued_jobs(redis: ArqRedis) -> int:
    """Queue every `queued` job again (e.g. Redis was down when it was created).
    arq ignores a job id that is already queued."""
    async with SessionLocal() as session:
        ids = (await session.exec(
            select(Job.id).where(col(Job.status) == JobStatus.queued).order_by(col(Job.created_at))
        )).all()
    for jid in ids:
        await redis.enqueue_job(TASK_NAME, str(jid), _job_id=str(jid), _queue_name=settings.ARQ_QUEUE_NAME)
    return len(ids)


async def startup(ctx: dict) -> None:
    failed = await fail_stale_running_jobs()
    if failed:
        log.warning("Marked %d job(s) that were running before the restart as failed", failed)
    requeued = await requeue_queued_jobs(ctx["redis"])
    if requeued:
        log.info("Re-queued %d queued job(s)", requeued)


class WorkerSettings:
    functions = [run_solve]
    queue_name = settings.ARQ_QUEUE_NAME
    redis_settings = _redis_settings()
    job_timeout = JOB_TIMEOUT_S
    max_jobs = MAX_JOBS
    max_tries = 1        # a solve that crashed the worker is failed by `startup`, not retried
    keep_result = 0      # results live in Postgres (Job.result)
    on_startup = startup
