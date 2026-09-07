from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from fastapi.testclient import TestClient
from test_engine import bundle
from voice_agent_persistence import metadata
from voice_agent_persistence.testing import create_sqlite_test_engine
from voice_agent_runtime.config import RuntimeSettings
from voice_agent_runtime.live_events import RuntimeEventStream, ScopedRuntimeEventStream
from voice_agent_runtime.main import create_app
from voice_agent_runtime.repository import RuntimeRepository, _call_review


class FakeCalls:
    def __init__(self):
        self.requests = []

    def create(self, **kwargs):
        self.requests.append(kwargs)
        return SimpleNamespace(sid="CA-test", status="queued")


class FakeTwilioClient:
    calls = FakeCalls()

    def __init__(self, account_sid: str, auth_token: str):
        self.account_sid = account_sid
        self.auth_token = auth_token
        self.calls = type(self).calls


class RuntimeApiTests(unittest.TestCase):
    def setUp(self):
        self.temporary_directory = tempfile.TemporaryDirectory()
        database_path = Path(self.temporary_directory.name) / "runtime.sqlite3"
        self.database_path = database_path
        settings = RuntimeSettings(
            database_url="postgresql+psycopg://test:test@localhost/test",
        )
        self.engine = create_sqlite_test_engine(database_path)
        metadata.create_all(self.engine)
        repository = RuntimeRepository(settings.database_url, engine=self.engine)
        self.repository = repository
        FakeTwilioClient.calls = FakeCalls()
        self.client = TestClient(
            create_app(
                settings=settings,
                repository=repository,
                twilio_client_factory=FakeTwilioClient,
            )
        )

    def tearDown(self):
        self.engine.dispose()
        self.temporary_directory.cleanup()

    def test_workspace_documents_are_persisted_without_browser_secrets(self):
        workspace = {
            "id": "workspace-test",
            "name": "Test Workspace",
            "description": "Stored in PostgreSQL",
            "agents": [{"id": "agent-test"}],
            "contacts": [{"id": "contact-test", "name": "Caller"}],
            "settings": {
                "connections": {"publicUrl": "https://runtime.example.com"},
                "environmentVariables": {
                    "twilioAuthToken": "must-not-be-stored",
                    "openaiApiKey": "must-not-be-stored",
                },
            },
        }
        saved = self.client.put(
            "/api/workspaces/workspace-test",
            json={"document": workspace},
        )
        self.assertEqual(saved.status_code, 200, saved.text)
        stored_environment = saved.json()["document"]["settings"]["environmentVariables"]
        self.assertEqual(stored_environment["twilioAuthToken"], "")
        self.assertEqual(stored_environment["openaiApiKey"], "")

        listed = self.client.get("/api/workspaces")
        self.assertEqual(listed.status_code, 200, listed.text)
        self.assertEqual(len(listed.json()), 1)
        self.assertEqual(listed.json()[0]["workspace_id"], "workspace-test")

        fetched = self.client.get("/api/workspaces/workspace-test")
        self.assertEqual(fetched.status_code, 200, fetched.text)
        self.assertEqual(fetched.json()["document"]["name"], "Test Workspace")

        mismatch = self.client.put(
            "/api/workspaces/workspace-test",
            json={"document": {"id": "workspace-other"}},
        )
        self.assertEqual(mismatch.status_code, 422, mismatch.text)

        deleted = self.client.delete("/api/workspaces/workspace-test")
        self.assertEqual(deleted.status_code, 204, deleted.text)
        self.assertEqual(self.client.get("/api/workspaces").json(), [])
        self.assertEqual(
            self.client.get("/api/workspaces/workspace-test").status_code,
            404,
        )

    def test_deploy_then_start_outbound_call(self):
        settings_response = self.client.put(
            "/api/workspaces/workspace-test/settings",
            json={
                "connections": {
                    "publicUrl": "https://workspace-runtime.example.com",
                    "telephonyIntegration": "media_streams",
                },
                "environmentVariables": {
                    "twilioAccountSid": "AC-workspace",
                    "twilioAuthToken": "workspace-token",
                    "twilioPhoneNumber": "+19179607135",
                    "openaiEndpoint": "https://api.openai.com/v1",
                    "openaiApiKey": "sk-workspace",
                },
            },
        )
        self.assertEqual(settings_response.status_code, 200, settings_response.text)
        self.assertTrue(settings_response.json()["twilio_auth_token_configured"])
        database_bytes = self.database_path.read_bytes()
        self.assertNotIn(b"workspace-token", database_bytes)
        self.assertNotIn(b"sk-workspace", database_bytes)

        deployment = self.client.post("/api/deployments", json=bundle().model_dump())
        self.assertEqual(deployment.status_code, 201, deployment.text)
        self.assertTrue(deployment.json()["active"])

        response = self.client.post(
            "/api/outbound-calls",
            json={
                "agent_id": "agent-test",
                "to_number": "010-1234-5678",
                "contact_id": "contact-test",
                "contact_name": "Test Contact",
                "contact_photo_data_url": "data:image/png;base64,dGVzdA==",
            },
        )

        self.assertEqual(response.status_code, 201, response.text)
        self.assertEqual(response.json()["call_sid"], "CA-test")
        request = FakeTwilioClient.calls.requests[0]
        self.assertEqual(request["from_"], "+19179607135")
        self.assertEqual(request["to"], "+821012345678")
        self.assertNotIn("url", request)
        self.assertNotIn("method", request)
        self.assertIn("wss://workspace-runtime.example.com/api/twilio/media/", request["twiml"])

        token = request["twiml"].split("/api/twilio/media/", 1)[1].split('"', 1)[0]
        twiml = self.client.post(f"/api/twilio/voice/{token}")
        self.assertEqual(twiml.status_code, 200)
        self.assertIn("wss://workspace-runtime.example.com/api/twilio/media/", twiml.text)

        call_id = response.json()["id"]
        self.repository.mark_call_started(call_id, call_sid="CA-test")
        self.repository.finalize_call(
            call_id,
            status="completed",
            transcript={
                "call_id": "CA-test",
                "turns": [
                    {"speaker": "assistant", "raw_text": "안녕하세요."},
                    {"speaker": "user", "raw_text": "네, 괜찮아요."},
                ],
            },
            state={"consent": {"status": "granted"}},
            trace={
                "turns": [
                    {"latency_ms": {"commit_to_first_audio": 240.0}},
                ],
            },
            execution_path=["AI 통화 동의", "자연스러운 안부"],
            flow_completed=True,
        )

        records = self.client.get(
            "/api/call-records",
            params={"workspace_id": "workspace-test"},
        )
        self.assertEqual(records.status_code, 200, records.text)
        self.assertEqual(records.json()[0]["id"], call_id)
        self.assertEqual(records.json()[0]["turns"], 1)
        self.assertEqual(records.json()[0]["latency_ms"], 240)
        self.assertEqual(records.json()[0]["status"], "completed")
        self.assertIsNone(records.json()[0]["review"])
        self.assertEqual(records.json()[0]["contact_id"], "contact-test")
        self.assertEqual(records.json()[0]["contact_name"], "Test Contact")
        self.assertEqual(
            records.json()[0]["contact_photo_data_url"],
            "data:image/png;base64,dGVzdA==",
        )
        self.assertEqual(
            records.json()[0]["path"],
            ["AI 통화 동의", "자연스러운 안부"],
        )
        self.assertTrue(records.json()[0]["has_transcript"])
        self.assertTrue(records.json()[0]["has_state"])

        transcript = self.client.get(f"/api/call-records/{call_id}/transcript")
        self.assertEqual(transcript.status_code, 200, transcript.text)
        self.assertEqual(transcript.json()["call_id"], "CA-test")

        state = self.client.get(f"/api/call-records/{call_id}/state")
        self.assertEqual(state.status_code, 200, state.text)
        self.assertEqual(state.json(), {"consent": {"status": "granted"}})

        deleted = self.client.delete(f"/api/call-records/{call_id}")
        self.assertEqual(deleted.status_code, 204, deleted.text)
        self.assertEqual(
            self.client.get(
                "/api/call-records",
                params={"workspace_id": "workspace-test"},
            ).json(),
            [],
        )
        missing = self.client.delete(f"/api/call-records/{call_id}")
        self.assertEqual(missing.status_code, 404, missing.text)


