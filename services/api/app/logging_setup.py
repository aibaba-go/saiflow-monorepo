"""Single-line JSON logs on stdout, each record carrying the current request ID."""

import json
import logging
import sys

from app.request_context import request_id_var

_base_factory = logging.getLogRecordFactory()


def _record_factory(*args, **kwargs) -> logging.LogRecord:
    record = _base_factory(*args, **kwargs)
    record.request_id = request_id_var.get()
    return record


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        entry = {
            "severity": record.levelname,
            "message": record.getMessage(),
            "request_id": getattr(record, "request_id", ""),
            "logger": record.name,
        }
        if record.exc_info:
            entry["exception"] = self.formatException(record.exc_info)
        return json.dumps(entry, ensure_ascii=False)


def configure_logging() -> None:
    logging.setLogRecordFactory(_record_factory)
    root = logging.getLogger()
    if not any(getattr(h, "_saiflow", False) for h in root.handlers):
        handler = logging.StreamHandler(sys.stdout)
        handler.setFormatter(JsonFormatter())
        handler._saiflow = True
        root.addHandler(handler)
    root.setLevel(logging.INFO)
