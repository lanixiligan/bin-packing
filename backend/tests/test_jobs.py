"""The solve worker (app.workers) and the job endpoints (/api/jobs/*)."""

import asyncio
import time
import uuid
from dataclasses import dataclass

import pytest
from arq.worker import Worker

from app import workers
from app.config import settings
from app.models import Job, JobKind, JobStatus, Order, OrderStatus, Plan, UserRole, utcnow
from app.schemas import Capacity, SolveJobPayload, SolveResult
from tests.factories import make_address, make_item, make_order, make_vehicle, make_zone


@dataclass
class Setup:
    job: Job
    plan: Plan
    orders: list[Order]


@pytest.fixture
def make_setup(session, customer, dispatcher):
    """make_setup(items=[(weight, volume, pallets, qty)], capacity=..., orders=1) -> Setup:
    accepted orders reserved by a draft plan with a queued solve job (committed)."""

    async def _make(*, items=((300, 1.0, 0, 3),), capacity=None, orders=1,
                    time_limit_s=2.0, status=JobStatus.queued) -> Setup:
        capacity = capacity or Capacity(weight_kg=1000)
        await make_zone(session, "NORTH")
        pickup = await make_address(session, customer.company, label="Depot")
        delivery = await make_address(session, customer.company, label="Shop", zone="NORTH")
        lines = []
        for n, (w, v, p, qty) in enumerate(items):
            item = await make_item(session, customer.company, sku=f"SKU-{n}", weight_kg=w,
                                   volume_m3=v, pallet_spaces=p)
            lines.append((item, qty))
        made = [await make_order(session, company=customer.company, created_by=customer.user,
                                 pickup=pickup, delivery=delivery, lines=lines,
                                 status=OrderStatus.accepted) for _ in range(orders)]
        vehicle = await make_vehicle(session, max_weight_kg=capacity.weight_kg,
                                     max_volume_m3=capacity.volume_m3,
                                     max_pallets=None if capacity.pallets is None else int(capacity.pallets))
        job = Job(kind=JobKind.solve, status=status, created_by_id=dispatcher.user.id)
        session.add(job)
        await session.flush()
        plan = Plan(delivery_date=made[0].delivery_date, zone="NORTH", vehicle_id=vehicle.id,
                    job_id=job.id, created_by_id=dispatcher.user.id)
        session.add(plan)
        await session.flush()
        for o in made:
            o.plan_id = plan.id
        job.payload = SolveJobPayload(plan_id=plan.id, order_ids=[o.id for o in made], capacity=capacity,
                                      time_limit_s=time_limit_s).model_dump(mode="json")
        await session.commit()
        return Setup(job=job, plan=plan, orders=made)

    return _make


async def reload(session, job: Job) -> Job:
    return await session.get(Job, job.id, populate_existing=True)


# ---------------------------------------------------------------------------
# run_solve
# ---------------------------------------------------------------------------

async def test_run_solve_success_writes_result_and_timestamps(session, make_setup):
    s = await make_setup(items=[(300, 1.0, 0, 3), (450, 0.5, 0, 2)], orders=2)
    await workers.run_solve({}, str(s.job.id))

    job = await reload(session, s.job)
    assert job.status == JobStatus.succeeded and job.error is None
    assert job.created_at <= job.started_at <= job.finished_at
    result = SolveResult.model_validate(job.result)
    assert len(result.units) == 10
    assert [u.id for u in result.units] == list(range(10))
    assert {u.order_id for u in result.units} == {o.id for o in s.orders}
    assert result.units[0].order_reference == s.orders[0].reference
    assert result.units[0].item_sku == "SKU-0"
    assert result.totals.weight_kg == 2 * (3 * 300 + 2 * 450)
    assert result.lower_bound == 4 and result.ortools.num_loads == 4
    assert result.time_limit_s == 2.0


async def test_run_solve_skips_missing_and_finished_jobs(session, make_setup):
    await workers.run_solve({}, str(uuid.uuid4()))  # unknown: logged, no error
    await workers.run_solve({}, "not-a-uuid")

    s = await make_setup(status=JobStatus.succeeded)
    await workers.run_solve({}, str(s.job.id))
    job = await reload(session, s.job)
    assert job.status == JobStatus.succeeded and job.started_at is None and job.result is None


