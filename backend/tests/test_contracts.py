"""Orchestrator checks of the shared contracts (schema, migrations, auth basics)."""

from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlmodel import SQLModel

from app.db import engine
from app.lifecycle import TRANSITIONS
from app.main import app
from app.models import OrderStatus, UserRole


async def test_migrations_match_models():
    async with engine.connect() as conn:
        diff = await conn.run_sync(
            lambda c: compare_metadata(MigrationContext.configure(c, opts={"compare_type": True}),
                                       SQLModel.metadata)
        )
    assert diff == [], f"Models and migrations differ; add a migration: {diff}"


def test_openapi_builds_and_every_route_is_under_api():
    schema = app.openapi()
    assert schema["paths"]
    assert all(p.startswith("/api/") for p in schema["paths"])
    assert "InfeasibleDetail" in schema["components"]["schemas"]


async def test_health(client):
    r = await client.get("/api/health")
    assert r.status_code == 200 and r.json() == {"status": "ok"}


async def test_me_requires_login(client):
    assert (await client.get("/api/users/me")).status_code == 401


async def test_me_returns_role_and_company(client, customer, driver):
    me = (await client.get("/api/users/me", headers=customer.headers)).json()
    assert me["role"] == "customer" and me["company_name"] == "Acme Pty Ltd"
    me = (await client.get("/api/users/me", headers=driver.headers)).json()
    assert me["role"] == "driver" and me["driver_id"] == driver.driver.id


def test_every_transition_targets_a_real_status_and_role():
    for (frm, to), roles in TRANSITIONS.items():
        assert isinstance(frm, OrderStatus) and isinstance(to, OrderStatus)
        assert roles and all(isinstance(r, UserRole) for r in roles)
