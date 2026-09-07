from __future__ import annotations

import asyncio
import json
from collections import deque
from typing import Any

from fastapi import APIRouter, Query, Request
from fastapi.responses import StreamingResponse


class ResearchEventStream:
    """In-memory report lifecycle events for the Studio SSE connection."""

    def __init__(self, history_limit: int = 1_000) -> None:
        self._subscribers: list[asyncio.Queue[str]] = []
        self._history: deque[tuple[int, str]] = deque(maxlen=history_limit)
        self._sequence = 0

    @property
    def current_sequence(self) -> int:
        return self._sequence

    def subscribe(self, *, after_sequence: int) -> asyncio.Queue[str]:
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


def create_report_events_router(event_stream: ResearchEventStream) -> APIRouter:
    router = APIRouter()

    @router.get("/report-events")
    async def report_events(
        request: Request,
        workspace_id: str = Query(min_length=1),
        after: int | None = Query(default=None, ge=0),
    ) -> StreamingResponse:
        last_event_id = request.headers.get("last-event-id")
        try:
            resume_after = int(last_event_id) if last_event_id else after
        except ValueError:
            resume_after = after
        # A new Studio connection gets future events only. EventSource sends
        # Last-Event-ID when reconnecting, so events missed during a brief
        # disconnect are replayed from the bounded history.
        queue = event_stream.subscribe(
            after_sequence=event_stream.current_sequence if resume_after is None else resume_after
        )

        async def generate():
            try:
                while True:
                    try:
                        message = await asyncio.wait_for(queue.get(), timeout=15)
                    except asyncio.TimeoutError:
                        yield ": keep-alive\n\n"
                        continue
                    payload = json.loads(message)
                    if payload.get("data", {}).get("workspace_id") != workspace_id:
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
