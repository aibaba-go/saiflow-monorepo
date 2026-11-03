"""Session cookies. Sessions slide on the server, so every authenticated response re-sends
the cookie with a fresh Max-Age; otherwise the browser would drop it at a fixed time."""

from fastapi import FastAPI, Request, Response


def set_session_cookie(response: Response, name: str, token: str, max_age: int) -> None:
    response.set_cookie(
        name, token, max_age=max_age, path="/api", secure=True, httponly=True, samesite="lax"
    )


def clear_session_cookie(response: Response, name: str) -> None:
    response.delete_cookie(name, path="/api", secure=True, httponly=True, samesite="lax")


def refresh_later(request: Request, name: str, token: str, max_age: int) -> None:
    refresh = getattr(request.state, "refresh_cookies", None) or {}
    refresh[name] = (token, max_age)
    request.state.refresh_cookies = refresh


def install_cookie_refresh(app: FastAPI) -> None:
    @app.middleware("http")
    async def refresh_session_cookies(request: Request, call_next):
        response = await call_next(request)
        refresh = getattr(request.state, "refresh_cookies", None) or {}
        already = [h for k, h in response.raw_headers if k.lower() == b"set-cookie"]
        for name, (token, max_age) in refresh.items():
            if not any(h.startswith(f"{name}=".encode()) for h in already):
                set_session_cookie(response, name, token, max_age)
        return response
