"""
Write the reference data the frontend's tests use to frontend/src/shared/test/reference.json.

    cd backend && .venv/bin/python -m scripts.export_fixtures      (or: make fixtures)

Re-run this after changing the reference data.
"""

import json
from pathlib import Path

from app.reference import load_reference

OUT = Path(__file__).resolve().parents[2] / "frontend" / "src" / "shared" / "test" / "reference.json"


def main() -> None:
    ref = load_reference()
    OUT.write_text(json.dumps(ref.model_dump(mode="json"), indent=1) + "\n")
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
