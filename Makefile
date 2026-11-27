# Truck loading optimizer demo. Run `make help` for the targets.
SHELL := /bin/bash
VENV := backend/.venv
PY := $(VENV)/bin/python
BIN := .venv/bin

.DEFAULT_GOAL := help
.PHONY: help install dev api web test lint build fixtures

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-10s %s\n", $$1, $$2}'

install: ## Create the backend venv and install backend + frontend dependencies
	test -x $(PY) || python3 -m venv $(VENV)
	$(VENV)/bin/pip install -q -r backend/requirements-dev.txt
	cd frontend && npm install

dev: ## Run the API (:8000) and the web app (:5173) together
	@scripts/dev.sh

api: ## Run only the API with reload
	cd backend && $(BIN)/uvicorn app.main:app --reload --port $${API_PORT:-8000}

web: ## Run only the web app dev server
	cd frontend && npm run dev

test: ## Run the backend and frontend tests
	cd backend && $(BIN)/python -m pytest -q
	cd frontend && npm test

lint: ## Lint backend and frontend
	cd backend && $(BIN)/ruff check .
	cd frontend && npm run lint

build: ## Production build of the web app
	cd frontend && npm run build

fixtures: ## Regenerate the frontend's sample API responses from the real planner
	cd backend && $(BIN)/python -m scripts.export_fixtures
