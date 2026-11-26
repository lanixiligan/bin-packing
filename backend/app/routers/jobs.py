"""Job status and results: /api/jobs/*. Owner: Agent B. Dispatchers only."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.auth import DispatcherUser
from app.db import get_session
from app.models import Job, JobStatus, Plan
from app.schemas import JobRead, SolveResult

router = APIRouter()
Session = Annotated[AsyncSession, Depends(get_session)]


async def _get_job(session: AsyncSession, job_id: uuid.UUID) -> Job:
    job = await session.get(Job, job_id)
    if job is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Job not found.")
    return job


@router.get("/{job_id}", response_model=JobRead)
async def get_job(job_id: uuid.UUID, user: DispatcherUser, session: Session):
    job = await _get_job(session, job_id)
    plan_id = (await session.exec(select(Plan.id).where(Plan.job_id == job.id))).first()
    time_limit = (job.payload or {}).get("time_limit_s")
    return JobRead.model_validate(job).model_copy(update={
        "time_limit_s": float(time_limit) if isinstance(time_limit, int | float) else None,
        "plan_id": plan_id,
    })


@router.get("/{job_id}/result", response_model=SolveResult)
async def get_job_result(job_id: uuid.UUID, user: DispatcherUser, session: Session):
    """409 while queued/running, 409 with the error if failed."""
    job = await _get_job(session, job_id)
    if job.status in (JobStatus.queued, JobStatus.running):
        raise HTTPException(status.HTTP_409_CONFLICT, f"The job is still {job.status.value}.")
    if job.status == JobStatus.failed:
        raise HTTPException(status.HTTP_409_CONFLICT, job.error or "The job failed.")
    if job.result is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "The job has no result.")
    return SolveResult.model_validate(job.result)
