import asyncio
import copy
import json
import os
from typing import Any, Awaitable, Callable, Optional

from openai import AsyncOpenAI

from .trace_collector import TraceCollector
from .usage import merge_usage, to_dict


class RealtimeSession:
    """
    OpenAI Realtime WebSocket session client.
    - Connect/Close/Update `connection.session`
    - Append `audio/pcmu` chunk to `connection.input_audio_buffer`
    - Create `function_call_output` items
    - Truncate `connection.conversation.item` (barge-in)
    - Create server-controlled `connection.response`
    - Handle `connection.event`
    """

    def __init__(
        self,
        trace_collector: TraceCollector | None = None,
        *,
        endpoint: str | None = None,
        api_key: str | None = None,
    ):
        self.endpoint = (endpoint if endpoint is not None else os.getenv("OPENAI_ENDPOINT", "")).strip()
        self.api_key = api_key if api_key is not None else os.getenv("OPENAI_API_KEY")
        self.model = os.getenv("OPENAI_REALTIME_MODEL", "gpt-realtime-2.1")
        self.transcription_model = os.getenv("OPENAI_TRANSCRIBE_MODEL", "gpt-transcribe")
        if not self.api_key:
            raise ValueError("OPENAI_API_KEY is required")
        client_options: dict[str, Any] = {"api_key": self.api_key}
        if self.endpoint:
            client_options["base_url"] = self.endpoint
        self.client = AsyncOpenAI(**client_options)
        self.trace_collector = trace_collector

        # Initial State Setting
        self.connection = None
        self._conn_cm = None
        self._assistant_speaking = False
        self._barge_in_handled = False
        self._response_active = False
        self._response_requested = False
        self._cancelled = False
        self._pending_tool_calls: list[tuple[str, str, str]] = []

        # Token tracking
        self.usage = {}

    async def connect_session(
        self,
        instruction: str,
        tools: list[dict[str, Any]],
        session_update: dict[str, Any] | None = None,
    ):
        """
        Connect "GPT-Realtime" Websocket Session
        - create `connection`
        - enter `connection context manager`
        - apply initial instruction/tools to `connection.session`
        """

        # Connect Session
        self._conn_cm = self.client.realtime.connect(
            model=self.model,
            websocket_connection_options={
                # On dual-stack networks, an unreachable IPv6 route can use
                # the entire WebSocket handshake timeout before IPv4 is tried.
                # Race both address families and keep the handshake bounded.
                "happy_eyeballs_delay": 0.25,
                "interleave": 1,
                "open_timeout": 15,
            },
        )
        self.connection = await self._conn_cm.__aenter__()

        # Initialize Session
        if session_update is None:
            transcription: dict[str, Any] = {"model": self.transcription_model}
            if self.transcription_model in {"gpt-transcribe", "gpt-live-transcribe"}:
                transcription["languages"] = ["ko"]
                keywords = [
                    keyword.strip() for keyword in os.getenv("TRANSCRIBE_KEYWORDS", "").split(",") if keyword.strip()
                ]
                if keywords:
                    transcription["keywords"] = keywords
            else:
                transcription["language"] = "ko"

            session = {
                "type": "realtime",
                "instructions": instruction,
                "output_modalities": ["audio"],
                "audio": {
                    "input": {
                        "format": {"type": "audio/pcmu"},
                        "transcription": transcription,
                        "turn_detection": {
                            "type": "server_vad",
                            "threshold": 0.5,
                            "prefix_padding_ms": int(os.getenv("REALTIME_VAD_PREFIX_PADDING_MS", "400")),
                            "silence_duration_ms": int(os.getenv("REALTIME_VAD_SILENCE_MS", "800")),
                            "interrupt_response": True,
                            "create_response": False,
                        },
                    },
                    "output": {
                        "voice": os.getenv("OPENAI_REALTIME_VOICE", "marin"),
                        "format": {"type": "audio/pcmu"},
                        "speed": float(os.getenv("OPENAI_REALTIME_SPEED", "0.95")),
                    },
                },
                "tools": tools,
            }
        else:
            session = copy.deepcopy(session_update)
            session["instructions"] = instruction
            session["tools"] = tools
            turn_detection = session.get("audio", {}).get("input", {}).get("turn_detection")
            if isinstance(turn_detection, dict):
                if turn_detection.get("type") == "server_vad":
                    turn_detection.pop("eagerness", None)
                elif turn_detection.get("type") == "semantic_vad":
                    turn_detection.pop("threshold", None)
                    turn_detection.pop("prefix_padding_ms", None)
                    turn_detection.pop("silence_duration_ms", None)
        await self.connection.session.update(session=session)

    async def close_session(self):
        """
        Close "GPT-Realtime" WebSocket Session
        - exit `connection context manager`
        - clean up `connection context manager`
        - clean up `connection`
        """
        try:
            if self._conn_cm is not None:
                await self._conn_cm.__aexit__(None, None, None)
        finally:
            self._conn_cm = None
            self.connection = None

    async def append_audio_buffer(self, payload_b64: str):
        """
        Append `base64 audio/pcmu` chunk to "GPT-Realtime" `input_audio_buffer`
        Args:
            payload_b64 (str) : base64 audio/pcmu chunk (G.711 u-law) (ex. "Twilio" `media.payload`)
        """
        if not self.connection:
            return
        await self.connection.input_audio_buffer.append(audio=payload_b64)

    async def create_function_item(self, call_id: str, output: dict[str, Any]):
        """
        Create `function_call_output` item but no direct response
        Args:
            call_id (str): tool call ID
            output (dict): tool output
        """
        if not self.connection:
            return

        await self.connection.conversation.item.create(
            item={
                "type": "function_call_output",
                "call_id": call_id,
                "output": json.dumps(output, ensure_ascii=False),
            }
        )

    async def truncate_item(self, item_id: str, content_index: int, audio_end_ms: int):
        """
        Truncate "GPT-Realtime" `connection.conversation.item`
        - truncate at the given playback point
        - VAD automatically cancels response (interrupt_response: True)
        Args:
            item_id (str): The assistant message item ID
            content_index (int): Content index (usually 0)
            audio_end_ms (int): Milliseconds of audio the user actually heard
        """
        if not self.connection:
            return
        try:
            await self.connection.conversation.item.truncate(
                item_id=item_id,
                content_index=content_index,
                audio_end_ms=audio_end_ms,
            )
        except Exception as exc:
            print(f"[Realtime truncate error] {exc}")

    async def create_response(
        self,
        *,
        instructions: str | None = None,
        tools: list[dict[str, Any]] | None = None,
        tool_choice: str | dict[str, Any] | None = None,
        output_modalities: list[str] | None = None,
        parallel_tool_calls: bool | None = None,
        max_output_tokens: int | None = None,
        metadata: dict[str, Any] | None = None,
    ):
        if not self.connection:
            return
        request_id = None
        response_metadata = {str(key): str(value) for key, value in (metadata or {}).items() if value is not None}
        if self.trace_collector:
            trigger = response_metadata.pop("trigger", "unspecified")
            input_item_id = response_metadata.pop("input_item_id", None)
            request_id, trace_metadata = self.trace_collector.response_scheduled(
                trigger=trigger,
                input_item_id=input_item_id,
                context=response_metadata,
            )
            response_metadata = trace_metadata

        loop = asyncio.get_running_loop()
        deadline = loop.time() + 2.0
        try:
            while self._response_requested or self._response_active:
                if loop.time() >= deadline:
                    raise TimeoutError("Timed out waiting for the previous realtime response.")
                await asyncio.sleep(0.01)

            self._response_requested = True
            response: dict[str, Any] = {}
            if instructions:
                response["instructions"] = instructions
            if tools is not None:
                response["tools"] = tools
            if tool_choice is not None:
                response["tool_choice"] = tool_choice
            if output_modalities is not None:
                response["output_modalities"] = output_modalities
            if parallel_tool_calls is not None:
                response["parallel_tool_calls"] = parallel_tool_calls
            if max_output_tokens is not None:
                response["max_output_tokens"] = max_output_tokens
            if response_metadata:
                response["metadata"] = response_metadata
            if self.trace_collector and request_id:
                self.trace_collector.mark_response_requested(request_id)
            if response:
                await self.connection.response.create(response=response)
            else:
                await self.connection.response.create()
        except Exception as exc:
            self._response_requested = False
            if self.trace_collector and request_id:
                self.trace_collector.mark_response_request_failed(request_id, exc)
            raise

    async def main(
        self,
        on_text_delta: Callable[[str, str, str, int], None],
        on_text_done: Callable[[str, str, str, int], None],
        on_audio_delta: Callable[[str, str, str], Awaitable[None]],
        on_tool_calls: Optional[Callable[[list[tuple[str, str, str]]], Awaitable[None]]] = None,
        on_error: Optional[Callable[[object], None]] = None,
        on_barge_in: Optional[Callable[[], Awaitable[None]]] = None,
        on_response_done: Optional[Callable[[], Awaitable[None]]] = None,
        on_input_speech_started: Optional[Callable[[str, int], None]] = None,
        on_input_speech_stopped: Optional[Callable[[str, int], None]] = None,
        on_input_audio_committed: Optional[Callable[[str], None]] = None,
        on_transcription: Optional[
            Callable[
                [str, str, int, list[dict[str, Any]], dict[str, Any] | None],
                Awaitable[None],
            ]
        ] = None,
        on_transcription_failed: Optional[Callable[[str, int, dict[str, Any]], Awaitable[None]]] = None,
    ):
        """
        Run "GPT-Realtime" Websocket Session `connection.event` loop
        """
        if not self.connection:
            return

        async for event in self.connection:
            etype = getattr(event, "type", None)

            # Only an audio transcript is caller-visible dialogue. Pure text
            # output is used by the runtime as a silent tool-decision phase and
            # must not be printed or persisted as something the caller heard.
            if etype == "response.output_audio_transcript.delta":
                delta = getattr(event, "delta", "")
                if delta:
                    on_text_delta(
                        delta,
                        getattr(event, "item_id", ""),
                        getattr(event, "response_id", ""),
                        getattr(event, "content_index", 0),
                    )

            # Audio transcript done
            elif etype == "response.output_audio_transcript.done":
                final_text = getattr(event, "transcript", None) or getattr(event, "text", "")
                on_text_done(
                    final_text,
                    getattr(event, "item_id", ""),
                    getattr(event, "response_id", ""),
                    getattr(event, "content_index", 0),
                )

            # Audio Response Delta
            elif etype == "response.output_audio.delta":
                b64_audio = getattr(event, "delta", None)
                item_id = getattr(event, "item_id", "")
                response_id = getattr(event, "response_id", "")
                if b64_audio and self.trace_collector:
                    self.trace_collector.mark_first_audio_delta(
                        response_id,
                        item_id,
                    )
                if self._cancelled:
                    continue
                if b64_audio:
                    self._assistant_speaking = True
                    await on_audio_delta(b64_audio, item_id, response_id)

            # Response Created
            elif etype == "response.created":
                self._response_requested = True
                self._response_active = True
                self._cancelled = False
                self._barge_in_handled = False
                response = getattr(event, "response", None)
                if self.trace_collector and response:
                    raw_metadata = getattr(response, "metadata", None)
                    self.trace_collector.mark_response_created(
                        getattr(response, "id", ""),
                        to_dict(raw_metadata) if raw_metadata else None,
                    )

            # Error Handling
            elif etype == "error":
                err = getattr(event, "error", None)
                err_code = getattr(err, "code", None)
                if err_code == "response_cancel_not_active":
                    continue
                if on_error:
                    on_error(event)
                else:
                    print("[Realtime error]", err)

            # Function Call (tool_call)
            elif etype == "response.function_call_arguments.done":
                call_id = getattr(event, "call_id", "")
                tool_name = getattr(event, "name", "")
                arguments = getattr(event, "arguments", "{}")
                print(f"[Function Call] {tool_name}({arguments})")
                if call_id and not any(pending[2] == call_id for pending in self._pending_tool_calls):
                    self._pending_tool_calls.append((tool_name, arguments, call_id))

            # VAD Started (barge-in)
            elif etype == "input_audio_buffer.speech_started":
                input_item_id = getattr(event, "item_id", "")
                audio_start_ms = getattr(event, "audio_start_ms", 0)
                if self.trace_collector and input_item_id:
                    self.trace_collector.mark_speech_started(
                        input_item_id,
                        audio_start_ms,
                    )
                if on_input_speech_started and input_item_id:
                    on_input_speech_started(input_item_id, audio_start_ms)
                if not self._barge_in_handled:
                    self._barge_in_handled = True
                    self._cancelled = True
                    self._assistant_speaking = False
                    if on_barge_in:
                        await on_barge_in()

            # VAD Stopped
            elif etype == "input_audio_buffer.speech_stopped":
                self._barge_in_handled = False
                input_item_id = getattr(event, "item_id", "")
                audio_end_ms = getattr(event, "audio_end_ms", 0)
                if self.trace_collector and input_item_id:
                    self.trace_collector.mark_speech_stopped(
                        input_item_id,
                        audio_end_ms,
                    )
                if on_input_speech_stopped and input_item_id:
                    on_input_speech_stopped(
                        input_item_id,
                        audio_end_ms,
                    )

            # VAD committed a complete user audio turn. Response generation is
            # scheduled by the application immediately; input transcription
            # continues independently and is not on the response critical path.
            elif etype == "input_audio_buffer.committed":
                input_item_id = getattr(event, "item_id", "")
                if self.trace_collector and input_item_id:
                    self.trace_collector.mark_audio_committed(input_item_id)
                if on_input_audio_committed and input_item_id:
                    on_input_audio_committed(input_item_id)

            # Audio Response Done
            elif etype == "response.output_audio.done":
                self._assistant_speaking = False
                if self.trace_collector:
                    self.trace_collector.mark_output_audio_done(getattr(event, "response_id", ""))

            # Transcription Complete (input_audio)
            elif etype == "conversation.item.input_audio_transcription.completed":
                transcript = getattr(event, "transcript", "")
                input_item_id = getattr(event, "item_id", "")
                if self.trace_collector and input_item_id:
                    self.trace_collector.mark_transcription_completed(input_item_id)
                if transcript and on_transcription:
                    raw_languages = getattr(event, "languages", None) or []
                    languages = [to_dict(language) for language in raw_languages]
                    raw_usage = getattr(event, "usage", None)
                    await on_transcription(
                        input_item_id,
                        transcript,
                        getattr(event, "content_index", 0),
                        languages,
                        to_dict(raw_usage) if raw_usage else None,
                    )

            # Transcription Failed
            elif etype == "conversation.item.input_audio_transcription.failed":
                err = getattr(event, "error", None)
                input_item_id = getattr(event, "item_id", "")
                if self.trace_collector and input_item_id:
                    self.trace_collector.mark_transcription_failed(input_item_id)
                print(f"[Realtime error] {err}")
                if on_transcription_failed:
                    await on_transcription_failed(
                        input_item_id,
                        getattr(event, "content_index", 0),
                        to_dict(err) if err else {"message": "Unknown transcription error"},
                    )

            # Response Done
            elif etype == "response.done":
                self._assistant_speaking = False
                self._barge_in_handled = False
                self._response_active = False
                self._response_requested = False
                self._cancelled = False

                # Token Counting
                response = getattr(event, "response", None)
                usage = getattr(response, "usage", None) if response else None
                if usage:
                    merge_usage(self.usage, to_dict(usage))

                status = getattr(response, "status", None) if response else None
                if self.trace_collector and response:
                    self.trace_collector.mark_response_done(
                        getattr(response, "id", ""),
                        status,
                    )
                pending_tool_calls = self._pending_tool_calls
                self._pending_tool_calls = []
                if status != "completed":
                    pending_tool_calls = []

                # Response Done Callback
                if on_response_done:
                    await on_response_done()

                # Add every function output from this response before creating
                # one follow-up response. Creating one response per tool call can
                # deadlock this event loop when the model emits multiple calls.
                if on_tool_calls and pending_tool_calls:
                    await on_tool_calls(pending_tool_calls)
