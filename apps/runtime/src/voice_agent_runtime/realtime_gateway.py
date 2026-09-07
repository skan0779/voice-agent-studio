import asyncio
import base64
import os
import time
from dataclasses import asdict
from uuid import uuid4

from .realtime_session import RealtimeSession
from .trace_collector import TraceCollector
from .transcript_collector import TranscriptCollector


class RealtimeGateway:
    """
    Realtime Gateway for Media Streaming
    - Twilio Media Streams: g711_ulaw(base64) 수신/송신
    - OpenAI GPT-Realtime: g711_ulaw(base64) 수신/송신
    """

    def __init__(
        self,
        event_stream,
        orchestrator_factory=None,
        realtime_session_factory=None,
        initial_input_gate_ms: int | None = None,
    ):
        self.call_id = f"local-{uuid4()}"
        self.trace = TraceCollector(self.call_id)
        self.client = (
            realtime_session_factory(self.trace)
            if realtime_session_factory
            else RealtimeSession(trace_collector=self.trace)
        )
        if orchestrator_factory is None:
            raise ValueError("orchestrator_factory is required")
        self.orchestrator = orchestrator_factory(self.client, event_stream)
        self.transcript = TranscriptCollector(
            self.call_id,
            realtime_model=self.client.model,
            transcription_model=self.client.transcription_model,
        )
        self._transcript_dir = os.getenv("TRANSCRIPT_DIR", "").strip()
        self._trace_dir = os.getenv("TRACE_DIR", "").strip()
        self._transcript_finalized = False
        self._trace_finalized = False
        self.stream_sid = None
        self._task = None
        self._turn_response_tasks: set[asyncio.Task] = set()
        self._stop_lock = asyncio.Lock()
        self._closed = False

        # Call time tracking
        self._start_time = None

        # Barge-in precision tracking (mark/truncation)
        self._latest_media_ts = 0
        self._response_start_ts = None
        self._last_assistant_item = None
        self._mark_sequence = 0
        self._pending_marks: dict[str, tuple[str, int]] = {}
        self._assistant_audio_ms: dict[str, int] = {}
        self._assistant_heard_ms: dict[str, int] = {}
        self._twilio_end_call = None
        self._end_when_audio_played = False
        self._initial_input_gate_active = False
        self._initial_greeting_response_done = False
        self._initial_input_gate_ms = max(
            0,
            initial_input_gate_ms
            if initial_input_gate_ms is not None
            else int(os.getenv("REALTIME_VAD_START_MS", "3000")),
        )
        self._initial_input_gate_timeout_task: asyncio.Task | None = None

        # Emitting events
        self.event_stream = event_stream

    async def realtime_start(
        self,
        phone_number: str | None,
        twilio_send_media,
        twilio_send_mark,
        twilio_send_clear=None,
        twilio_end_call=None,
        selected_instrument_ids: list[str] | None = None,
    ):
        """
        Handle Events from "Realtime" Session to "Twilio" Media Stream
        - connect `client.realtime.connect` and update `connection.session`
        - handle `connection.event` loop
        """

        # Initiate Realtime Session Connection
        self._twilio_end_call = twilio_end_call
        await self.orchestrator.start(
            phone_number,
            selected_instrument_ids=selected_instrument_ids,
        )

        # Text Streaming
        def on_text_delta(
            delta: str,
            item_id: str,
            response_id: str,
            content_index: int,
        ):
            print(delta, end="", flush=True)
            if item_id:
                self.transcript.append_assistant_delta(
                    item_id,
                    delta,
                    response_id=response_id,
                    content_index=content_index,
                    started_at_ms=self._latest_media_ts,
                )
            if self.event_stream:
                self.event_stream.emit(
                    "text_delta",
                    {
                        "delta": delta,
                        "item_id": item_id,
                        "response_id": response_id,
                    },
                )

        # Text Streaming Done
        def on_text_done(
            text: str,
            item_id: str,
            response_id: str,
            content_index: int,
        ):
            print()
            turn = None
            if item_id:
                turn = self.transcript.complete_assistant_turn(
                    item_id,
                    text,
                    response_id=response_id,
                    content_index=content_index,
                    ended_at_ms=self._latest_media_ts,
                )
            if self.event_stream:
                self.event_stream.emit(
                    "text_done",
                    {
                        "text": text,
                        "item_id": item_id,
                        "response_id": response_id,
                        "turn": asdict(turn) if turn else None,
                    },
                )

        # Audio Streaming (twilio stream) + mark/truncation tracking
        async def on_audio_delta(
            b64_audio: str,
            item_id: str,
            response_id: str,
        ):
            if self.stream_sid:
                await twilio_send_media(b64_audio)
                self.trace.mark_twilio_media_sent(response_id, item_id)

                # Track first audio delta timestamp per response
                if self._response_start_ts is None:
                    self._response_start_ts = self._latest_media_ts

                # Track assistant item ID for truncation
                if item_id:
                    self._last_assistant_item = item_id

                    duration_ms = self._pcmu_duration_ms(b64_audio)
                    self._assistant_audio_ms[item_id] = self._assistant_audio_ms.get(item_id, 0) + duration_ms
                    self.transcript.add_assistant_audio(item_id, duration_ms)

                # Send mark to Twilio to track playback position
                if item_id:
                    self._mark_sequence += 1
                    mark_name = f"assistant-{self._mark_sequence}"
                    self._pending_marks[mark_name] = (
                        item_id,
                        self._assistant_audio_ms[item_id],
                    )
                    await twilio_send_mark(mark_name)

        # Barge-in: truncate + clear (precision handling)
        async def on_barge_in():
            if not self.stream_sid:
                return

            # Truncate: tell OpenAI how much audio the user actually heard
            if self._response_start_ts is not None and self._last_assistant_item:
                elapsed = self._latest_media_ts - self._response_start_ts
                item_id = self._last_assistant_item
                generated_ms = self._assistant_audio_ms.get(item_id, 0)
                acknowledged_ms = self._assistant_heard_ms.get(item_id, 0)
                heard_ms = max(
                    acknowledged_ms,
                    min(generated_ms, max(0, elapsed)),
                )
                await self.client.truncate_item(
                    item_id=item_id,
                    content_index=0,
                    audio_end_ms=heard_ms,
                )
                self.transcript.interrupt_assistant_turn(
                    item_id,
                    heard_audio_ms=heard_ms,
                    ended_at_ms=self._latest_media_ts,
                )
                self.trace.mark_interrupted(item_id)
                print(f"[Barge-in] truncated at {heard_ms}ms (item={item_id})")
                if self.event_stream:
                    self.event_stream.emit(
                        "assistant_interrupted",
                        {
                            "item_id": item_id,
                            "generated_audio_ms": generated_ms,
                            "heard_audio_ms": heard_ms,
                        },
                    )

            # Clear Twilio playback buffer
            if twilio_send_clear is not None:
                await twilio_send_clear()

            # Reset tracking state
            self._pending_marks.clear()
            self._last_assistant_item = None
            self._response_start_ts = None

        # Response Done: reset tracking state for next response
        async def on_response_done():
            if self._initial_input_gate_active:
                self._initial_greeting_response_done = True
                self._maybe_release_initial_input_gate("initial greeting playback completed")
            if not self._pending_marks:
                self._response_start_ts = None
                self._last_assistant_item = None
                if self._end_when_audio_played:
                    await self._end_twilio_call()

        # Error Handling
        def on_error(event: object):
            print(f"[OpenAI Realtime error] {event}")
            if self.event_stream:
                self.event_stream.emit("error", {"message": str(event)})

        # Tool Call Handling
        async def on_tool_calls(tool_calls: list[tuple[str, str, str]]):
            await self.orchestrator.handle_tool_calls(tool_calls)
            if self.event_stream:
                for tool_name, arguments, _ in tool_calls:
                    self.event_stream.emit(
                        "tool_call",
                        {"tool": tool_name, "args": arguments},
                    )
            if self.orchestrator.is_complete:
                self._end_when_audio_played = True

        # User turn and transcription handling
        def on_input_speech_started(item_id: str, audio_start_ms: int):
            self.transcript.start_user_turn(item_id, audio_start_ms)
            if self.event_stream:
                self.event_stream.emit(
                    "user_turn_started",
                    {"item_id": item_id, "audio_start_ms": audio_start_ms},
                )

        def on_input_speech_stopped(item_id: str, audio_end_ms: int):
            self.transcript.stop_user_turn(item_id, audio_end_ms)
            if self.event_stream:
                self.event_stream.emit(
                    "user_turn_stopped",
                    {"item_id": item_id, "audio_end_ms": audio_end_ms},
                )

        def on_input_audio_committed(item_id: str):
            if self.event_stream:
                self.event_stream.emit(
                    "user_turn_committed",
                    {"item_id": item_id},
                )

            # Do not await this task from the Realtime event loop. A barge-in
            # may still be completing its cancelled response, and the loop must
            # remain free to consume response.done before create_response runs.
            task = asyncio.create_task(self.orchestrator.handle_user_audio_committed(item_id))
            self._turn_response_tasks.add(task)
            task.add_done_callback(self._on_turn_response_done)

        async def on_transcription(
            item_id: str,
            text: str,
            content_index: int,
            languages: list[dict],
            usage: dict | None,
        ):
            print(f"[User] {text}")
            turn = self.transcript.complete_user_turn(
                item_id,
                text,
                content_index=content_index,
                languages=languages,
                usage=usage,
            )
            if self.event_stream:
                self.event_stream.emit(
                    "transcription",
                    {"text": text, "item_id": item_id, "turn": asdict(turn)},
                )

        async def on_transcription_failed(item_id: str, content_index: int, error: dict):
            turn = self.transcript.fail_user_turn(
                item_id,
                error,
                content_index=content_index,
            )
            if self.event_stream:
                self.event_stream.emit(
                    "transcription_failed",
                    {"item_id": item_id, "error": error, "turn": asdict(turn)},
                )

        # Task for Realtime Session Event Loop
        self._task = asyncio.create_task(
            self.client.main(
                on_text_delta=on_text_delta,
                on_text_done=on_text_done,
                on_audio_delta=on_audio_delta,
                on_tool_calls=on_tool_calls,
                on_error=on_error,
                on_barge_in=on_barge_in,
                on_response_done=on_response_done,
                on_input_speech_started=on_input_speech_started,
                on_input_speech_stopped=on_input_speech_stopped,
                on_input_audio_committed=on_input_audio_committed,
                on_transcription=on_transcription,
                on_transcription_failed=on_transcription_failed,
            )
        )

    async def realtime_stop(self):
        """
        Stop the "Realtime" Session
        """
        async with self._stop_lock:
            if self._closed:
                return

            try:
                if self._task:
                    if not self._task.done():
                        self._task.cancel()
                    try:
                        await self._task
                    except asyncio.CancelledError:
                        pass
                    except Exception as exc:
                        self._report_cleanup_error("realtime_event_loop", exc)

                if self._turn_response_tasks:
                    turn_response_tasks = list(self._turn_response_tasks)
                    for task in turn_response_tasks:
                        task.cancel()
                    await asyncio.gather(
                        *turn_response_tasks,
                        return_exceptions=True,
                    )
                    self._turn_response_tasks.clear()

                if self._initial_input_gate_timeout_task:
                    self._initial_input_gate_timeout_task.cancel()
                    self._initial_input_gate_timeout_task = None

                try:
                    await self.client.close_session()
                except Exception as exc:
                    self._report_cleanup_error("realtime_session", exc)
            finally:
                # Persist each artifact independently, even if the realtime task
                # or connection shutdown failed.
                try:
                    await self._finalize_transcript()
                except Exception as exc:
                    self._report_cleanup_error("transcript_finalization", exc)
                try:
                    await self._finalize_trace()
                except Exception as exc:
                    self._report_cleanup_error("trace_finalization", exc)
                self._closed = True

    def _report_cleanup_error(self, component: str, error: Exception) -> None:
        print(f"[Realtime cleanup error] {component}: {error}")
        if self.event_stream:
            self.event_stream.emit(
                "cleanup_error",
                {
                    "component": component,
                    "error_type": type(error).__name__,
                    "message": str(error),
                },
            )

    def _on_turn_response_done(self, task: asyncio.Task) -> None:
        self._turn_response_tasks.discard(task)
        if task.cancelled():
            return
        error = task.exception()
        if error is None:
            return
        print(f"[Realtime response trigger error] {error}")
        if self.event_stream:
            self.event_stream.emit("error", {"message": str(error)})

    async def twilio_start(self, stream_sid: str, call_sid: str | None = None):
        """
        Initial setting from "Twilio" `event.start.streamSid`
        - Set stream SID
        - Stream greeting audio
        """
        self.stream_sid = stream_sid
        if call_sid:
            self.call_id = call_sid
            self.transcript.set_call_id(call_sid)
            self.trace.set_call_id(call_sid)
        self._start_time = int(time.time() * 1000)
        self.trace.mark_call_started()
        print(f"[Twilio] stream start: {stream_sid}")

        # Events (optional)
        if self.event_stream:
            self.event_stream.emit("time_start", {"time": self._start_time})
            print(f"[Time] stream start: {self._start_time}")

        # Do not let speech made before the consent greeting is heard enter the
        # Realtime conversation. The gate opens after Twilio confirms the
        # configured playback duration, or when a shorter greeting completes.
        # A timeout exists only as a failure fallback.
        self._initial_input_gate_active = True
        self._initial_greeting_response_done = False
        self._initial_input_gate_timeout_task = asyncio.create_task(self._release_initial_input_gate_after_timeout())
        await self.orchestrator.begin_call()
        is_complete = getattr(self.orchestrator, "is_complete", None)
        if is_complete:
            self._end_when_audio_played = True

    async def twilio_media(self, payload_b64: str, timestamp: int = 0):
        """
        Send Audio from "Twilio" `event.media.payload`
        """
        self._latest_media_ts = timestamp
        if self._initial_input_gate_active:
            return
        await self.client.append_audio_buffer(payload_b64)

    async def twilio_mark(self, mark_name: str | None = None):
        """
        Handle "Twilio" `event.mark` - track playback position
        """
        if mark_name is None and self._pending_marks:
            mark_name = next(iter(self._pending_marks))
        mark = self._pending_marks.pop(mark_name, None) if mark_name else None
        if mark is None:
            return
        item_id, heard_audio_ms = mark
        self._assistant_heard_ms[item_id] = max(
            self._assistant_heard_ms.get(item_id, 0),
            heard_audio_ms,
        )
        self.transcript.acknowledge_assistant_audio(item_id, heard_audio_ms)

        if not any(pending[0] == item_id for pending in self._pending_marks.values()):
            self.trace.mark_playback_completed(item_id)

        if not self._pending_marks and item_id == self._last_assistant_item:
            self._response_start_ts = None
            self._last_assistant_item = None
        self._maybe_release_initial_input_gate(
            "initial greeting minimum playback reached",
            heard_audio_ms=heard_audio_ms,
        )
        if self._end_when_audio_played and not self._pending_marks:
            await self._end_twilio_call()

    def _maybe_release_initial_input_gate(
        self,
        reason: str,
        *,
        heard_audio_ms: int | None = None,
    ) -> None:
        if not self._initial_input_gate_active:
            return
        if heard_audio_ms is not None and heard_audio_ms >= self._initial_input_gate_ms:
            self._release_initial_input_gate(reason)
            return
        if self._initial_greeting_response_done and not self._pending_marks:
            self._release_initial_input_gate("initial greeting playback completed")

    def _release_initial_input_gate(self, reason: str) -> None:
        if not self._initial_input_gate_active:
            return
        self._initial_input_gate_active = False
        timeout_task = self._initial_input_gate_timeout_task
        if timeout_task and timeout_task is not asyncio.current_task():
            timeout_task.cancel()
        self._initial_input_gate_timeout_task = None
        print(f"[Input gate] opened: {reason}")

    async def _release_initial_input_gate_after_timeout(self) -> None:
        try:
            await asyncio.sleep(15)
            self._release_initial_input_gate("initial greeting timeout fallback")
        except asyncio.CancelledError:
            pass

    async def twilio_stop(self):
        """
        Stop Task and Session from "Twilio" `event.stop`
        """
        print(f"[Twilio] stream stop: {self.stream_sid}")

        end_time = int(time.time() * 1000)
        duration = end_time - self._start_time if self._start_time else 0
        if self.event_stream:
            self.event_stream.emit("time_end", {"time": end_time, "duration": duration})
            print(f"[Time] stream end: {end_time}, duration: {duration}")

        await self.realtime_stop()

    def get_transcript(self) -> dict:
        """Return a structured snapshot for a future DB/research-agent adapter."""
        return self.transcript.snapshot()

    def get_trace(self) -> dict:
        """Return non-PII latency diagnostics for the current call."""
        return self.trace.snapshot()

    async def _finalize_transcript(self):
        if self._transcript_finalized:
            return
        self._transcript_finalized = True
        self.transcript.set_screening(self.orchestrator.snapshot())
        snapshot = self.transcript.finalize()

        saved_path = None
        if self._transcript_dir:
            try:
                saved_path = await asyncio.to_thread(
                    self.transcript.save_json,
                    self._transcript_dir,
                )
            except Exception as exc:
                print(f"[Transcript storage error] {exc}")
                if self.event_stream:
                    self.event_stream.emit(
                        "transcript_storage_failed",
                        {"call_id": self.call_id, "message": str(exc)},
                    )

        if self.event_stream:
            self.event_stream.emit(
                "transcript_complete",
                {
                    "transcript": snapshot,
                    "saved_path": str(saved_path) if saved_path else None,
                },
            )

    async def _finalize_trace(self):
        if self._trace_finalized:
            return
        self._trace_finalized = True
        snapshot = self.trace.finalize()

        saved_path = None
        if self._trace_dir:
            try:
                saved_path = await asyncio.to_thread(
                    self.trace.save_json,
                    self._trace_dir,
                )
            except Exception as exc:
                print(f"[Trace storage error] {exc}")
                if self.event_stream:
                    self.event_stream.emit(
                        "trace_storage_failed",
                        {"call_id": self.call_id, "message": str(exc)},
                    )

        if self.event_stream:
            self.event_stream.emit(
                "trace_complete",
                {
                    "trace": snapshot,
                    "saved_path": str(saved_path) if saved_path else None,
                },
            )

    async def _end_twilio_call(self):
        if not self._end_when_audio_played or self._twilio_end_call is None:
            return
        self._end_when_audio_played = False
        await self._twilio_end_call()

    @staticmethod
    def _pcmu_duration_ms(payload_b64: str) -> int:
        """Return rounded duration for 8 kHz, 8-bit G.711 μ-law audio."""
        try:
            byte_count = len(base64.b64decode(payload_b64, validate=True))
        except (ValueError, base64.binascii.Error):
            return 0
        return round(byte_count / 8)
