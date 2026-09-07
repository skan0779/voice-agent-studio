from __future__ import annotations

import asyncio
import json
from collections import deque
from typing import Any

from fastapi import APIRouter, Query, Request
from fastapi.responses import StreamingResponse


class RuntimeEventStream:
    """Small in-memory event broker for live Studio observability.

    Events are retained only for the lifetime of the Runtime process. The
    sequence number lets EventSource reconnect without replaying duplicates.
    """

    def __init__(self, history_limit: int = 3_000) -> None:
        self._subscribers: list[asyncio.Queue[str]] = []
        self._history: deque[tuple[int, str]] = deque(maxlen=history_limit)
        self._sequence = 0

    def subscribe(self, *, after_sequence: int = 0) -> asyncio.Queue[str]:
        queue: asyncio.Queue[str] = asyncio.Queue()
        self._subscribers.append(queue)
        for sequence, message in self._history:
            if sequence > after_sequence:
                queue.put_nowait(message)
        return queue

    def unsubscribe(self, queue: asyncio.Queue[str]) -> None:
        if queue in self._subscribers:
            self._subscribers.remove(queue)

    def emit(self, event: str, data: dict[str, Any]) -> None:
        self._sequence += 1
        message = json.dumps(
            {"sequence": self._sequence, "event": event, "data": data},
            ensure_ascii=False,
        )
        self._history.append((self._sequence, message))
        for queue in tuple(self._subscribers):
            queue.put_nowait(message)


class ScopedRuntimeEventStream:
    """Adds stable call/workspace identity to every gateway event."""

    def __init__(self, stream: Any, metadata: dict[str, Any]) -> None:
        self._stream = stream
        self._metadata = metadata

    def emit(self, event: str, data: dict[str, Any]) -> None:
        self._stream.emit(event, {**data, **self._metadata})


def create_live_events_router(event_stream: RuntimeEventStream) -> APIRouter:
    router = APIRouter()

    @router.get("/live-events")
    async def live_events(
        request: Request,
        workspace_id: str = Query(min_length=1),
        after: int = Query(default=0, ge=0),
    ) -> StreamingResponse:
        last_event_id = request.headers.get("last-event-id", "")
        try:
            reconnect_sequence = int(last_event_id)
        except ValueError:
            reconnect_sequence = 0
        queue = event_stream.subscribe(after_sequence=max(after, reconnect_sequence))

        async def generate():
            try:
                while True:
                    try:
                        message = await asyncio.wait_for(queue.get(), timeout=15)
                    except asyncio.TimeoutError:
                        yield ": keep-alive\n\n"
                        continue
                    payload = json.loads(message)
                    data = payload.get("data", {})
                    if data.get("runtime_workspace_id") != workspace_id:
                        continue
                    yield f"id: {payload['sequence']}\ndata: {message}\n\n"
            finally:
                event_stream.unsubscribe(queue)

        return StreamingResponse(
            generate(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )

    return router
