"""NFR-PERF-005：gunicorn 线程数与数据库连接池容量必须对齐。

Cloud Run `--concurrency` 须等于 gunicorn `--threads`（部署参数，见 Architecture.md §5）；
本测试守住仓库内可检查的部分：线程数 + OCR worker 与模板映射 worker 各 1 个连接 ≤ 连接池上限，
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


def test_pool_covers_request_threads_and_background_workers():
    # 后台常驻线程：OcrWorker + MappingWorker（design D12，TEMPLATE_MAPPING_ENABLED 开启时启动）
    opts = config.Config.SQLALCHEMY_ENGINE_OPTIONS
    pool_cap = opts["pool_size"] + opts["max_overflow"]
    assert _gunicorn_flag("threads") + 2 <= pool_cap


def test_threads_value_is_documented_concurrency():
    # 部署须带 --concurrency 12；改线程数时同步改部署参数与本断言
    assert _gunicorn_flag("threads") == 12


def _copied_into_image() -> set[str]:
    names: set[str] = set()
    for line in (HERE / "Dockerfile").read_text(encoding="utf-8").splitlines():
        if line.startswith("COPY ") and "requirements.txt" not in line:
            names.update(p.rstrip("/") for p in line.split()[1:-1])
    return names


def test_image_contains_every_local_module_reachable_from_app():
    # Dockerfile 是模块白名单：漏拷本地模块会让容器启动即 ImportError（模板映射首发时发现）
    import ast

    copied = _copied_into_image()
    seen: set[str] = set()
    queue = ["app.py", "manage_templates.py"]
    while queue:
        rel = queue.pop()
        if rel in seen:
            continue
        seen.add(rel)
        path = HERE / rel
        files = sorted(path.glob("*.py")) if path.is_dir() else [path]
        for file in files:
            for node in ast.walk(ast.parse(file.read_text(encoding="utf-8"))):
                if isinstance(node, ast.Import):
                    tops = [a.name.split(".")[0] for a in node.names]
                elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
                    tops = [node.module.split(".")[0]]
                else:
                    continue
                for top in tops:
                    if (HERE / f"{top}.py").is_file():
                        queue.append(f"{top}.py")
                    elif (HERE / top / "__init__.py").is_file():
                        queue.append(top)
    missing = sorted(m for m in seen if m not in copied)
    assert not missing, f"Dockerfile 未 COPY：{missing}"
    assert "templates_seed" in copied
