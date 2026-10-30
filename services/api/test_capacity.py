"""NFR-PERF-005：gunicorn 线程数与数据库连接池容量必须对齐。

Cloud Run `--concurrency` 须等于 gunicorn `--threads`（部署参数，见 Architecture.md §5）；
本测试守住仓库内可检查的部分：线程数 + OCR worker 的 1 个连接 ≤ 连接池上限，
避免满载时请求线程在连接池上排队。不导入 app.py（会触发 DDL 与 worker）。
"""
from __future__ import annotations

import re
from pathlib import Path

import config

HERE = Path(__file__).resolve().parent


def _gunicorn_flag(name: str) -> int:
    cmd = (HERE / "Dockerfile").read_text(encoding="utf-8")
    match = re.search(rf"^CMD exec gunicorn .*--{name} (\d+)", cmd, re.MULTILINE)
    assert match, f"Dockerfile CMD 缺少 --{name}"
    return int(match.group(1))


def test_single_worker_process():
    assert _gunicorn_flag("workers") == 1


def test_pool_covers_request_threads_and_ocr_worker():
    opts = config.Config.SQLALCHEMY_ENGINE_OPTIONS
    pool_cap = opts["pool_size"] + opts["max_overflow"]
    assert _gunicorn_flag("threads") + 1 <= pool_cap


def test_threads_value_is_documented_concurrency():
    # 部署须带 --concurrency 12；改线程数时同步改部署参数与本断言
    assert _gunicorn_flag("threads") == 12
