from __future__ import annotations

import asyncio
import json
from typing import Any

from .engine import FlowEngine
from .models import DeploymentBundle
from .realtime_session import RealtimeSession


class FlowOrchestrator:
    """Runs one immutable FlowSpec and one state instance for a call."""

    def __init__(
        self,
        session: RealtimeSession,
        bundle: DeploymentBundle,
        *,
        event_stream: Any = None,
        allow_unsafe_code_actions: bool = False,
    ) -> None:
        self.session = session
        self.engine = FlowEngine(bundle, allow_unsafe_code_actions=allow_unsafe_code_actions)
        self.event_stream = event_stream
        self._lock = asyncio.Lock()
        self._responded_input_item_ids: set[str] = set()
        self._active_input_item_id: str | None = None
        self._execution_path: list[dict[str, str]] = []

    @property
    def is_complete(self) -> bool:
        return self.engine.is_complete

    async def start(
        self,
        phone_number: str | None = None,
        selected_instrument_ids: list[str] | None = None,
    ) -> None:
        del phone_number, selected_instrument_ids
        session_update = self.engine.flow["start"]["session_update"]
        model = session_update.get("model")
        if isinstance(model, str) and model:
            self.session.model = model
        transcription = session_update.get("audio", {}).get("input", {}).get("transcription")
        if isinstance(transcription, dict) and transcription.get("model"):
            self.session.transcription_model = transcription["model"]
        await self.session.connect_session(
            session_update.get("instructions", ""),
            [],
            session_update=session_update,
        )
        self._emit("flow_started", self.snapshot())

    async def begin_call(self) -> None:
        self.engine.enter_first_node()
        self._record_current_node()
        self._emit("node_entered", self._node_event())
        if self.engine.is_complete:
            await self._respond_end()
        else:
            await self._speak_current_node(trigger="initial_greeting", input_item_id=None)

    async def handle_user_audio_committed(self, item_id: str) -> None:
        if self.engine.is_complete or item_id in self._responded_input_item_ids:
            return
        self._responded_input_item_ids.add(item_id)
        self._active_input_item_id = item_id
        try:
            await self.respond(trigger="user_audio", input_item_id=item_id)
        except Exception:
            self._responded_input_item_ids.discard(item_id)
            raise

    async def respond(
        self,
        *,
        trigger: str,
        input_item_id: str | None,
        note: str | None = None,
        force_audio: bool = False,
    ) -> None:
        node = self.engine.current_node
        runtime = node.get("runtime", {})
        output_modalities = ["audio"] if force_audio else runtime.get("output_modalities", ["audio"])
        tool_choice = "none" if force_audio else runtime.get("tool_choice", node.get("tool_choice", "none"))
        tools = [] if force_audio else self.engine.realtime_tools()
        response_instructions = self.engine.render_instructions(note)
        if tool_choice == "required" and output_modalities == ["text"]:
            response_instructions = "\n\n".join(
                (
                    response_instructions,
                    "이번 응답은 사용자에게 들리지 않는 내부 판정 단계입니다. "
                    "설명, 공감, 확인 또는 정리 문장을 출력하지 말고 사용 가능한 Tool 하나만 호출하세요.",
                )
            )
        await self.session.create_response(
            instructions=response_instructions,
            tools=tools,
            tool_choice=tool_choice,
            output_modalities=output_modalities,
            parallel_tool_calls=False if force_audio else runtime.get("parallel_tool_calls", False),
            max_output_tokens=runtime.get("max_output_tokens"),
            metadata={
                "trigger": trigger,
                "input_item_id": input_item_id,
                "node_id": node.get("id"),
                "flow_version": self.engine.flow.get("version"),
            },
        )

    async def handle_tool_calls(self, tool_calls: list[tuple[str, str, str]]) -> None:
        if not tool_calls:
            return
        async with self._lock:
            previous_node_id = self.engine.current_node_id
            messages: list[str] = []
            tool_failed = False
            for tool_name, raw_arguments, call_id in tool_calls:
                try:
                    arguments = json.loads(raw_arguments or "{}")
                    if not isinstance(arguments, dict):
                        raise ValueError("Tool arguments must be an object.")
                    result = self.engine.execute_tool(tool_name, arguments)
                except Exception as exc:
                    tool_failed = True
                    print(f"[Tool execution error] {tool_name}: {exc}")
                    result = {"ok": False, "retry": True}
                await self.session.create_function_item(call_id, result)
                if result.get("message") and result.get("ok") is not False:
                    messages.append(str(result["message"]))
                self._emit(
                    "tool_result",
                    {"tool": tool_name, "result": result, **self._node_event()},
                )

            if self.engine.current_node_id != previous_node_id:
                self._record_current_node()
                self._emit("node_entered", self._node_event())
            if self.engine.is_complete:
                await self._respond_end()
                return
            await self._speak_current_node(
                trigger="node_entered" if self.engine.current_node_id != previous_node_id else "tool_result",
                input_item_id=self._active_input_item_id,
                note=(
                    "내부 처리 실패를 언급하지 말고 현재 질문을 한 번만 다시 질문하세요."
                    if tool_failed
                    else " ".join(messages) or None
                ),
            )

    async def _speak_current_node(
        self,
        *,
        trigger: str,
        input_item_id: str | None,
        note: str | None = None,
    ) -> None:
        """Speak a Node prompt without exposing its observation tools.

        Node runtime settings describe how a committed user turn is observed.
        Entering a conversational Node is a separate phase: the current Node
        instruction is rendered as audio, with tool calls disabled.
        """
        response_note = note
        if trigger == "tool_result":
            tool_result_instruction = (
                "질문 외의 문장을 출력하지 마세요. 첫 단어부터 현재 상태에 맞는 다음 질문 또는 "
                "필요한 확인 질문을 시작하고, 질문 한 문장으로 끝내세요. "
                "'네', '알겠습니다', '답변 감사합니다', '잠시만요', '다음 질문으로 이어가겠습니다' 같은 "
                "인정·복창·요약·감사·전환 표현과 휴식 제안을 모두 생략하고, 같은 문구를 반복하지 마세요."
            )
            response_note = "\n".join(part for part in (note, tool_result_instruction) if part)
        elif trigger == "node_entered":
            node_entry_instruction = (
                "현재 Node instruction에 명시된 안내와 질문만 각각 한 번 말하세요. "
                "명시되지 않은 단계 전환, 검사 소개 또는 '잠시만요' 같은 대기 표현을 추가하지 말고, "
                "같은 안내 또는 질문을 반복하지 마세요."
            )
            response_note = "\n".join(part for part in (note, node_entry_instruction) if part)
        await self.respond(
            trigger=trigger,
            input_item_id=input_item_id,
            note=response_note,
            force_audio=True,
        )

    async def _respond_end(self) -> None:
        end = self.engine.current_node.get("end", {})
        final_message = str(end.get("final_message", "")).strip()
        instructions = (
            f"다음 문장을 자연스럽게 한 번만 말하고 추가 질문을 하지 마세요: {final_message}"
            if final_message
            else "통화를 짧고 정중하게 마무리하세요."
        )
        await self.session.create_response(
            instructions=instructions,
            tools=[],
            tool_choice="none",
            output_modalities=["audio"],
            parallel_tool_calls=False,
            metadata={
                "trigger": "end_node",
                "input_item_id": self._active_input_item_id,
                "node_id": self.engine.current_node_id,
                "flow_version": self.engine.flow.get("version"),
            },
        )

    def snapshot(self) -> dict[str, Any]:
        return {
            **self.engine.snapshot(),
            "execution_path": list(self._execution_path),
        }

    def _record_current_node(self) -> None:
        node = self.engine.current_node
        node_id = str(node.get("id", ""))
        if self._execution_path and self._execution_path[-1]["id"] == node_id:
            return
        self._execution_path.append({"id": node_id, "name": str(node.get("name", node_id))})

    def _node_event(self) -> dict[str, Any]:
        return {
            "node_id": self.engine.current_node_id,
            "node_name": self.engine.current_node.get("name"),
            "state": self.engine.state,
        }

    def _emit(self, event_type: str, payload: dict[str, Any]) -> None:
        if self.event_stream:
            self.event_stream.emit(event_type, payload)