class CallReviewTests(unittest.TestCase):
    def test_classifies_review_separately_from_call_status(self):
        self.assertEqual(
            _call_review({"safety": {"triggered": True}}, "completed", True),
            "safety",
        )


class RuntimeEventStreamTests(unittest.TestCase):
    def test_scopes_and_replays_live_events(self):
        stream = RuntimeEventStream()
        scoped = ScopedRuntimeEventStream(
            stream,
            {
                "runtime_call_id": "call-test",
                "runtime_workspace_id": "workspace-test",
            },
        )
        scoped.emit("transcription", {"text": "안녕하세요"})

        queue = stream.subscribe(after_sequence=0)
        payload = json.loads(queue.get_nowait())
        self.assertEqual(payload["sequence"], 1)
        self.assertEqual(payload["event"], "transcription")
        self.assertEqual(payload["data"]["runtime_call_id"], "call-test")
        self.assertEqual(payload["data"]["runtime_workspace_id"], "workspace-test")
        self.assertEqual(payload["data"]["text"], "안녕하세요")

        no_replay = stream.subscribe(after_sequence=1)
        self.assertTrue(no_replay.empty())
        self.assertEqual(
            _call_review({"consent": {"status": "declined"}}, "completed", True),
            "declined",
        )
        self.assertEqual(
            _call_review({"consent": {"status": "pending"}}, "completed", None),
            "incomplete",
        )
        self.assertEqual(
            _call_review({"consent": {"status": "pending"}}, "completed", False),
            "incomplete",
        )
        self.assertEqual(
            _call_review(
                {
                    "consent": {"status": "granted"},
                    "call": {"stop_requested": True},
                },
                "completed",
                True,
            ),
            "incomplete",
        )
        self.assertEqual(
            _call_review(
                {
                    "consent": {"status": "granted"},
                    "phq_9": {"status": "in_progress", "answers": []},
                },
                "completed",
                False,
            ),
            "incomplete",
        )
        self.assertIsNone(
            _call_review(
                {
                    "consent": {"status": "granted"},
                    "phq_9": {"status": "completed", "answers": ["phq_not_at_all"]},
                },
                "completed",
                True,
            )
        )


if __name__ == "__main__":
    unittest.main()
