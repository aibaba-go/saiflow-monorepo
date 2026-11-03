"""Server commands: `python -m app.cli <command>` (run inside the backend container)."""

import argparse
import asyncio
import sys

from app.config import load_settings
from app.db import create_engine, create_sessionmaker


async def _audit_verify() -> int:
    from app.services import audit_service

    engine = create_engine(load_settings())
    try:
        async with create_sessionmaker(engine)() as db:
            broken = await audit_service.find_first_broken(db)
            if broken is not None:
                print(f"audit log BROKEN at id {broken}")
                return 1
            print(f"audit log OK ({await audit_service.count(db)} entries)")
            return 0
    finally:
        await engine.dispose()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.cli")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("audit-verify", help="check that the operation log was not altered")
    args = parser.parse_args(argv)
    if args.command == "audit-verify":
        return asyncio.run(_audit_verify())
    return 2


if __name__ == "__main__":
    sys.exit(main())
