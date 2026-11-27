"""
Truck load planner API.

    cd backend && uvicorn app.main:app --reload --port 8000

Routes are under /api: GET /api/health, GET /api/reference, POST /api/plan and
POST /api/plan/fleet for the load planner. Docs: /docs.
CORS_ORIGINS (comma-separated) lists the browser origins allowed to call it.
"""

import os

from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import planner

# Request bodies are capped while they stream in (413 past the limit).
MAX_BODY_BYTES = 1024 * 1024
CORS_ORIGINS = os.environ.get("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173")

app = FastAPI(title="Truck Load Planner", version="2.0.0", max_body_size=MAX_BODY_BYTES)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in CORS_ORIGINS.split(",") if o.strip()],
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)

api = APIRouter(prefix="/api")


@api.get("/health", tags=["meta"])
async def health() -> dict[str, str]:
    return {"status": "ok"}


api.include_router(planner.router, tags=["planner"])
app.include_router(api)
