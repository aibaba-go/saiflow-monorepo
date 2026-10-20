"""pytest bootstrap: make `services/api` importable as a package root.

The repository's Python sources live in this directory alongside packages
(`textin/`, `routes/`, ...); without this, `from textin.config import ...`
inside test files resolves to nothing because pytest's default sys.path
is the project root above us.
"""
from __future__ import annotations

import sys
from pathlib import Path

_API_ROOT = Path(__file__).resolve().parent
if str(_API_ROOT) not in sys.path:
    sys.path.insert(0, str(_API_ROOT))
