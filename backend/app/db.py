"""Async database engine and the per-request session dependency."""

from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool
from sqlmodel.ext.asyncio.session import AsyncSession

from app.config import settings

engine = create_async_engine(
    settings.DATABASE_URL,
    **({"poolclass": NullPool} if settings.DB_NULLPOOL else {"pool_pre_ping": True}),
)

# expire_on_commit=False: objects stay readable after commit (no lazy reload,
# which async sessions can't do implicitly).
SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def get_session() -> AsyncIterator[AsyncSession]:
    """FastAPI dependency: one session per request."""
    async with SessionLocal() as session:
        yield session
