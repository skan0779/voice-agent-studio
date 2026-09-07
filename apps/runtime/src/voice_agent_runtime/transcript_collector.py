from __future__ import annotations

import json
import os
import re
import tempfile
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

Speaker = Literal["user", "assistant"]
TurnStatus = Literal["in_progress", "completed", "failed"]
DeliveryStatus = Literal["not_applicable", "pending", "played", "interrupted"]


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass(slots=True)
class TranscriptTurn:
    call_id: str
    turn_id: str
    source_item_id: str
    speaker: Speaker
    started_at_ms: int | None = None
    ended_at_ms: int | None = None
    raw_text: str = ""
    canonical_text: str | None = None
    model: str | None = None
    transcript_pass: str = "realtime"
    status: TurnStatus = "in_progress"
    interrupted: bool = False
    generated_audio_ms: int | None = None
    heard_audio_ms: int | None = None
    delivery_status: DeliveryStatus = "not_applicable"
    response_id: str | None = None
    content_index: int | None = None
    languages: list[dict[str, Any]] = field(default_factory=list)
    usage: dict[str, Any] | None = None
    error: dict[str, Any] | None = None


class TranscriptCollector:
    """Collects Realtime events into stable, item-ID-addressed turns.

    Realtime input transcription completes asynchronously, so list position or
    completion order must never be used to associate text with a user turn.
    """

    def __init__(
        self,
        call_id: str,
        *,
        realtime_model: str,
        transcription_model: str,
    ) -> None:
        self.call_id = call_id
        self.realtime_model = realtime_model
        self.transcription_model = transcription_model
        self.created_at = _utc_now()
        self.completed_at: str | None = None
        self.screening: dict[str, Any] | None = None
        self._turns: list[TranscriptTurn] = []
        self._turns_by_item_id: dict[str, TranscriptTurn] = {}
        self._next_turn_number = 1

    def set_call_id(self, call_id: str) -> None:
        self.call_id = call_id
        for turn in self._turns:
            turn.call_id = call_id

    def set_screening(self, screening: dict[str, Any]) -> None:
        self.screening = screening

    def start_user_turn(self, item_id: str, started_at_ms: int | None) -> TranscriptTurn:
        turn = self._get_or_create(item_id, "user")
        if started_at_ms is not None:
            turn.started_at_ms = started_at_ms
        return turn

    def stop_user_turn(self, item_id: str, ended_at_ms: int | None) -> TranscriptTurn:
        turn = self._get_or_create(item_id, "user")
        if ended_at_ms is not None:
            turn.ended_at_ms = ended_at_ms
        return turn

    def complete_user_turn(
        self,
        item_id: str,
        transcript: str,
        *,
        content_index: int | None = None,
        languages: list[dict[str, Any]] | None = None,
        usage: dict[str, Any] | None = None,
    ) -> TranscriptTurn:
        turn = self._get_or_create(item_id, "user")
        turn.raw_text = transcript.strip()
        turn.content_index = content_index
        turn.languages = languages or []
        turn.usage = usage
        turn.status = "completed"
        return turn

    def fail_user_turn(
        self,
        item_id: str,
        error: dict[str, Any],
        *,
        content_index: int | None = None,
    ) -> TranscriptTurn:
        turn = self._get_or_create(item_id, "user")
        turn.content_index = content_index
        turn.error = error
        turn.status = "failed"
        return turn

    def append_assistant_delta(
        self,
        item_id: str,
        delta: str,
        *,
        response_id: str | None = None,
        content_index: int | None = None,
        started_at_ms: int | None = None,
    ) -> TranscriptTurn:
        turn = self._get_or_create(item_id, "assistant")
        if started_at_ms is not None and turn.started_at_ms is None:
            turn.started_at_ms = started_at_ms
        turn.response_id = response_id or turn.response_id
        turn.content_index = content_index
        turn.raw_text += delta
        turn.delivery_status = "pending"
        return turn

    def complete_assistant_turn(
        self,
        item_id: str,
        transcript: str,
        *,
        response_id: str | None = None,
        content_index: int | None = None,
        ended_at_ms: int | None = None,
    ) -> TranscriptTurn:
        turn = self._get_or_create(item_id, "assistant")
        # The done event is authoritative and avoids duplicated/missed deltas.
        turn.raw_text = transcript.strip() if transcript else turn.raw_text.strip()
        turn.response_id = response_id or turn.response_id
        turn.content_index = content_index
        turn.ended_at_ms = ended_at_ms
        turn.status = "completed"
        if turn.delivery_status == "not_applicable":
            turn.delivery_status = "pending"
        return turn

    def add_assistant_audio(self, item_id: str, duration_ms: int) -> TranscriptTurn:
        turn = self._get_or_create(item_id, "assistant")
        turn.generated_audio_ms = (turn.generated_audio_ms or 0) + max(0, duration_ms)
        turn.delivery_status = "pending"
        return turn

    def acknowledge_assistant_audio(self, item_id: str, heard_audio_ms: int) -> TranscriptTurn:
        turn = self._get_or_create(item_id, "assistant")
        turn.heard_audio_ms = max(turn.heard_audio_ms or 0, heard_audio_ms)
        if (
            not turn.interrupted
            and turn.generated_audio_ms is not None
            and turn.heard_audio_ms >= turn.generated_audio_ms
        ):
            turn.delivery_status = "played"
        return turn

    def interrupt_assistant_turn(
        self,
        item_id: str,
        *,
        heard_audio_ms: int,
        ended_at_ms: int | None = None,
    ) -> TranscriptTurn:
        turn = self._get_or_create(item_id, "assistant")
        turn.interrupted = True
        turn.heard_audio_ms = max(turn.heard_audio_ms or 0, heard_audio_ms)
        turn.ended_at_ms = ended_at_ms
        turn.delivery_status = "interrupted"
        return turn

    def finalize(self) -> dict[str, Any]:
        if self.completed_at is None:
            self.completed_at = _utc_now()
            for turn in self._turns:
                if turn.status == "in_progress":
                    turn.status = "failed"
                    turn.error = {"code": "call_ended", "message": "Call ended before the turn completed."}
        return self.snapshot()

    def snapshot(self) -> dict[str, Any]:
        return {
            "schema_version": "1.0",
            "call_id": self.call_id,
            "created_at": self.created_at,
            "completed_at": self.completed_at,
            "realtime_model": self.realtime_model,
            "transcription_model": self.transcription_model,
            "screening": self.screening,
            "turns": [asdict(turn) for turn in self._turns],
        }

    def save_json(self, directory: str | Path) -> Path:
        """Atomically persist the current snapshot when storage is explicitly enabled."""
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

    def _get_or_create(self, item_id: str, speaker: Speaker) -> TranscriptTurn:
        if not item_id:
            raise ValueError("source item_id is required to collect a transcript turn")
        existing = self._turns_by_item_id.get(item_id)
        if existing is not None:
            if existing.speaker != speaker:
                raise ValueError(f"item_id {item_id!r} was already assigned to {existing.speaker}")
            return existing

        turn = TranscriptTurn(
            call_id=self.call_id,
            turn_id=f"turn-{self._next_turn_number:04d}",
            source_item_id=item_id,
            speaker=speaker,
            model=self.transcription_model if speaker == "user" else self.realtime_model,
            delivery_status="not_applicable" if speaker == "user" else "pending",
        )
        self._next_turn_number += 1
        self._turns.append(turn)
        self._turns_by_item_id[item_id] = turn
        return turn
