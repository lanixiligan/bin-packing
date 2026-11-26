"""Placeholder used by Phase 0 router stubs. Delete once every route is implemented."""

from fastapi import HTTPException, status


def todo() -> HTTPException:
    return HTTPException(status.HTTP_501_NOT_IMPLEMENTED, "Not implemented yet.")
