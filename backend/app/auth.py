"""
Authentication (fastapi-users, JWT bearer tokens) and role checks.

Owner: Agent A. Everyone else uses only:
    CurrentUser, CustomerUser, DispatcherUser, DriverUser   (Annotated deps)
    require_roles(*roles)                                    (dependency factory)
    CurrentDriver                                            (Driver row of a driver user)
    create_user(...)                                         (seed, tests, ops driver creation)
    issue_token(user)                                        (tests)
"""

import uuid
from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi_users import BaseUserManager, FastAPIUsers, InvalidPasswordException, UUIDIDMixin
from fastapi_users import exceptions as fu_exceptions
from fastapi_users.authentication import AuthenticationBackend, BearerTransport, JWTStrategy
from fastapi_users.password import PasswordHelper
from fastapi_users_db_sqlalchemy import SQLAlchemyUserDatabase
from sqlalchemy.exc import IntegrityError
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.config import settings
from app.db import get_session
from app.models import Company, Driver, User, UserRole
from app.schemas import MeRead, UserCreate

MIN_PASSWORD_LENGTH = 8
password_helper = PasswordHelper()


async def get_user_db(
    session: AsyncSession = Depends(get_session),
) -> AsyncIterator[SQLAlchemyUserDatabase]:
    yield SQLAlchemyUserDatabase(session, User)


class UserManager(UUIDIDMixin, BaseUserManager[User, uuid.UUID]):
    reset_password_token_secret = settings.JWT_SECRET
    verification_token_secret = settings.JWT_SECRET

    async def validate_password(self, password: str, user) -> None:
        if len(password) < MIN_PASSWORD_LENGTH:
            raise InvalidPasswordException(
                reason=f"Password must be at least {MIN_PASSWORD_LENGTH} characters."
            )
        if user.email and user.email.lower() in password.lower():
            raise InvalidPasswordException(reason="Password must not contain the e-mail address.")

    async def create(self, user_create: UserCreate, safe: bool = False,
                     request: Request | None = None) -> User:
        """
        Public registration: always a NEW company + its first customer user.
        Privileged fields (role, is_superuser, is_verified, is_active) are
        never taken from the request.
        """
        await self.validate_password(user_create.password, user_create)
        if await self.user_db.get_by_email(user_create.email) is not None:
            raise fu_exceptions.UserAlreadyExists()

        session: AsyncSession = self.user_db.session
        company = Company(name=user_create.company_name.strip())
        session.add(company)
        try:
            await session.flush()
        except IntegrityError as exc:
            await session.rollback()
            raise HTTPException(status.HTTP_400_BAD_REQUEST,
                                "A company with this name is already registered.") from exc
        user = User(
            email=user_create.email,
            hashed_password=self.password_helper.hash(user_create.password),
            full_name=user_create.full_name.strip(),
            role=UserRole.customer,
            company_id=company.id,
        )
        session.add(user)
        await session.commit()
        await session.refresh(user)
        await self.on_after_register(user, request)
        return user


async def get_user_manager(
    user_db: SQLAlchemyUserDatabase = Depends(get_user_db),
) -> AsyncIterator[UserManager]:
    yield UserManager(user_db, password_helper)


bearer_transport = BearerTransport(tokenUrl="/api/auth/jwt/login")


def get_jwt_strategy() -> JWTStrategy:
    return JWTStrategy(secret=settings.JWT_SECRET, lifetime_seconds=settings.JWT_LIFETIME_SECONDS)


auth_backend = AuthenticationBackend(name="jwt", transport=bearer_transport, get_strategy=get_jwt_strategy)

fastapi_users = FastAPIUsers[User, uuid.UUID](get_user_manager, [auth_backend])

current_active_user = fastapi_users.current_user(active=True)


def require_roles(*roles: UserRole):
    """Dependency: the logged-in, active user, if their role is one of `roles` (else 403)."""
    allowed = frozenset(roles)

    async def dependency(user: User = Depends(current_active_user)) -> User:
        if user.role not in allowed:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "You don't have access to this.")
        if user.role == UserRole.customer and user.company_id is None:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Your account has no company.")
        return user

    return dependency


CurrentUser = Annotated[User, Depends(current_active_user)]
CustomerUser = Annotated[User, Depends(require_roles(UserRole.customer))]
DispatcherUser = Annotated[User, Depends(require_roles(UserRole.dispatcher))]
DriverUser = Annotated[User, Depends(require_roles(UserRole.driver))]


async def get_current_driver(
    user: DriverUser, session: AsyncSession = Depends(get_session)
) -> Driver:
    """The Driver profile of the logged-in driver user (403 if missing or inactive)."""
    driver = (await session.exec(select(Driver).where(Driver.user_id == user.id))).first()
    if driver is None or not driver.active:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "No active driver profile for this account.")
    return driver


CurrentDriver = Annotated[Driver, Depends(get_current_driver)]


async def create_user(
    session: AsyncSession,
    *,
    email: str,
    password: str,
    role: UserRole,
    full_name: str = "",
    company_id: int | None = None,
) -> User:
    """Create a user with a hashed password. Adds and flushes; the caller commits."""
    user = User(
        email=email.lower(),
        hashed_password=password_helper.hash(password),
        full_name=full_name,
        role=role,
        company_id=company_id,
    )
    session.add(user)
    await session.flush()
    return user


async def issue_token(user: User) -> str:
    """A valid access token for `user` (used by tests and scripts)."""
    return await get_jwt_strategy().write_token(user)


# ---- /api/users -----------------------------------------------------------

users_router = APIRouter()


@users_router.get("/me", response_model=MeRead)
async def read_me(user: CurrentUser, session: AsyncSession = Depends(get_session)) -> MeRead:
    me = MeRead.model_validate(user, from_attributes=True)
    if user.company_id is not None:
        company = await session.get(Company, user.company_id)
        me.company_name = company.name if company else None
    if user.role == UserRole.driver:
        driver = (await session.exec(select(Driver).where(Driver.user_id == user.id))).first()
        me.driver_id = driver.id if driver else None
    return me
