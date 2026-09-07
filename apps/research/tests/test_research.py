from __future__ import annotations

import json
import sqlite3
import tempfile
import time
import unittest
from pathlib import Path

from fastapi.testclient import TestClient
from research_agent.config import ResearchSettings
from research_agent.events import ResearchEventStream
from research_agent.main import create_app
from research_agent.repository import ResearchRepository
from research_agent.scoring import score_assessments
from voice_agent_persistence import metadata
from voice_agent_persistence.testing import create_sqlite_test_engine


def assessment(asset_id: str, required: int, maximum: int) -> dict:
    return {
        "id": asset_id,
        "title": asset_id.upper(),
        "items": [
            {"id": f"{asset_id}_{index + 1}", "prompt": f"Question {index + 1}", "response_set": "frequency"}
            for index in range(required)
        ],
        "response_sets": {
            "frequency": [
                {"id": "not_at_all", "label": "Not at all", "score": 0},
                {"id": "several_days", "label": "Several days", "score": 1},
                {"id": "nearly_every_day", "label": "Nearly every day", "score": 3},
            ]
        },
        "scoring": {
            "required_answer_count": required,
            "maximum": maximum,
            "rules": [
                {"id": "screen_negative", "min_score": 0, "max_score": 2},
                {"id": "further_assessment_needed", "min_score": 3, "max_score": maximum},
            ],
        },
    }


def bundle() -> dict:
    return {
        "workspace_id": "workspace-test",
        "flow_spec": {"id": "agent-test", "name": "On Call", "version": 1},
        "tools": [],
        "functions": [],
        "state_schema": None,
        "data_assets": [
            {"name": "PHQ-2", "format": "JSON", "content": json.dumps(assessment("phq_2", 2, 6))},
            {"name": "PHQ-9", "format": "JSON", "content": json.dumps(assessment("phq_9", 9, 27))},
        ],
    }


class FakeAnalyzer:
    async def analyze(self, **kwargs):
        del kwargs
        return {
            "summary": "대화와 선별검사 결과를 함께 검토했습니다.",
            "data_quality": "sufficient",
            "evidence": [
                {
                    "domain": "mood",
                    "finding": "최근 기분에 관해 응답했습니다.",
                    "quote": "요즘 괜찮아요.",
                    "turn_id": "turn_2",
                }
            ],
            "strengths": ["대화에 참여함"],
            "concerns": [],
        }, "model"


class ResearchAgentTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.db = Path(self.temp.name) / "runtime.sqlite3"
        with sqlite3.connect(self.db) as connection:
            connection.executescript(
                """
                CREATE TABLE deployments (
                    id TEXT PRIMARY KEY, workspace_id TEXT, agent_id TEXT,
                    agent_name TEXT, version INTEGER, active INTEGER,
                    bundle_json TEXT, created_at TEXT
                );
                CREATE TABLE outbound_calls (
                    id TEXT PRIMARY KEY, token TEXT UNIQUE, agent_id TEXT,
                    deployment_id TEXT, from_number TEXT, to_number TEXT,
                    contact_id TEXT, contact_name TEXT, contact_photo_data_url TEXT,
                    call_sid TEXT, status TEXT, created_at TEXT, started_at TEXT,
                    completed_at TEXT, duration_ms INTEGER, turn_count INTEGER,
                    latency_ms INTEGER, execution_path_json TEXT, transcript_json TEXT,
                    state_json TEXT, trace_json TEXT, flow_completed INTEGER
                );
                CREATE TABLE workspace_settings (
                    workspace_id TEXT PRIMARY KEY, public_url TEXT,
                    telephony_integration TEXT, twilio_account_sid TEXT,
                    twilio_auth_token_encrypted TEXT, twilio_phone_number TEXT,
                    openai_endpoint TEXT, openai_api_key_encrypted TEXT, updated_at TEXT
                );
                """
            )
            connection.execute(
                "INSERT INTO deployments VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    "deployment-test",
                    "workspace-test",
                    "agent-test",
                    "On Call",
                    1,
                    1,
                    json.dumps(bundle()),
                    "2026-09-04T00:00:00+00:00",
                ),
            )
            connection.execute(
                """INSERT INTO outbound_calls (
                    id, token, agent_id, deployment_id, from_number, to_number,
                    contact_id, contact_name, call_sid, status, created_at,
                    started_at, completed_at, turn_count, transcript_json,
                    state_json, flow_completed
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    "call-test",
                    "token",
                    "agent-test",
                    "deployment-test",
                    "+100",
                    "+821012345678",
                    "contact-test",
                    "홍길동",
                    "CA-test",
                    "completed",
                    "2026-09-04T00:00:00+00:00",
                    "2026-09-04T00:00:01+00:00",
                    "2026-09-04T00:05:00+00:00",
                    2,
                    json.dumps(
                        {
                            "turns": [
                                {"speaker": "assistant", "raw_text": "안녕하세요."},
                                {"speaker": "user", "raw_text": "요즘 괜찮아요."},
                            ]
                        },
                        ensure_ascii=False,
                    ),
                    json.dumps(
                        {
                            "consent": {"status": "granted"},
                            "phq_9": {
                                "status": "completed",
                                "current_item_index": 2,
                                "answers": ["not_at_all", "nearly_every_day"],
                            },
                        },
                        ensure_ascii=False,
                    ),
                    1,
                ),
            )
        settings = ResearchSettings(
            database_url="postgresql+psycopg://test:test@localhost/test",
            model="gpt-5.6-terra",
        )
        self.engine = create_sqlite_test_engine(self.db)
        metadata.create_all(self.engine)
        self.repository = ResearchRepository(
            settings.database_url,
            settings.secret_encryption_key,
            engine=self.engine,
        )
        self.events = ResearchEventStream()
        self.client = TestClient(
            create_app(
                settings=settings,
                repository=self.repository,
                analyzer=FakeAnalyzer(),
                event_stream=self.events,
            )
        )

    def tearDown(self):
        self.engine.dispose()
        self.temp.cleanup()

    def test_scores_short_form_from_shared_state(self):
        result = score_assessments(
            {"phq_9": {"answers": ["not_at_all", "nearly_every_day"]}},
            bundle(),
        )
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0].key, "phq_2")
        self.assertEqual(result[0].score, 3)
        self.assertEqual(result[0].classification, "further_assessment_needed")

    def test_keeps_short_form_when_full_form_is_complete(self):
        result = score_assessments(
            {"phq_9": {"answers": ["several_days"] * 9}},
            bundle(),
        )
        self.assertEqual([item.key for item in result], ["phq_2", "phq_9"])
        self.assertEqual([item.score for item in result], [2, 9])

    def test_analyzes_and_lists_completed_report(self):
        queued = self.client.post("/api/reports/analyze/call-test")
        self.assertEqual(queued.status_code, 202, queued.text)
        report = None
        for _ in range(30):
            rows = self.client.get("/api/reports", params={"workspace_id": "workspace-test"}).json()
            if rows and rows[0]["status"] == "completed":
                report = rows[0]
                break
            time.sleep(0.01)
        self.assertIsNotNone(report)
        self.assertEqual(report["assessments"][0]["form"], "PHQ-2")
        detail = self.client.get(f"/api/reports/{report['id']}")
        self.assertEqual(detail.status_code, 200, detail.text)
        self.assertEqual(detail.json()["analysis_mode"], "model")
        self.assertEqual(detail.json()["evidence"][0]["turn_id"], "turn_2")
        event_queue = self.events.subscribe(after_sequence=0)
        events = [json.loads(event_queue.get_nowait()) for _ in range(3)]
        self.events.unsubscribe(event_queue)
        self.assertEqual(
            [event["event"] for event in events],
            ["report_queued", "report_running", "report_completed"],
        )
        self.assertTrue(all(event["data"]["workspace_id"] == "workspace-test" for event in events))


if __name__ == "__main__":
    unittest.main()
