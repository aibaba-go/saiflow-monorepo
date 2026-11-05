"""Server commands: `python -m app.cli <command>` (run inside the backend container)."""

import argparse
import asyncio
import getpass
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


def _read_password() -> str:
    """From a terminal: prompt without echo. From a pipe: the first line, as before."""
    if sys.stdin.isatty():
        return getpass.getpass("password: ")
    return sys.stdin.readline().rstrip("\r\n")


async def _admin(command: str, username: str) -> int:
    from app.services import admin_service

    password = "" if command == "admin-disable" else _read_password()
    engine = create_engine(load_settings())
    try:
        async with create_sessionmaker(engine)() as db:
            try:
                if command == "admin-create":
                    await admin_service.create_admin(db, username, password)
                elif command == "admin-reset-password":
                    await admin_service.reset_password(db, username, password)
                else:
                    await admin_service.disable_admin(db, username)
            except ValueError as exc:
                print(f"{command} failed: {exc}")
                return 1
            await db.commit()
            print(f"{command} OK: {username}")
            return 0
    finally:
        await engine.dispose()


async def _smtp_check(to: str) -> int:
    from app.integrations.email import EmailUnavailable, smtp_sender_from

    sender = smtp_sender_from(load_settings())
    if sender is None:
        print("smtp not configured")
        return 1
    try:
        await sender.send(to, "SaiFlow SMTP check", "This is a test message from SaiFlow.\n")
    except EmailUnavailable as exc:
        print(f"smtp FAILED: {exc}")
        return 1
    print("smtp OK")
    return 0


async def _reminders_pass(settings, sessionmaker) -> str:
    from app.clock import utcnow
    from app.integrations.email import smtp_sender_from
    from app.services import reminder_service

    if not settings.reminders_enabled:
        return "reminders disabled"
    sender = smtp_sender_from(settings, retries=0)  # one attempt per reminder (A6)
    created = await reminder_service.run_once(sessionmaker, sender, utcnow())
    return f"reminders OK ({created} created)"


async def _reminders(loop: bool) -> int:
    """One pass, or (loop) a pass every REMINDER_INTERVAL_SECONDS until SIGTERM or SIGINT;
    a failed pass is logged and the loop goes on (FR-SYS-037)."""
    import logging
    import signal

    from app.logging_setup import configure_logging

    settings = load_settings()
    engine = create_engine(settings)
    sessionmaker = create_sessionmaker(engine)
    try:
        if not loop:
            print(await _reminders_pass(settings, sessionmaker))
            return 0
        configure_logging()
        log = logging.getLogger("app.reminders")
        stop = asyncio.Event()
        for sig in (signal.SIGTERM, signal.SIGINT):
            try:
                asyncio.get_running_loop().add_signal_handler(sig, stop.set)
            except (NotImplementedError, RuntimeError):  # Windows: Ctrl+C still interrupts
                pass
        while not stop.is_set():
            try:
                log.info(await _reminders_pass(settings, sessionmaker))
            except Exception:
                log.exception("reminder pass failed")
            try:
                await asyncio.wait_for(stop.wait(), settings.reminder_interval_seconds)
            except TimeoutError:
                pass
        return 0
    finally:
        await engine.dispose()


ADMIN_COMMANDS = {
    "admin-create": "create a platform admin account (password from standard input)",
    "admin-reset-password": "set a new password (from standard input) and clear the lock",
    "admin-disable": "disable an account and end its sessions",
}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.cli")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("audit-verify", help="check that the operation log was not altered")
    for name, help_text in ADMIN_COMMANDS.items():
        sub.add_parser(name, help=help_text).add_argument("username")
    sub.add_parser("smtp-check", help="send a test email with the SMTP_* settings").add_argument(
        "to"
    )
    sub.add_parser("reminders-run-once", help="run one reminder pass now")
    sub.add_parser("reminders-loop", help="run reminder passes until stopped (compose service)")
    args = parser.parse_args(argv)
    if args.command in ("reminders-run-once", "reminders-loop"):
        return asyncio.run(_reminders(args.command == "reminders-loop"))
    if args.command == "smtp-check":
        return asyncio.run(_smtp_check(args.to))
    if args.command == "audit-verify":
        return asyncio.run(_audit_verify())
    if args.command in ADMIN_COMMANDS:
        return asyncio.run(_admin(args.command, args.username))
    return 2


if __name__ == "__main__":
    sys.exit(main())
