from __future__ import annotations

import json
import os
import re
import tempfile
import time
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable
from uuid import uuid4


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _duration_ms(start_ms: float | None, end_ms: float | None) -> float | None:
    if start_ms is None or end_ms is None:
        return None
    return round(max(0.0, end_ms - start_ms), 3)


@dataclass(slots=True)
class TurnTrace:
    call_id: str
    input_item_id: str
    speech_started_ms: float | None = None
    speech_stopped_ms: float | None = None
    audio_committed_ms: float | None = None
    transcription_completed_ms: float | None = None
    transcription_status: str = "pending"
    vad_audio_start_ms: int | None = None
    vad_audio_end_ms: int | None = None
    response_request_ids: list[str] = field(default_factory=list)


@dataclass(slots=True)
class ResponseTrace:
    request_id: str
    trigger: str
    input_item_id: str | None
    context: dict[str, str]
    response_id: str | None = None
    assistant_item_ids: list[str] = field(default_factory=list)
    scheduled_ms: float | None = None
    requested_ms: float | None = None
    created_ms: float | None = None
    first_audio_delta_ms: float | None = None
    first_twilio_media_sent_ms: float | None = None
    output_audio_done_ms: float | None = None
    response_done_ms: float | None = None
    playback_completed_ms: float | None = None
    status: str = "scheduled"
    interrupted: bool = False
    error_type: str | None = None


