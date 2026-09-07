from __future__ import annotations

import base64
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from voice_agent_runtime.phone_number import (
    InvalidPhoneNumberError,
    normalize_phone_number,
)
from voice_agent_runtime.realtime_gateway import RealtimeGateway
from voice_agent_runtime.realtime_session import RealtimeSession
from voice_agent_runtime.transcript_collector import TranscriptCollector


class PhoneNumberTests(unittest.TestCase):
    def test_normalizes_korean_local_number(self):
        self.assertEqual(normalize_phone_number("010-1234-5678"), "+821012345678")

    def test_rejects_invalid_number(self):
        with self.assertRaises(InvalidPhoneNumberError):
            normalize_phone_number("123")


class TranscriptCollectorTests(unittest.TestCase):
    def test_transcriptions_are_joined_by_item_id(self):
        collector = TranscriptCollector(
            "call-1",
            realtime_model="gpt-realtime-2.1",
            transcription_model="gpt-transcribe",
        )
        collector.start_user_turn("user-1", 100)
        collector.start_user_turn("user-2", 200)
        collector.complete_user_turn("user-2", "두 번째 답변")
        collector.complete_user_turn("user-1", "첫 번째 답변")

        turns = collector.snapshot()["turns"]
        self.assertEqual([turn["source_item_id"] for turn in turns], ["user-1", "user-2"])
        self.assertEqual(turns[0]["raw_text"], "첫 번째 답변")

    def test_pcmu_duration_uses_eight_kilohertz_sample_rate(self):
        one_second_pcmu = base64.b64encode(bytes(8_000)).decode("ascii")
        self.assertEqual(RealtimeGateway._pcmu_duration_ms(one_second_pcmu), 1_000)


class _FakeSessionResource:
    def __init__(self):
        self.payload = None

    async def update(self, *, session):
        self.payload = session


class _FakeConnection:
    def __init__(self):
        self.session = _FakeSessionResource()


class _FakeConnectionManager:
    def __init__(self, connection):
        self.connection = connection

    async def __aenter__(self):
        return self.connection

    async def __aexit__(self, *_):
        return None


class _FakeRealtimeResource:
    def __init__(self, connection):
        self.connection = connection
        self.model = None

    def connect(self, *, model, websocket_connection_options=None):
        del websocket_connection_options
        self.model = model
        return _FakeConnectionManager(self.connection)


class RealtimeSessionTests(unittest.IsolatedAsyncioTestCase):
    async def test_session_keeps_server_controlled_response_creation(self):
        with patch.dict(
            "os.environ",
            {
                "OPENAI_API_KEY": "test-key",
                "OPENAI_REALTIME_MODEL": "gpt-realtime-2.1",
                "OPENAI_TRANSCRIBE_MODEL": "gpt-transcribe",
            },
            clear=True,
        ):
            session = RealtimeSession()
            connection = _FakeConnection()
            realtime = _FakeRealtimeResource(connection)
            session.client.realtime = realtime
            await session.connect_session("test", [])

        self.assertEqual(realtime.model, "gpt-realtime-2.1")
        self.assertFalse(connection.session.payload["audio"]["input"]["turn_detection"]["create_response"])
        self.assertEqual(
            connection.session.payload["audio"]["input"]["transcription"],
            {"model": "gpt-transcribe", "languages": ["ko"]},
        )

    async def test_committed_audio_is_exposed_to_runtime_orchestrator(self):
        with patch.dict("os.environ", {"OPENAI_API_KEY": "test-key"}, clear=True):
            session = RealtimeSession()

        class EventConnection:
            def __init__(self):
                self.events = [
                    SimpleNamespace(
                        type="input_audio_buffer.committed",
                        item_id="user-item-1",
                    )
                ]

            def __aiter__(self):
                return self

            async def __anext__(self):
                if not self.events:
                    raise StopAsyncIteration
                return self.events.pop(0)

        session.connection = EventConnection()
        committed = []

        async def ignore_audio(*_):
            return None

        await session.main(
            on_text_delta=lambda *_: None,
            on_text_done=lambda *_: None,
            on_audio_delta=ignore_audio,
            on_input_audio_committed=committed.append,
        )

        self.assertEqual(committed, ["user-item-1"])


if __name__ == "__main__":
    unittest.main()
