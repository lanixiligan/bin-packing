"""
Shared test fixtures. Orchestrator-owned: put extra helpers in your own test
files (or ask). Tests run against a real Postgres: one database per checkout
(named from a hash of its path, so parallel worktrees don't collide),
migrated with Alembic once per session and truncated after every test.
"""

import asyncio
import hashlib
import os
import tempfile
from dataclasses import dataclass
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
_base_url = os.environ.get(
    "TEST_DATABASE_BASE_URL", "postgresql+asyncpg://freight:freight@127.0.0.1:5432/freight"
)
TEST_DB = "freight_test_" + hashlib.sha1(str(BACKEND).encode()).hexdigest()[:10]
TEST_DATABASE_URL = _base_url.rsplit("/", 1)[0] + "/" + TEST_DB
_ADMIN_DSN = _base_url.replace("+asyncpg", "").rsplit("/", 1)[0] + "/postgres"

# Must happen before anything imports app.config.
os.environ["DATABASE_URL"] = TEST_DATABASE_URL
os.environ["DB_NULLPOOL"] = "1"
os.environ["UPLOAD_DIR"] = tempfile.mkdtemp(prefix="freight-uploads-")
os.environ["APP_ENV"] = "dev"
os.environ["JWT_SECRET"] = "test-secret-not-for-production-0123456789"
os.environ.setdefault("ARQ_QUEUE_NAME", f"freight:test:{TEST_DB}")

import asyncpg  # noqa: E402
import httpx  # noqa: E402
import pytest  # noqa: E402
from alembic.config import Config  # noqa: E402
from sqlalchemy import text  # noqa: E402

from alembic import command  # noqa: E402
from app import workers  # noqa: E402
from app.auth import create_user, issue_token  # noqa: E402
from app.db import SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Company, Driver, User, UserRole  # noqa: E402

PASSWORD = "correct-horse-42"


async def _recreate_database() -> None:
    conn = await asyncpg.connect(_ADMIN_DSN)
    try:
        await conn.execute(f'DROP DATABASE IF EXISTS "{TEST_DB}" WITH (FORCE)')
        await conn.execute(f'CREATE DATABASE "{TEST_DB}"')
    finally:
        await conn.close()


@pytest.fixture(scope="session", autouse=True)
def _database():
    asyncio.run(_recreate_database())
    cfg = Config(str(BACKEND / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND / "alembic"))
    cfg.set_main_option("sqlalchemy.url", TEST_DATABASE_URL)
    command.upgrade(cfg, "head")
    yield


@pytest.fixture(autouse=True)
async def _clean_tables():
    yield
    async with engine.begin() as conn:
        tables = (await conn.execute(text(
            "SELECT tablename FROM pg_tables WHERE schemaname = 'public' "
            "AND tablename <> 'alembic_version'"
        ))).scalars().all()
        if tables:
            await conn.execute(text(
                "TRUNCATE " + ", ".join(f'"{t}"' for t in tables) + " RESTART IDENTITY CASCADE"
            ))


@pytest.fixture(autouse=True)
def enqueued(request, monkeypatch):
    """Job ids passed to workers.enqueue_solve (which is replaced, so no Redis is
    needed), unless the test is marked @pytest.mark.real_queue."""
    calls: list = []
    if request.node.get_closest_marker("real_queue") is None:
        async def fake_enqueue(job_id):
            calls.append(job_id)
        monkeypatch.setattr(workers, "enqueue_solve", fake_enqueue)
    return calls


@pytest.fixture
async def session():
    async with SessionLocal() as s:
        yield s


@pytest.fixture
async def client():
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


@dataclass
class Actor:
    """A logged-in user for tests: pass `headers=actor.headers` to the client."""
    user: User
    headers: dict[str, str]
    company: Company | None = None
    driver: Driver | None = None


@pytest.fixture
def make_actor(session):
    """make_actor(role, company_name=None, email=None) -> Actor (committed).
    Customers get a new company unless `company` is passed; drivers get a Driver row."""
    counter = {"n": 0}

    async def _make(role: UserRole, *, company: Company | None = None,
                    company_name: str | None = None, email: str | None = None,
                    full_name: str | None = None) -> Actor:
        counter["n"] += 1
        n = counter["n"]
        if role == UserRole.customer and company is None:
            company = Company(name=company_name or f"Company {n}")
            session.add(company)
            await session.flush()
        user = await create_user(
            session,
            email=email or f"{role.value}{n}@example.com",
            password=PASSWORD,
            role=role,
            full_name=full_name or f"{role.value.title()} {n}",
            company_id=company.id if role == UserRole.customer else None,
        )
        driver = None
        if role == UserRole.driver:
            driver = Driver(user_id=user.id, name=user.full_name, phone="0400 000 000")
            session.add(driver)
        await session.commit()
        token = await issue_token(user)
        return Actor(user=user, headers={"Authorization": f"Bearer {token}"},
                     company=company if role == UserRole.customer else None, driver=driver)

    return _make


@pytest.fixture
async def customer(make_actor) -> Actor:
    return await make_actor(UserRole.customer, company_name="Acme Pty Ltd")


@pytest.fixture
async def other_customer(make_actor) -> Actor:
    """A customer of a DIFFERENT company (for tenant isolation tests)."""
    return await make_actor(UserRole.customer, company_name="Globex Ltd")


@pytest.fixture
async def dispatcher(make_actor) -> Actor:
    return await make_actor(UserRole.dispatcher)


@pytest.fixture
async def driver(make_actor) -> Actor:
    return await make_actor(UserRole.driver)
