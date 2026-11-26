"""Write the API's OpenAPI schema to frontend/src/api/openapi.json (no server needed).

    cd backend && python -m scripts.export_openapi
Then:  cd frontend && npm run api:types
(`make api-types` does both.)
"""

import json
import sys
from pathlib import Path

from app.main import app

OUT = Path(__file__).resolve().parents[2] / "frontend" / "src" / "api" / "openapi.json"


def main() -> None:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(app.openapi(), indent=2, sort_keys=False) + "\n")
    print(f"wrote {OUT.relative_to(Path.cwd().parent) if OUT.is_relative_to(Path.cwd().parent) else OUT}",
          file=sys.stderr)


if __name__ == "__main__":
    main()