async def test_run_solve_misfit_fails_with_message(session, make_setup):
    s = await make_setup(items=[(1200, 1.0, 0, 2)])
    await workers.run_solve({}, str(s.job.id))
    job = await reload(session, s.job)
    assert job.status == JobStatus.failed and job.finished_at is not None and job.result is None
    assert "is too big for the vehicle" in job.error and "1200 kg > 1000 kg" in job.error
    assert s.orders[0].reference in job.error


async def test_run_solve_without_orders_fails(session, make_setup):
    s = await make_setup()
    job = await reload(session, s.job)
    job.payload = {**job.payload, "order_ids": []}
    await session.commit()
    await workers.run_solve({}, str(job.id))
    job = await reload(session, job)
    assert job.status == JobStatus.failed and job.error == "There are no orders to plan."


async def test_run_solve_fails_when_orders_are_no_longer_accepted(session, make_setup):
    s = await make_setup(orders=2)
    order = await session.get(Order, s.orders[1].id)
    order.status = OrderStatus.cancelled
    await session.commit()
    await workers.run_solve({}, str(s.job.id))
    job = await reload(session, s.job)
    assert job.status == JobStatus.failed
    assert job.error.startswith("Some orders are no longer accepted: ")
    assert f"{order.reference} (cancelled)" in job.error


async def test_run_solve_fails_when_orders_are_released(session, make_setup):
    s = await make_setup()
    order = await session.get(Order, s.orders[0].id)
    order.plan_id = None
    await session.commit()
    await workers.run_solve({}, str(s.job.id))
    job = await reload(session, s.job)
    assert job.status == JobStatus.failed
    assert f"no longer reserved by plan {s.plan.id}" in job.error and order.reference in job.error


async def test_run_solve_unexpected_error(session, make_setup, monkeypatch):
    def boom(*args, **kwargs):
        raise RuntimeError("boom")
    monkeypatch.setattr(workers, "pack", boom)
    s = await make_setup()
    await workers.run_solve({}, str(s.job.id))
    job = await reload(session, s.job)
    assert job.status == JobStatus.failed and job.error == "Solver failed: RuntimeError: boom"
    assert job.finished_at is not None


async def test_startup_fails_stuck_jobs_and_requeues_queued_ones(session, make_setup):
    running = await make_setup(status=JobStatus.running)
    queued = Job(kind=JobKind.solve, payload={})
    session.add(queued)
    await session.commit()

    class FakeRedis:
        def __init__(self):
            self.calls = []

        async def enqueue_job(self, name, *args, **kwargs):
            self.calls.append((name, args, kwargs))

    redis = FakeRedis()
    await workers.startup({"redis": redis})
    job = await reload(session, running.job)
    assert job.status == JobStatus.failed and job.error == workers.RESTARTED_ERROR
    assert job.finished_at is not None
    assert redis.calls == [("run_solve", (str(queued.id),),
                            {"_job_id": str(queued.id), "_queue_name": settings.ARQ_QUEUE_NAME})]


def test_worker_settings():
    ws = workers.WorkerSettings
    assert ws.queue_name == settings.ARQ_QUEUE_NAME
    assert ws.functions == [workers.run_solve]
    assert ws.job_timeout >= 60 and ws.max_jobs <= 4
    assert ws.on_startup is workers.startup


async def test_cancelled_job_is_failed_not_left_running(session, make_setup, monkeypatch):
    monkeypatch.setattr(workers, "pack", lambda *args, **kwargs: time.sleep(1.0))
    s = await make_setup()
    task = asyncio.create_task(workers.run_solve({}, str(s.job.id)))
    await asyncio.sleep(0.5)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    job = await reload(session, s.job)
    assert job.status == JobStatus.failed and job.error == workers.STOPPED_ERROR


@pytest.mark.real_queue
@pytest.mark.filterwarnings("ignore:Call to deprecated close:DeprecationWarning")
async def test_real_queue_runs_the_job(session, make_setup):
    s = await make_setup()
    try:
        await workers.enqueue_solve(s.job.id)
        await workers.enqueue_solve(s.job.id)  # same arq job id: runs once
    finally:
        await workers.close_pool()
    worker = Worker(
        functions=workers.WorkerSettings.functions,
        queue_name=settings.ARQ_QUEUE_NAME,
        redis_settings=workers.WorkerSettings.redis_settings,
        burst=True, poll_delay=0.05, handle_signals=False,
        job_timeout=workers.WorkerSettings.job_timeout,
        keep_result=0, max_tries=1,
    )
    try:
        await worker.async_run()
    finally:
        await worker.close()
    job = await reload(session, s.job)
    assert job.status == JobStatus.succeeded, job.error
    assert SolveResult.model_validate(job.result).ffd.num_loads == 1
    assert worker.jobs_complete >= 1


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

