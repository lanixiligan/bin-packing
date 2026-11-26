"""Settings, read from environment variables and the repo-root `.env` file."""

from datetime import date, datetime
from decimal import Decimal
from pathlib import Path
from zoneinfo import ZoneInfo

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = BACKEND_DIR.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(REPO_ROOT / ".env", BACKEND_DIR / ".env"),
        extra="ignore",
    )

    DATABASE_URL: str = "postgresql+asyncpg://freight:freight@127.0.0.1:5432/freight"
    # Tests set this so each test gets fresh connections on its own event loop.
    DB_NULLPOOL: bool = False
    REDIS_URL: str = "redis://127.0.0.1:6379/0"
    ARQ_QUEUE_NAME: str = "freight:queue"

    JWT_SECRET: str = "dev-only-change-me"
    JWT_LIFETIME_SECONDS: int = 86400

    UPLOAD_DIR: Path = BACKEND_DIR / "uploads"
    MAX_UPLOAD_BYTES: int = 5 * 1024 * 1024

    CORS_ORIGINS: str = "http://localhost:5173,http://127.0.0.1:5173"

    CUBIC_FACTOR: Decimal = Decimal("250")
    DEFAULT_RATE_PER_KG: Decimal = Decimal("0.60")

    SOLVER_TIME_LIMIT_S: float = 10.0

    # Only "dev" (set in .env for local work and by the tests) allows the default
    # JWT secret. Anything else, including leaving it unset, needs a real secret.
    APP_ENV: str = "prod"
    # Business timezone: the driver's "today" and invoice months use it.
    BUSINESS_TZ: str = "Australia/Sydney"

    @property
    def cors_origins(self) -> list[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]

    @property
    def upload_dir(self) -> Path:
        """UPLOAD_DIR resolved against backend/ when it is relative."""
        p = Path(self.UPLOAD_DIR)
        return p if p.is_absolute() else BACKEND_DIR / p


    @property
    def tz(self) -> ZoneInfo:
        return ZoneInfo(self.BUSINESS_TZ)

    def today(self) -> date:
        """Today's date in the business timezone."""
        return datetime.now(self.tz).date()


settings = Settings()

DEV_JWT_SECRET = "dev-only-change-me"
MIN_JWT_SECRET_LENGTH = 32

if settings.APP_ENV != "dev" and (
    settings.JWT_SECRET == DEV_JWT_SECRET or len(settings.JWT_SECRET) < MIN_JWT_SECRET_LENGTH
):
    raise RuntimeError(
        f"Set JWT_SECRET to a random value of at least {MIN_JWT_SECRET_LENGTH} characters "
        "(python3 -c \"import secrets; print(secrets.token_urlsafe(48))\"), "
        "or set APP_ENV=dev for local development."
    )
