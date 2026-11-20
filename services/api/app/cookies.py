"""Session cookies. Sessions slide on the server, so every authenticated response re-sends
the cookie with a fresh Max-Age; otherwise the browser would drop it at a fixed time."""

from fastapi import FastAPI, Request, Response


def set_session_cookie(response: Response, name: str, token: str, max_age: int) -> None:
    response.set_cookie(
        name, token, max_age=max_age, path="/api", secure=True, httponly=True, samesite="lax"
    )


def clear_session_cookie(response: Response, name: str) -> None:
    response.delete_cookie(name, path="/api", secure=True, httponly=True, samesite="lax")


_REFRESH_KEY = "saiflow.refresh_cookies"


def refresh_later(request: Request, name: str, token: str, max_age: int) -> None:
    # Kept in the request's own ASGI scope, not request.state: request.state is backed by
    # the lifespan state dict, which some servers (and the test harness) share across
    # requests, so a token stored there could be sent to another client.
    request.scope.setdefault(_REFRESH_KEY, {})[name] = (token, max_age)


def install_cookie_refresh(app: FastAPI) -> None:
    @app.middleware("http")
    async def refresh_session_cookies(request: Request, call_next):
        response = await call_next(request)
        refresh = request.scope.get(_REFRESH_KEY) or {}
        already = [h for k, h in response.raw_headers if k.lower() == b"set-cookie"]
        for name, (token, max_age) in refresh.items():
            if not any(h.startswith(f"{name}=".encode()) for h in already):
                set_session_cookie(response, name, token, max_age)
        return response