async def test_job_endpoints_need_a_dispatcher(client, make_actor, make_setup):
    s = await make_setup()
    customer2 = await make_actor(UserRole.customer)
    driver = await make_actor(UserRole.driver)
    for path in (f"/api/jobs/{s.job.id}", f"/api/jobs/{s.job.id}/result"):
        assert (await client.get(path)).status_code == 401
        assert (await client.get(path, headers=customer2.headers)).status_code == 403
        assert (await client.get(path, headers=driver.headers)).status_code == 403


async def test_get_job(client, dispatcher, make_setup):
    s = await make_setup(time_limit_s=7.5)
    r = await client.get(f"/api/jobs/{s.job.id}", headers=dispatcher.headers)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["id"] == str(s.job.id) and data["kind"] == "solve" and data["status"] == "queued"
    assert data["time_limit_s"] == 7.5 and data["plan_id"] == s.plan.id
    assert data["error"] is None and data["started_at"] is None and data["finished_at"] is None

    r = await client.get(f"/api/jobs/{uuid.uuid4()}", headers=dispatcher.headers)
    assert r.status_code == 404 and r.json()["detail"] == "Job not found."
    assert (await client.get("/api/jobs/nope", headers=dispatcher.headers)).status_code == 422


async def test_get_job_without_plan_or_payload(client, session, dispatcher):
    job = Job(kind=JobKind.solve, payload={})
    session.add(job)
    await session.commit()
    data = (await client.get(f"/api/jobs/{job.id}", headers=dispatcher.headers)).json()
    assert data["plan_id"] is None and data["time_limit_s"] is None


async def test_job_result_states(client, session, dispatcher, make_setup):
    s = await make_setup()
    url = f"/api/jobs/{s.job.id}/result"
    r = await client.get(url, headers=dispatcher.headers)
    assert r.status_code == 409 and r.json()["detail"] == "The job is still queued."

    job = await reload(session, s.job)
    job.status, job.started_at = JobStatus.running, utcnow()
    await session.commit()
    r = await client.get(url, headers=dispatcher.headers)
    assert r.status_code == 409 and r.json()["detail"] == "The job is still running."

    job.status, job.error = JobStatus.failed, "Something specific went wrong."
    await session.commit()
    r = await client.get(url, headers=dispatcher.headers)
    assert r.status_code == 409 and r.json()["detail"] == "Something specific went wrong."

    r = await client.get(f"/api/jobs/{uuid.uuid4()}/result", headers=dispatcher.headers)
    assert r.status_code == 404


async def test_job_result_after_solving(client, session, dispatcher, make_setup):
    s = await make_setup(items=[(100, 4.0, 1, 6)], capacity=Capacity(weight_kg=1000, volume_m3=10, pallets=4))
    await workers.run_solve({}, str(s.job.id))
    r = await client.get(f"/api/jobs/{s.job.id}/result", headers=dispatcher.headers)
    assert r.status_code == 200, r.text
    data = r.json()
    assert set(data) == {"capacity", "totals", "lower_bound", "lower_bounds", "units", "ffd", "ortools",
                         "recommended", "time_limit_s"}
    assert data["lower_bounds"] == {"weight": 1, "volume": 3, "pallets": 2}
    assert data["lower_bound"] == 3 and data["recommended"] == "ortools"
    assert data["ortools"]["num_loads"] == 3 and data["ffd"]["status"] == "HEURISTIC"
    load = data["ffd"]["loads"][0]
    assert set(load) == {"number", "unit_ids", "usage", "fill_percent"}
    assert load["number"] == 1 and load["fill_percent"]["volume"] == 80.0

    job = (await client.get(f"/api/jobs/{s.job.id}", headers=dispatcher.headers)).json()
    assert job["status"] == "succeeded" and job["finished_at"] is not None
