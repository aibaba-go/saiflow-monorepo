"""Write the API contract: `python -m app.export_openapi <path>`.

Uses placeholder settings and never connects to a database, so it runs anywhere
(local, CI contract job) and the output does not depend on the environment.
"""

import json
import sys
from pathlib import Path

from pydantic import SecretStr

from app.config import Settings
from app.main import create_app

_PLACEHOLDER = Settings(
    db_host="placeholder",
    db_name="placeholder",
    db_user="placeholder",
    db_password=SecretStr("placeholder"),
    app_version="contract",
)


def export(path: Path) -> None:
    spec = create_app(_PLACEHOLDER).openapi()
    Path(path).write_text(
        json.dumps(spec, indent=2, sort_keys=True) + "\n", encoding="utf-8", newline="\n"
    )


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("usage: python -m app.export_openapi <path>")
    export(Path(sys.argv[1]))
