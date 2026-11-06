"""Private object storage for originals, previews and exports (ADR-008, ADR-009 T8).

Objects are only ever read back through the backend; nothing here makes public or signed
URLs. GCS in deployment, an in-memory store in tests.
"""

import asyncio
from typing import Protocol


class ObjectMissing(LookupError):
    """The named object does not exist."""


class ObjectStore(Protocol):
    async def put(self, name: str, data: bytes, content_type: str) -> None: ...
    async def get(self, name: str) -> bytes: ...
    async def exists(self, name: str) -> bool: ...
    async def delete(self, name: str) -> None: ...


class MemoryStore:
    def __init__(self) -> None:
        self.objects: dict[str, tuple[bytes, str]] = {}

    async def put(self, name: str, data: bytes, content_type: str) -> None:
        self.objects[name] = (bytes(data), content_type)

    async def get(self, name: str) -> bytes:
        try:
            return self.objects[name][0]
        except KeyError:
            raise ObjectMissing(name) from None

    async def exists(self, name: str) -> bool:
        return name in self.objects

    async def delete(self, name: str) -> None:
        self.objects.pop(name, None)


class GcsStore:
    """One private bucket; the client is synchronous, so calls run in a worker thread."""

    def __init__(self, bucket: str, credentials_file: str | None = None) -> None:
        from google.cloud import storage

        client = (
            storage.Client.from_service_account_json(credentials_file)
            if credentials_file
            else storage.Client()
        )
        self._bucket = client.bucket(bucket)

    async def put(self, name: str, data: bytes, content_type: str) -> None:
        blob = self._bucket.blob(name)
        await asyncio.to_thread(blob.upload_from_string, data, content_type=content_type)

    async def get(self, name: str) -> bytes:
        from google.api_core.exceptions import NotFound

        try:
            return await asyncio.to_thread(self._bucket.blob(name).download_as_bytes)
        except NotFound:
            raise ObjectMissing(name) from None

    async def exists(self, name: str) -> bool:
        return await asyncio.to_thread(self._bucket.blob(name).exists)

    async def delete(self, name: str) -> None:
        from google.api_core.exceptions import NotFound

        try:
            await asyncio.to_thread(self._bucket.blob(name).delete)
        except NotFound:
            pass
