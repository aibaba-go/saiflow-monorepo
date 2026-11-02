# Backend image (saiflow-be-api). Build context: services/api.
FROM python:3.12-slim

COPY --from=ghcr.io/astral-sh/uv:0.13.6 /uv /usr/local/bin/uv
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    UV_PROJECT_ENVIRONMENT=/app/.venv \
    PYTHONUNBUFFERED=1

WORKDIR /app
COPY pyproject.toml uv.lock .python-version ./
RUN uv sync --frozen --no-dev --no-install-project
COPY alembic.ini ./
COPY alembic ./alembic
COPY app ./app

ARG APP_VERSION=dev
ENV APP_VERSION=${APP_VERSION} \
    PORT=8000 \
    PATH=/app/.venv/bin:${PATH}

RUN useradd --uid 10001 --no-create-home app
USER app
EXPOSE 8000
# Shell form so ${PORT} expands (STD-005 §3.6).
# --no-access-log: app.access writes JSON access records that carry the request ID.
CMD uvicorn app.main:app --host 0.0.0.0 --port ${PORT} --no-access-log
