"""Registration, login, deactivation and /api/users/me (fastapi-users with JWT)."""

import pytest
from sqlmodel import select

from app.main import app
from app.models import Company, User, UserRole
from tests.conftest import PASSWORD

REGISTER = "/api/auth/register"
LOGIN = "/api/auth/jwt/login"
SIGNUP = {"email": "Owner@NewCo.example.com", "password": "a-long-secret-1",
          "full_name": "  Olive   Owner ", "company_name": " NewCo   Pty Ltd "}


async def _login(client, email: str, password: str):
    return await client.post(LOGIN, data={"username": email, "password": password})


# ---- Register ---------------------------------------------------------------------

async def test_register_creates_a_company_and_a_customer(client, session):
    r = await client.post(REGISTER, json=SIGNUP)
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["email"] == "owner@newco.example.com"
    assert body["role"] == "customer" and body["full_name"] == "Olive Owner"
    assert body["is_superuser"] is False and body["is_active"] is True and body["is_verified"] is False
    company = await session.get(Company, body["company_id"])
    assert company.name == "NewCo Pty Ltd"
    assert "hashed_password" not in body and "password" not in body


async def test_register_ignores_privileged_fields(client, session, customer):
    evil = {**SIGNUP, "role": "dispatcher", "is_superuser": True, "is_verified": True,
            "is_active": False, "company_id": customer.company.id,
            "id": "00000000-0000-0000-0000-000000000001"}
    r = await client.post(REGISTER, json=evil)
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["role"] == "customer" and body["is_superuser"] is False
    assert body["is_verified"] is False and body["is_active"] is True
    assert body["company_id"] != customer.company.id
    assert body["id"] != evil["id"]
    user = (await session.exec(select(User).where(User.email == "owner@newco.example.com"))).one()
    assert user.role == UserRole.customer and not user.is_superuser
    # The new user can log in and use the portal at once.
    token = (await _login(client, SIGNUP["email"], SIGNUP["password"])).json()["access_token"]
    r = await client.get("/api/portal/items", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200 and r.json() == []


async def test_register_duplicate_email_is_400(client, customer):
    r = await client.post(REGISTER, json={**SIGNUP, "email": customer.user.email.upper()})
    assert r.status_code == 400
    assert r.json()["detail"] == "REGISTER_USER_ALREADY_EXISTS"


async def test_register_duplicate_company_name_is_400(client, session, customer):
    r = await client.post(REGISTER, json={**SIGNUP, "company_name": "acme pty ltd"})
    assert r.status_code == 400
    assert "company with this name" in r.json()["detail"]
    # Nothing half-created.
    assert (await session.exec(select(User).where(User.email == "owner@newco.example.com"))).first() is None
    assert len((await session.exec(select(Company))).all()) == 1


@pytest.mark.parametrize(("password", "reason"), [
    ("short1", "at least 8"),
    ("x" * 129, "at most 128"),
    ("my-owner@newco.example.com-pw", "e-mail"),
    ("MY-OWNER@NEWCO.EXAMPLE.COM", "e-mail"),
])
async def test_register_password_rules(client, session, password, reason):
    r = await client.post(REGISTER, json={**SIGNUP, "password": password})
    assert r.status_code == 400
    detail = r.json()["detail"]
    assert detail["code"] == "REGISTER_INVALID_PASSWORD" and reason in detail["reason"]
    assert (await session.exec(select(Company))).first() is None


@pytest.mark.parametrize("change", [
    {"email": "not-an-email"}, {"full_name": ""}, {"company_name": ""}, {"company_name": None},
])
async def test_register_validation(client, change):
    assert (await client.post(REGISTER, json={**SIGNUP, **change})).status_code == 422


async def test_register_blank_names_are_400(client):
    r = await client.post(REGISTER, json={**SIGNUP, "company_name": "   "})
    assert r.status_code == 400


# ---- Login ----------------------------------------------------------------------

async def test_login_and_me(client, customer):
    r = await _login(client, customer.user.email.upper(), PASSWORD)
    assert r.status_code == 200, r.text
    token = r.json()
    assert token["token_type"] == "bearer" and token["access_token"]
    me = await client.get("/api/users/me", headers={"Authorization": f"Bearer {token['access_token']}"})
    assert me.status_code == 200 and me.json()["email"] == customer.user.email


@pytest.mark.parametrize(("email", "password"), [
    ("customer1@example.com", "wrong-password"),
    ("nobody@example.com", PASSWORD),
])
async def test_login_failure_is_400(client, customer, email, password):
    r = await _login(client, email, password)
    assert r.status_code == 400 and r.json()["detail"] == "LOGIN_BAD_CREDENTIALS"


async def test_inactive_user_cannot_log_in_and_tokens_stop_working(client, session, customer):
    assert (await client.get("/api/users/me", headers=customer.headers)).status_code == 200
    user = await session.get(User, customer.user.id)
    user.is_active = False
    await session.commit()
    r = await _login(client, customer.user.email, PASSWORD)
    assert r.status_code == 400 and r.json()["detail"] == "LOGIN_BAD_CREDENTIALS"
    assert (await client.get("/api/users/me", headers=customer.headers)).status_code == 401
    assert (await client.get("/api/portal/items", headers=customer.headers)).status_code == 401


async def test_logout_needs_a_token(client, customer):
    assert (await client.post("/api/auth/jwt/logout")).status_code == 401
    r = await client.post("/api/auth/jwt/logout", headers=customer.headers)
    assert r.status_code in (200, 204)


async def test_tampered_token_is_401(client, customer):
    token = customer.headers["Authorization"].removeprefix("Bearer ")
    bad = token[:-2] + ("aa" if not token.endswith("aa") else "bb")
    assert (await client.get("/api/users/me", headers={"Authorization": f"Bearer {bad}"})).status_code == 401


# ---- /api/users/me ----------------------------------------------------------------

async def test_me_for_each_role(client, customer, dispatcher, driver):
    me = (await client.get("/api/users/me", headers=customer.headers)).json()
    assert me["role"] == "customer" and me["company_id"] == customer.company.id
    assert me["company_name"] == "Acme Pty Ltd" and me["driver_id"] is None

    me = (await client.get("/api/users/me", headers=dispatcher.headers)).json()
    assert me["role"] == "dispatcher" and me["company_id"] is None
    assert me["company_name"] is None and me["driver_id"] is None

    me = (await client.get("/api/users/me", headers=driver.headers)).json()
    assert me["role"] == "driver" and me["driver_id"] == driver.driver.id
    assert me["company_id"] is None and me["company_name"] is None
    assert me["full_name"] == driver.user.full_name and me["id"] == str(driver.user.id)
    assert "hashed_password" not in me


# ---- Exposed routes ---------------------------------------------------------------

def test_only_the_intended_fastapi_users_routes_exist():
    paths = app.openapi()["paths"]
    auth_routes = {(m.upper(), p) for p, ops in paths.items()
                   if p.startswith(("/api/auth", "/api/users")) for m in ops}
    assert auth_routes == {
        ("POST", "/api/auth/jwt/login"),
        ("POST", "/api/auth/jwt/logout"),
        ("POST", "/api/auth/register"),
        ("GET", "/api/users/me"),
    }
    # No password reset / verify / user admin routes anywhere.
    for p in paths:
        assert not any(word in p for word in ("forgot", "reset", "verify", "/users/{")), p


async def test_unlisted_auth_paths_are_not_served(client, customer):
    uid = customer.user.id
    for method, path in (("POST", "/api/auth/forgot-password"), ("POST", "/api/auth/reset-password"),
                         ("POST", "/api/auth/request-verify-token"), ("PATCH", "/api/users/me"),
                         ("GET", f"/api/users/{uid}"), ("DELETE", f"/api/users/{uid}")):
        r = await client.request(method, path, json={}, headers=customer.headers)
        assert r.status_code in (404, 405), (method, path, r.status_code)
