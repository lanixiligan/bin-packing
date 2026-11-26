"""Job status and results: /api/jobs/*. Owner: Agent B. Dispatchers only."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlmodel.ext.asyncio.session import AsyncSession

from app.auth import DispatcherUser
from app.db import get_session
from app.routers._stub import todo
from app.schemas import JobRead, SolveResult

router = APIRouter()
Session = Annotated[AsyncSession, Depends(get_session)]


@router.get("/{job_id}", response_model=JobRead)
async def get_job(job_id: uuid.UUID, user: DispatcherUser, session: Session):
    raise todo()


@router.get("/{job_id}/result", response_model=SolveResult)
async def get_job_result(job_id: uuid.UUID, user: DispatcherUser, session: Session):
    """409 while queued/running, 409 with the error if failed."""
    raise todo()
