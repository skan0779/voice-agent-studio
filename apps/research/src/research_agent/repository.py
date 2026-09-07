from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any, Mapping
from uuid import uuid4

from sqlalchemy import Engine, insert, select, update
from voice_agent_persistence import (
    create_database_engine,
    deployments,
    outbound_calls,
    research_reports,
    workspace_settings,
)

from .models import AssessmentResult, ReportListItem, ResearchReport
from .scoring import direction_for_delta
from .secrets import SecretCipher


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class ResearchRepository:
    def __init__(self, database_url: str, secret_key: str, *, engine: Engine | None = None):
        self.engine = engine or create_database_engine(database_url)
        self._cipher = SecretCipher(secret_key)

    @staticmethod
    def _json(value: Any, fallback: Any) -> Any:
        if value is None or value == "":
            return fallback
        if isinstance(value, str):
            try:
                return json.loads(value)
            except json.JSONDecodeError:
                return fallback
        return value

    @staticmethod
    def _eligible(row: Mapping[str, Any]) -> bool:
        if row["call_status"] != "completed" or row["flow_completed"] is not True:
            return False
        if row["transcript_json"] is None or row["state_json"] is None:
            return False
        state = ResearchRepository._json(row["state_json"], {})
        if not isinstance(state, dict):
            return False
        safety = state.get("safety")
        consent = state.get("consent")
        call = state.get("call")
        return (
            not (isinstance(safety, dict) and safety.get("triggered") is True)
            and not (isinstance(consent, dict) and consent.get("status") == "declined")
            and not (isinstance(call, dict) and call.get("stop_requested") is True)
        )

    def get_call_context(self, call_id: str) -> dict[str, Any] | None:
        statement = (
            select(
                outbound_calls,
                deployments.c.workspace_id,
                deployments.c.agent_name,
                deployments.c.bundle_json,
                outbound_calls.c.status.label("call_status"),
            )
            .join(deployments, deployments.c.id == outbound_calls.c.deployment_id)
            .where(outbound_calls.c.id == call_id)
        )
        with self.engine.connect() as connection:
            row = connection.execute(statement).mappings().first()
        if row is None:
            return None
        payload = dict(row)
        payload["eligible"] = self._eligible(row)
        payload["transcript"] = self._json(row["transcript_json"], {})
        payload["state"] = self._json(row["state_json"], {})
        payload["bundle"] = self._json(row["bundle_json"], {})
        return payload

    def get_openai_credentials(self, workspace_id: str) -> tuple[str, str] | None:
        with self.engine.connect() as connection:
            row = (
                connection.execute(
                    select(
                        workspace_settings.c.openai_endpoint,
                        workspace_settings.c.openai_api_key_encrypted,
                    ).where(workspace_settings.c.workspace_id == workspace_id)
                )
                .mappings()
                .first()
            )
        if row is None:
            return None
        return row["openai_endpoint"], self._cipher.decrypt(row["openai_api_key_encrypted"])

    def reserve_report(self, call: dict[str, Any], model: str, *, force: bool) -> tuple[str, str]:
        with self.engine.begin() as connection:
            existing = (
                connection.execute(
                    select(research_reports.c.id, research_reports.c.status).where(
                        research_reports.c.call_id == call["id"]
                    )
                )
                .mappings()
                .first()
            )
            if existing and existing["status"] == "completed" and not force:
                return existing["id"], "already_completed"
            report_id = existing["id"] if existing else f"report-{uuid4()}"
            now = utc_now()
            values = {
                "status": "queued",
                "model": model,
                "report_json": None,
                "error": None,
                "updated_at": now,
            }
            if existing:
                connection.execute(update(research_reports).where(research_reports.c.id == report_id).values(**values))
            else:
                connection.execute(
                    insert(research_reports).values(
                        id=report_id,
                        call_id=call["id"],
                        workspace_id=call["workspace_id"],
                        contact_id=call.get("contact_id"),
                        created_at=now,
                        **values,
                    )
                )
        return report_id, "queued"

    def mark_running(self, report_id: str) -> None:
        with self.engine.begin() as connection:
            connection.execute(
                update(research_reports)
                .where(research_reports.c.id == report_id)
                .values(status="running", updated_at=utc_now())
            )

    def save_report(self, report: ResearchReport) -> None:
        with self.engine.begin() as connection:
            connection.execute(
                update(research_reports)
                .where(research_reports.c.id == report.id)
                .values(
                    status="completed",
                    report_json=report.model_dump(mode="json"),
                    error=None,
                    updated_at=report.generated_at,
                )
            )

    def fail_report(self, report_id: str, error: str) -> None:
        with self.engine.begin() as connection:
            connection.execute(
                update(research_reports)
                .where(research_reports.c.id == report_id)
                .values(status="failed", error=error[:1000], updated_at=utc_now())
            )

    def previous_assessments(
        self,
        contact_id: str | None,
        before: str,
    ) -> tuple[str, dict[str, AssessmentResult]] | None:
        if not contact_id:
            return None
        call_time = self._call_time_expression()
        statement = (
            select(outbound_calls.c.id.label("call_id"), research_reports.c.report_json)
            .join(outbound_calls, outbound_calls.c.id == research_reports.c.call_id)
            .where(
                research_reports.c.contact_id == contact_id,
                research_reports.c.status == "completed",
                call_time < before,
            )
            .order_by(call_time.desc())
        )
        with self.engine.connect() as connection:
            rows = connection.execute(statement).mappings().all()
        for row in rows:
            payload = self._json(row["report_json"], {})
            assessments = {
                item["key"]: AssessmentResult.model_validate(item)
                for item in payload.get("assessments", [])
                if isinstance(item, dict) and isinstance(item.get("key"), str)
            }
            if assessments:
                return row["call_id"], assessments
        return None

    def longitudinal_changes(
        self,
        contact_id: str | None,
        before: str,
        current: list[AssessmentResult],
    ) -> list[dict[str, Any]]:
        previous = self.previous_assessments(contact_id, before)
        if previous is None:
            return []
        previous_call_id, previous_scores = previous
        changes = []
        for item in current:
            old = previous_scores.get(item.key)
            if old is None or old.form != item.form or not old.complete or not item.complete:
                continue
            delta = float(item.score) - float(old.score)
            changes.append(
                {
                    "assessment_key": item.key,
                    "form": item.form,
                    "previous_score": old.score,
                    "current_score": item.score,
                    "delta": int(delta) if delta.is_integer() else delta,
                    "direction": direction_for_delta(item.key, delta),
                    "previous_call_id": previous_call_id,
                }
            )
        return changes

    def list_candidates(self, workspace_id: str) -> list[ReportListItem]:
        call_time = self._call_time_expression()
        statement = (
            select(
                outbound_calls,
                outbound_calls.c.status.label("call_status"),
                deployments.c.workspace_id,
                deployments.c.agent_name,
                research_reports.c.id.label("report_id"),
                research_reports.c.status.label("report_status"),
                research_reports.c.report_json,
                research_reports.c.error,
                research_reports.c.updated_at.label("report_updated_at"),
            )
            .join(deployments, deployments.c.id == outbound_calls.c.deployment_id)
            .outerjoin(research_reports, research_reports.c.call_id == outbound_calls.c.id)
            .where(deployments.c.workspace_id == workspace_id)
            .order_by(call_time.desc())
        )
        with self.engine.connect() as connection:
            rows = connection.execute(statement).mappings().all()
        result: list[ReportListItem] = []
        for row in rows:
            if not self._eligible(row):
                continue
            report_payload = self._json(row["report_json"], {})
            assessments = [
                AssessmentResult.model_validate(item)
                for item in report_payload.get("assessments", [])
                if isinstance(item, dict)
            ]
            result.append(
                ReportListItem(
                    id=row["report_id"],
                    call_id=row["id"],
                    call_sid=row["call_sid"],
                    workspace_id=row["workspace_id"],
                    agent_id=row["agent_id"],
                    agent_name=row["agent_name"],
                    contact_id=row["contact_id"],
                    contact_name=row["contact_name"] or "Unknown Contact",
                    contact_photo_data_url=row["contact_photo_data_url"],
                    to_number=row["to_number"],
                    call_started_at=row["started_at"] or row["created_at"],
                    status=row["report_status"] or "not_started",
                    generated_at=report_payload.get("generated_at") or row["report_updated_at"],
                    priority=report_payload.get("priority"),
                    summary=report_payload.get("summary"),
                    assessments=assessments,
                    error=row["error"],
                )
            )
        return result

    def get_report(self, report_id: str) -> ResearchReport | None:
        with self.engine.connect() as connection:
            value = connection.execute(
                select(research_reports.c.report_json).where(
                    research_reports.c.id == report_id,
                    research_reports.c.status == "completed",
                )
            ).scalar_one_or_none()
        payload = self._json(value, None)
        return ResearchReport.model_validate(payload) if isinstance(payload, dict) else None

    @staticmethod
    def _call_time_expression():
        from sqlalchemy import func

        return func.coalesce(outbound_calls.c.started_at, outbound_calls.c.created_at)
