"""LINE Login: verify ID tokens (LIFF and web) and exchange web authorization codes.

Transient failures (timeouts, connection errors, 5xx, 429) are retried (D5); a 400 from
LINE means the token or code is not valid and is never retried."""

import asyncio
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

import httpx

from app.retry import with_retries

VERIFY_URL = "https://api.line.me/oauth2/v2.1/verify"
TOKEN_URL = "https://api.line.me/oauth2/v2.1/token"
ISSUER = "https://access.line.me"


@dataclass(frozen=True)
class LineIdentity:
    sub: str
    name: str | None
    picture: str | None
    email: str | None


class LineInvalidToken(Exception):
    pass


class LineUnavailable(Exception):
    pass


class _Transient(Exception):
    pass


def _is_transient(exc: BaseException) -> bool:
    return isinstance(exc, _Transient | httpx.TimeoutException | httpx.TransportError)


class LineClient:
    def __init__(
        self,
        channel_id: str,
        channel_secret: str | None,
        http: httpx.AsyncClient,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> None:
        self.channel_id, self.channel_secret, self.http, self.sleep = (
            channel_id,
            channel_secret,
            http,
            sleep,
        )

    async def _post(self, url: str, form: dict[str, str]) -> dict:
        async def call() -> dict:
            r = await self.http.post(url, data=form)
            if r.status_code == 429 or r.status_code >= 500:
                raise _Transient(r.status_code)
            if r.status_code != 200:
                raise LineInvalidToken()
            return r.json()

        try:
            return await with_retries(call, is_transient=_is_transient, sleep=self.sleep)
        except LineInvalidToken:
            raise
        except Exception as exc:  # retries used up, or an unexpected transport failure
            raise LineUnavailable(type(exc).__name__) from None

    async def verify_id_token(self, id_token: str) -> LineIdentity:
        claims = await self._post(VERIFY_URL, {"id_token": id_token, "client_id": self.channel_id})
        if (
            claims.get("iss") != ISSUER
            or claims.get("aud") != self.channel_id
            or not claims.get("sub")
        ):
            raise LineInvalidToken()
        return LineIdentity(
            sub=claims["sub"],
            name=claims.get("name"),
            picture=claims.get("picture"),
            email=claims.get("email"),
        )

    async def exchange_code(self, code: str, redirect_uri: str) -> str:
        if not self.channel_secret:
            raise LineUnavailable("channel secret not configured")
        body = await self._post(
            TOKEN_URL,
            {
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": redirect_uri,
                "client_id": self.channel_id,
                "client_secret": self.channel_secret,
            },
        )
        token = body.get("id_token")
        if not token:
            raise LineInvalidToken()
        return token