class TraceCollector:
    """Collects non-PII call latency events using one monotonic clock."""

    def __init__(
        self,
        call_id: str,
        *,
        clock_ns: Callable[[], int] = time.perf_counter_ns,
    ) -> None:
        self.call_id = call_id
        self.trace_id = uuid4().hex
        self.created_at = _utc_now()
        self.completed_at: str | None = None
        self._clock_ns = clock_ns
        self._origin_ns = clock_ns()
        self._call_events_ms: dict[str, float] = {}
        self._turns: list[TurnTrace] = []
        self._turns_by_item_id: dict[str, TurnTrace] = {}
        self._responses: list[ResponseTrace] = []
        self._responses_by_request_id: dict[str, ResponseTrace] = {}
        self._request_id_by_response_id: dict[str, str] = {}
        self._request_id_by_assistant_item_id: dict[str, str] = {}

    def set_call_id(self, call_id: str) -> None:
        self.call_id = call_id
        for turn in self._turns:
            turn.call_id = call_id

    def mark_call_started(self) -> None:
        self._call_events_ms.setdefault("started", self._now_ms())

    def mark_speech_started(self, item_id: str, audio_start_ms: int) -> None:
        turn = self._get_or_create_turn(item_id)
        if turn.speech_started_ms is None:
            turn.speech_started_ms = self._now_ms()
        turn.vad_audio_start_ms = audio_start_ms

    def mark_speech_stopped(self, item_id: str, audio_end_ms: int) -> None:
        turn = self._get_or_create_turn(item_id)
        if turn.speech_stopped_ms is None:
            turn.speech_stopped_ms = self._now_ms()
        turn.vad_audio_end_ms = audio_end_ms

    def mark_audio_committed(self, item_id: str) -> None:
        turn = self._get_or_create_turn(item_id)
        if turn.audio_committed_ms is None:
            turn.audio_committed_ms = self._now_ms()

    def mark_transcription_completed(self, item_id: str) -> None:
        turn = self._get_or_create_turn(item_id)
        if turn.transcription_completed_ms is None:
            turn.transcription_completed_ms = self._now_ms()
        turn.transcription_status = "completed"

    def mark_transcription_failed(self, item_id: str) -> None:
        turn = self._get_or_create_turn(item_id)
        if turn.transcription_completed_ms is None:
            turn.transcription_completed_ms = self._now_ms()
        turn.transcription_status = "failed"

    def response_scheduled(
        self,
        *,
        trigger: str,
        input_item_id: str | None,
        context: dict[str, Any] | None = None,
    ) -> tuple[str, dict[str, str]]:
        request_id = uuid4().hex
        safe_context = {str(key): str(value) for key, value in (context or {}).items() if value is not None}
        response = ResponseTrace(
            request_id=request_id,
            trigger=trigger,
            input_item_id=input_item_id,
            context=safe_context,
            scheduled_ms=self._now_ms(),
        )
        self._responses.append(response)
        self._responses_by_request_id[request_id] = response
        if input_item_id:
            turn = self._get_or_create_turn(input_item_id)
            turn.response_request_ids.append(request_id)

        metadata = {
            "trace_request_id": request_id,
            "trigger": trigger,
            **safe_context,
        }
        if input_item_id:
            metadata["input_item_id"] = input_item_id
        return request_id, metadata

    def mark_response_requested(self, request_id: str) -> None:
        response = self._responses_by_request_id.get(request_id)
        if response is None:
            return
        if response.requested_ms is None:
            response.requested_ms = self._now_ms()
        response.status = "requested"

    def mark_response_request_failed(self, request_id: str, error: Exception) -> None:
        response = self._responses_by_request_id.get(request_id)
        if response is None:
            return
        response.status = "request_failed"
        response.error_type = type(error).__name__

    def mark_response_created(
        self,
        response_id: str,
        metadata: dict[str, Any] | None,
    ) -> None:
        request_id = str((metadata or {}).get("trace_request_id", ""))
        response = self._responses_by_request_id.get(request_id)
        if response is None:
            return
        response.response_id = response_id
        if response.created_ms is None:
            response.created_ms = self._now_ms()
        response.status = "created"
        self._request_id_by_response_id[response_id] = request_id

    def mark_first_audio_delta(self, response_id: str, item_id: str) -> None:
        response = self._response_for_response_id(response_id)
        if response is None:
            return
        if response.first_audio_delta_ms is None:
            response.first_audio_delta_ms = self._now_ms()
        if item_id and item_id not in response.assistant_item_ids:
            response.assistant_item_ids.append(item_id)
            self._request_id_by_assistant_item_id[item_id] = response.request_id

    def mark_twilio_media_sent(self, response_id: str, item_id: str) -> None:
        response = self._response_for_response_id(response_id)
        if response is None and item_id:
            response = self._response_for_assistant_item(item_id)
        if response is None:
            return
        if response.first_twilio_media_sent_ms is None:
            response.first_twilio_media_sent_ms = self._now_ms()

    def mark_output_audio_done(self, response_id: str) -> None:
        response = self._response_for_response_id(response_id)
        if response is not None and response.output_audio_done_ms is None:
            response.output_audio_done_ms = self._now_ms()

    def mark_response_done(self, response_id: str, status: str | None) -> None:
        response = self._response_for_response_id(response_id)
        if response is None:
            return
        if response.response_done_ms is None:
            response.response_done_ms = self._now_ms()
        response.status = status or "done"

    def mark_playback_completed(self, item_id: str) -> None:
        response = self._response_for_assistant_item(item_id)
        if response is not None:
            response.playback_completed_ms = self._now_ms()

    def mark_interrupted(self, item_id: str) -> None:
        response = self._response_for_assistant_item(item_id)
        if response is not None:
            response.interrupted = True

    def finalize(self) -> dict[str, Any]:
        if self.completed_at is None:
            self.completed_at = _utc_now()
            self._call_events_ms["completed"] = self._now_ms()
        return self.snapshot()

    def snapshot(self) -> dict[str, Any]:
        return {
            "schema_version": "1.0",
            "trace_id": self.trace_id,
            "call_id": self.call_id,
            "created_at": self.created_at,
            "completed_at": self.completed_at,
            "call_events_ms": dict(self._call_events_ms),
            "turns": [self._turn_snapshot(turn) for turn in self._turns],
            "responses": [self._response_snapshot(response) for response in self._responses],
        }

    def save_json(self, directory: str | Path) -> Path:
        target_dir = Path(directory).expanduser().resolve()
        target_dir.mkdir(parents=True, exist_ok=True)
        safe_call_id = re.sub(r"[^A-Za-z0-9_.-]", "_", self.call_id) or "unknown-call"
        target = target_dir / f"{safe_call_id}.json"

        fd, temporary_name = tempfile.mkstemp(prefix=f".{safe_call_id}.", suffix=".tmp", dir=target_dir)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as file:
                json.dump(self.snapshot(), file, ensure_ascii=False, indent=2)
                file.write("\n")
            os.replace(temporary_name, target)
        except Exception:
            try:
                os.unlink(temporary_name)
            except FileNotFoundError:
                pass
            raise
        return target

    def _turn_snapshot(self, turn: TurnTrace) -> dict[str, Any]:
        data = asdict(turn)
        responses = [
            self._responses_by_request_id[request_id]
            for request_id in turn.response_request_ids
            if request_id in self._responses_by_request_id
        ]
        first_scheduled = self._first_event(responses, "scheduled_ms")
        first_requested = self._first_event(responses, "requested_ms")
        first_audio = self._first_event(responses, "first_audio_delta_ms")
        data["latency_ms"] = {
            "speech_stop_to_commit": _duration_ms(
                turn.speech_stopped_ms,
                turn.audio_committed_ms,
            ),
            "commit_to_response_scheduled": _duration_ms(
                turn.audio_committed_ms,
                first_scheduled,
            ),
            "commit_to_response_requested": _duration_ms(
                turn.audio_committed_ms,
                first_requested,
            ),
            "commit_to_first_audio": _duration_ms(
                turn.audio_committed_ms,
                first_audio,
            ),
            "commit_to_transcription": _duration_ms(
                turn.audio_committed_ms,
                turn.transcription_completed_ms,
            ),
        }
        data["response_requested_before_transcription_completed"] = (
            first_requested is not None
            and turn.transcription_completed_ms is not None
            and first_requested <= turn.transcription_completed_ms
        )
        return data

    @staticmethod
    def _response_snapshot(response: ResponseTrace) -> dict[str, Any]:
        data = asdict(response)
        data["latency_ms"] = {
            "scheduled_to_requested": _duration_ms(
                response.scheduled_ms,
                response.requested_ms,
            ),
            "requested_to_created": _duration_ms(
                response.requested_ms,
                response.created_ms,
            ),
            "created_to_first_audio": _duration_ms(
                response.created_ms,
                response.first_audio_delta_ms,
            ),
            "requested_to_first_audio": _duration_ms(
                response.requested_ms,
                response.first_audio_delta_ms,
            ),
            "first_audio_to_audio_done": _duration_ms(
                response.first_audio_delta_ms,
                response.output_audio_done_ms,
            ),
            "audio_done_to_playback_completed": _duration_ms(
                response.output_audio_done_ms,
                response.playback_completed_ms,
            ),
        }
        return data

    def _get_or_create_turn(self, item_id: str) -> TurnTrace:
        if not item_id:
            raise ValueError("input item_id is required to collect a turn trace")
        turn = self._turns_by_item_id.get(item_id)
        if turn is None:
            turn = TurnTrace(call_id=self.call_id, input_item_id=item_id)
            self._turns.append(turn)
            self._turns_by_item_id[item_id] = turn
        return turn

    def _response_for_response_id(self, response_id: str) -> ResponseTrace | None:
        request_id = self._request_id_by_response_id.get(response_id)
        return self._responses_by_request_id.get(request_id or "")

    def _response_for_assistant_item(self, item_id: str) -> ResponseTrace | None:
        request_id = self._request_id_by_assistant_item_id.get(item_id)
        return self._responses_by_request_id.get(request_id or "")

    @staticmethod
    def _first_event(
        responses: list[ResponseTrace],
        attribute: str,
    ) -> float | None:
        values = [value for response in responses if (value := getattr(response, attribute)) is not None]
        return min(values) if values else None

    def _now_ms(self) -> float:
        return round((self._clock_ns() - self._origin_ns) / 1_000_000, 3)
