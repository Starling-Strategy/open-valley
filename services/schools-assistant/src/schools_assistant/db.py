"""Read-only access to the active Schools publication as `schools_runtime`."""

from __future__ import annotations

import struct
from dataclasses import dataclass, field
from typing import Any, Protocol

import numpy as np
from psycopg import AsyncConnection, IsolationLevel
from psycopg.adapt import Loader
from psycopg.pq import Format
from psycopg_pool import AsyncConnectionPool

from .config import RUNTIME_ROLE

# Both role checks mirror web/src/lib/schools-read.mjs: a connection that has
# switched roles (SET ROLE) or logged in as anyone else reads nothing.
_ROLE_GUARD = f"current_user='{RUNTIME_ROLE}' AND session_user='{RUNTIME_ROLE}'"
_ACTIVE_RELEASE = f"""SELECT release_id FROM schools.current_publication
  WHERE {_ROLE_GUARD} AND payload->>'schema_version'='1'"""
_PUBLICATION = f"""SELECT release_id, payload FROM schools.current_publication
  WHERE {_ROLE_GUARD} AND payload->>'schema_version'='1'"""
_RETRIEVAL = """SELECT embedding_model, dims, passage_count FROM schools.current_retrieval
  WHERE release_id = %s"""
_PASSAGES = """SELECT passage_id, source_id, ordinal, page_start, page_end, text, embedding
  FROM schools.current_passages WHERE release_id = %s ORDER BY source_id, ordinal, passage_id"""


@dataclass(frozen=True)
class PassageRow:
    passage_id: str
    source_id: str
    ordinal: int
    page_start: int | None
    page_end: int | None
    text: str
    embedding: np.ndarray | None


@dataclass(frozen=True)
class Snapshot:
    """One consistent read of a release: payload, retrieval manifest and passages."""

    release_id: str
    payload: dict[str, Any]
    embedding_model: str | None = None
    dims: int | None = None
    passages: list[PassageRow] = field(default_factory=list)


class PublicationStore(Protocol):
    async def active_release_id(self) -> str | None: ...

    async def load_snapshot(self) -> Snapshot | None: ...


_FLOAT4_ARRAY_OID = 1021  # real[]


class _Float4ArrayLoader(Loader):
    """Decode binary real[] straight into float32 numpy arrays.

    Avoids building a Python float per vector component when loading a release.
    """

    format = Format.BINARY

    def load(self, data: Any) -> np.ndarray:
        buffer = bytes(data)
        ndim, has_nulls, _oid = struct.unpack_from(">iiI", buffer, 0)
        if ndim == 0:
            return np.zeros(0, dtype=np.float32)
        if ndim != 1 or has_nulls:
            raise ValueError("unexpected embedding array shape")
        (length, _lower) = struct.unpack_from(">ii", buffer, 12)
        items = np.frombuffer(buffer, dtype=np.dtype([("size", ">i4"), ("value", ">f4")]), count=length, offset=20)
        if not np.all(items["size"] == 4):
            raise ValueError("unexpected embedding element size")
        return items["value"].astype(np.float32)


class PostgresStore:
    def __init__(self, conninfo: str) -> None:
        self._pool = AsyncConnectionPool(
            conninfo,
            min_size=1,
            max_size=3,
            open=False,
            timeout=5,
            kwargs={
                "application_name": "schools-assistant",
                "connect_timeout": 3,
                "options": "-c statement_timeout=3000 -c default_transaction_read_only=on",
            },
            configure=self._configure,
        )

    @staticmethod
    async def _configure(connection: AsyncConnection) -> None:
        connection.adapters.register_loader(_FLOAT4_ARRAY_OID, _Float4ArrayLoader)  # binary format only
        await connection.set_autocommit(True)

    async def open(self) -> None:
        await self._pool.open(wait=False)

    async def close(self) -> None:
        await self._pool.close()

    async def active_release_id(self) -> str | None:
        async with self._pool.connection() as connection:
            rows = await (await connection.execute(_ACTIVE_RELEASE)).fetchall()
        return rows[0][0] if len(rows) == 1 else None

    async def load_snapshot(self) -> Snapshot | None:
        async with self._pool.connection() as connection:
            await connection.set_autocommit(False)
            await connection.set_isolation_level(IsolationLevel.REPEATABLE_READ)
            await connection.set_read_only(True)
            try:
                async with connection.transaction():
                    await connection.execute("SET LOCAL statement_timeout = '60s'")
                    rows = await (await connection.execute(_PUBLICATION)).fetchall()
                    if len(rows) != 1:
                        return None
                    release_id, payload = rows[0]
                    retrieval = await (await connection.execute(_RETRIEVAL, (release_id,))).fetchone()
                    passages: list[PassageRow] = []
                    if retrieval is not None:
                        cursor = connection.cursor(binary=True)
                        await cursor.execute(_PASSAGES, (release_id,))
                        for row in await cursor.fetchall():
                            passages.append(PassageRow(*row))
            finally:
                await connection.set_autocommit(True)
                await connection.set_isolation_level(None)
                await connection.set_read_only(None)
        return Snapshot(
            release_id=release_id,
            payload=payload,
            embedding_model=retrieval[0] if retrieval else None,
            dims=retrieval[1] if retrieval else None,
            passages=passages,
        )
