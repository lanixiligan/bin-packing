"""
Freight operations platform API.

    cd backend && uvicorn app.main:app --reload --port 8000

All routes are under /api. Interactive docs: /docs. Orchestrator-owned.
"""

from contextlib import asynccontextmanager

from fastapi import APIRouter, FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.openapi.utils import get_openapi
from fastapi.responses import JSONResponse
from pydantic.json_schema import models_json_schema

from app import workers
from app.auth import auth_backend, fastapi_users, users_router
from app.config import settings
from app.lifecycle import TransitionError
from app.routers import demo, driver, jobs, ops, portal
from app.schemas import InfeasibleDetail, UserCreate, UserRead


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    await workers.close_pool()


# Every request body is capped while it streams in (413 past the limit). The POD
# upload route raises its own limit to fit a photo (app/routers/driver.py).
MAX_BODY_BYTES = 1024 * 1024

app = FastAPI(title="Freight Operations Platform", version="0.1.0", lifespan=lifespan,
              max_body_size=MAX_BODY_BYTES)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_methods=["*"],
    allow_headers=["Authorization", "Content-Type"],
)


@app.exception_handler(TransitionError)
async def transition_error_handler(request: Request, exc: TransitionError) -> JSONResponse:
    return JSONResponse(status_code=status.HTTP_409_CONFLICT, content={"detail": exc.message})


api = APIRouter(prefix="/api")


@api.get("/health", tags=["meta"])
async def health() -> dict[str, str]:
    return {"status": "ok"}


api.include_router(fastapi_users.get_auth_router(auth_backend), prefix="/auth/jwt", tags=["auth"])
api.include_router(fastapi_users.get_register_router(UserRead, UserCreate), prefix="/auth", tags=["auth"])
api.include_router(users_router, prefix="/users", tags=["users"])
api.include_router(portal.router, prefix="/portal", tags=["portal"])
api.include_router(ops.router, prefix="/ops", tags=["ops"])
api.include_router(driver.router, prefix="/driver", tags=["driver"])
api.include_router(driver.pods_router, prefix="/pods", tags=["driver"])
api.include_router(jobs.router, prefix="/jobs", tags=["jobs"])
api.include_router(demo.router, tags=["demo"])
app.include_router(api)


def custom_openapi() -> dict:
    """The default schema, plus models that only appear inside error details."""
    if app.openapi_schema:
        return app.openapi_schema
    schema = get_openapi(title=app.title, version=app.version, routes=app.routes)
    _, extra = models_json_schema([(InfeasibleDetail, "serialization")],
                                  ref_template="#/components/schemas/{model}")
    schema.setdefault("components", {}).setdefault("schemas", {}).update(extra.get("$defs", {}))
    app.openapi_schema = schema
    return schema


app.openapi = custom_openapi
