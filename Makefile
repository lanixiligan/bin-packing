# Freight operations platform. Run `make help` for the targets.
SHELL := /bin/bash
VENV := backend/.venv
PY := $(VENV)/bin/python
BIN := .venv/bin

.DEFAULT_GOAL := help
.PHONY: help install services services-stop services-status migrate seed dev api worker web \
        test test-backend lint build api-types e2e

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-16s %s\n", $$1, $$2}'

install: ## Create the backend venv and install backend + frontend dependencies
	test -x $(PY) || python3 -m venv $(VENV)
	$(VENV)/bin/pip install -q -r backend/requirements-dev.txt
	cd frontend && npm install

services: ## Start Postgres + Redis (Docker Compose, or local binaries without Docker)
	@scripts/services.sh start

services-stop: ## Stop Postgres + Redis
	@scripts/services.sh stop

services-status: ## Show whether Postgres + Redis are running
	@scripts/services.sh status

migrate: services ## Apply database migrations
	cd backend && $(BIN)/alembic upgrade head

seed: migrate ## Reset the database to the demo data (see README for logins)
	cd backend && $(BIN)/python -m scripts.seed

dev: migrate ## Run API (:8000), worker and web app (:5173) together
	@scripts/dev.sh

api: ## Run only the API with reload
	cd backend && $(BIN)/uvicorn app.main:app --reload --port $${API_PORT:-8000}

worker: ## Run only the solver job worker
	cd backend && $(BIN)/arq app.workers.WorkerSettings

web: ## Run only the web app dev server
	cd frontend && npm run dev

test: services test-backend ## Run the backend checks and test suite (needs Postgres)

test-backend:
	cd backend && $(BIN)/ruff check .
	cd backend && $(BIN)/python -m pytest -q

lint: ## Lint backend and frontend
	cd backend && $(BIN)/ruff check .
	cd frontend && npm run lint

build: ## Production build of the web app
	cd frontend && npm run build

api-types: ## Regenerate frontend/src/api/schema.d.ts from the FastAPI schema
	cd backend && $(BIN)/python -m scripts.export_openapi
	cd frontend && npm run api:types

e2e: ## End-to-end walkthrough against a running stack (E2E_API_URL, E2E_WEB_URL)
	cd e2e && (test -d node_modules || npm install)
	cd e2e && npx playwright test
