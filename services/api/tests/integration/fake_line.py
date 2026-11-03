from app.integrations.line import LineIdentity, LineInvalidToken


class FakeLineClient:
    """Stands in for LineClient: known tokens map to identities; codes map to tokens."""

    def __init__(self) -> None:
        self.tokens: dict[str, LineIdentity] = {}
        self.codes: dict[str, str] = {}
        self.fail_with: Exception | None = None

    def add(self, token: str, sub: str, name: str | None = "LINE Name", picture=None, email=None):
        self.tokens[token] = LineIdentity(sub, name, picture, email)

    async def verify_id_token(self, id_token: str) -> LineIdentity:
        if self.fail_with:
            raise self.fail_with
        if id_token not in self.tokens:
            raise LineInvalidToken()
        return self.tokens[id_token]

    async def exchange_code(self, code: str, redirect_uri: str) -> str:
        if self.fail_with:
            raise self.fail_with
        if code not in self.codes:
            raise LineInvalidToken()
        return self.codes[code]
