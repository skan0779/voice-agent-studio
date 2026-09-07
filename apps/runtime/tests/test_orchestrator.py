from __future__ import annotations

import asyncio
import unittest

from test_engine import bundle
from voice_agent_runtime.orchestrator import FlowOrchestrator


class FakeRealtimeSession:
    def __init__(self):
        self.model = "gpt-realtime-2.1"
        self.transcription_model = "gpt-transcribe"
        self.connected = None
        self.responses = []
        self.function_items = []

    async def connect_session(self, instructions, tools, session_update=None):
        self.connected = (instructions, tools, session_update)

    async def create_response(self, **kwargs):
        self.responses.append(kwargs)

    async def create_function_item(self, call_id, output):
        self.function_items.append((call_id, output))


class FlowOrchestratorTests(unittest.TestCase):
    def test_session_uses_deployed_flow_and_finishes_at_end_node(self):
        async def scenario():
            session = FakeRealtimeSession()
            runtime_bundle = bundle()
            runtime_bundle.flow_spec["start"]["session_update"].update(
                {
                    "model": "gpt-realtime-2.1",
                    "audio": {"input": {"transcription": {"model": "gpt-transcribe"}}},
                }
            )
            orchestrator = FlowOrchestrator(session, runtime_bundle)

            await orchestrator.start()
            await orchestrator.begin_call()

            self.assertEqual(session.responses[0]["output_modalities"], ["audio"])
            self.assertEqual(session.responses[0]["tool_choice"], "none")
            self.assertEqual(session.responses[0]["tools"], [])

            await orchestrator.handle_user_audio_committed("user-item-1")

            self.assertEqual(session.responses[1]["output_modalities"], ["text"])
            self.assertEqual(session.responses[1]["tool_choice"], "required")
            self.assertIn(
                "사용 가능한 Tool 하나만 호출하세요",
                session.responses[1]["instructions"],
            )
            await orchestrator.handle_tool_calls([("record_consent", '{"decision":"granted"}', "call-tool-1")])

            self.assertEqual(session.connected[0], "Base")
            self.assertEqual(session.function_items[0][0], "call-tool-1")
            self.assertEqual(session.responses[-1]["output_modalities"], ["audio"])
            self.assertTrue(orchestrator.is_complete)
            self.assertEqual(
                [item["name"] for item in orchestrator.snapshot()["execution_path"]],
                ["consent-1", "end-1"],
            )

        asyncio.run(scenario())

    def test_tool_result_speaks_again_even_when_follow_up_flag_is_false(self):
        async def scenario():
            session = FakeRealtimeSession()
            runtime_bundle = bundle()
            runtime_bundle.flow_spec["nodes"][1]["runtime"]["follow_up_audio"] = False
            orchestrator = FlowOrchestrator(session, runtime_bundle)

            await orchestrator.start()
            await orchestrator.begin_call()
            await orchestrator.handle_tool_calls([("record_consent", '{"decision":"unclear"}', "call-tool-1")])

            self.assertFalse(orchestrator.is_complete)
            self.assertEqual(session.responses[-1]["output_modalities"], ["audio"])
            self.assertEqual(session.responses[-1]["tool_choice"], "none")
            self.assertEqual(session.responses[-1]["tools"], [])
            self.assertIn(
                "첫 단어부터 현재 상태에 맞는 다음 질문",
                session.responses[-1]["instructions"],
            )
            self.assertIn(
                "인정·복창·요약·감사·전환 표현과 휴식 제안을 모두 생략하고",
                session.responses[-1]["instructions"],
            )

        asyncio.run(scenario())

    def test_tool_execution_failure_reasks_without_exposing_internal_error(self):
        async def scenario():
            session = FakeRealtimeSession()
            runtime_bundle = bundle()
            orchestrator = FlowOrchestrator(session, runtime_bundle)

            await orchestrator.start()
            await orchestrator.begin_call()
            await orchestrator.handle_tool_calls([("record_consent", "{}", "call-tool-1")])

            self.assertEqual(
                session.function_items[-1][1],
                {"ok": False, "retry": True},
            )
            self.assertIn(
                "내부 처리 실패를 언급하지 말고 현재 질문을 한 번만 다시 질문하세요",
                session.responses[-1]["instructions"],
            )
            self.assertNotIn(
                "Missing required function inputs",
                session.responses[-1]["instructions"],
            )

        asyncio.run(scenario())


if __name__ == "__main__":
    unittest.main()
