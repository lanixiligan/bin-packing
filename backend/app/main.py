"""
Truck loading demo API.

    cd backend && uvicorn app.main:app --reload --port 8000

Routes are under /api: GET /api/health and POST /api/solve. Docs: /docs.
CORS_ORIGINS (comma-separated) lists the browser origins allowed to call it.
"""

import os

from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import demo

# Request bodies are capped while they stream in (413 past the limit).
MAX_BODY_BYTES = 1024 * 1024
CORS_ORIGINS = os.environ.get("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173")

app = FastAPI(title="Truck Loading Optimizer", version="1.0.0", max_body_size=MAX_BODY_BYTES)

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


api.include_router(demo.router, tags=["demo"])
app.include_router(api)
