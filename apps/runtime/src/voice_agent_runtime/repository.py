from __future__ import annotations

import json
from copy import deepcopy
from datetime import datetime
from statistics import median
from typing import Any, Mapping
from uuid import uuid4

from sqlalchemy import Engine, delete, func, insert, select, update
from voice_agent_persistence import (
    create_database_engine,
    deployments,
    outbound_calls,
    workspace_documents,
    workspace_settings,
)

from .models import (
    CallRecordSummary,
    DeploymentBundle,
    DeploymentRecord,
    OutboundCallResponse,
    WorkspaceDocumentRecord,
    WorkspaceRuntimeCredentials,
    WorkspaceSettingsPayload,
    WorkspaceSettingsStatus,
    utc_now,
)
from .secrets import SecretCipher


def _json_value(value: Any, fallback: Any) -> Any:
    if value is None or value == "":
        return fallback
    if isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return fallback
    return value


def _call_review(
    state: dict[str, Any],
    status: str,
    flow_completed: bool | None = None,
) -> str | None:
    safety = state.get("safety")
    if isinstance(safety, dict) and safety.get("triggered") is True:
        return "safety"

    consent = state.get("consent")
    consent_status = consent.get("status") if isinstance(consent, dict) else None
    if consent_status == "declined":
        return "declined"

    call_state = state.get("call")
    if isinstance(call_state, dict) and call_state.get("stop_requested") is True:
        return "incomplete"

    if flow_completed is False:
        return "incomplete"
    if flow_completed is True:
        return None

    if consent_status in {"pending", "unclear"}:
        return "incomplete"
    if consent_status != "granted":
        return None
    if status in {"failed", "disconnected", "canceled"}:
        return "incomplete"

    assessments = [
        value
        for value in state.values()
        if isinstance(value, dict)
        and isinstance(value.get("answers"), list)
        and value.get("status") in {"idle", "in_progress", "completed", "skipped"}
    ]
    if assessments and (
        any(item.get("status") == "in_progress" for item in assessments)
        or not any(item.get("status") in {"completed", "skipped"} for item in assessments)
    ):
        return "incomplete"
    return None


class RuntimeRepository:
    def __init__(
        self,
        database_url: str,
        secret_key: str = "local-development-only-change-me",
        *,
        engine: Engine | None = None,
    ):
        self.engine = engine or create_database_engine(database_url)
        self._cipher = SecretCipher(secret_key)

    @staticmethod
    def _sanitize_workspace_document(
        workspace_id: str,
        document: Mapping[str, Any],
    ) -> dict[str, Any]:
        sanitized = deepcopy(dict(document))
        sanitized["id"] = workspace_id
        settings = sanitized.get("settings")
        if isinstance(settings, dict):
            environment = settings.get("environmentVariables")
            if isinstance(environment, dict):
                environment["twilioAuthToken"] = ""
                environment["openaiApiKey"] = ""
        return sanitized

    def save_workspace_document(
        self,
        workspace_id: str,
        document: Mapping[str, Any],
    ) -> WorkspaceDocumentRecord:
        sanitized = self._sanitize_workspace_document(workspace_id, document)
        updated_at = utc_now()
        values = {"document_json": sanitized, "updated_at": updated_at}
        with self.engine.begin() as connection:
            result = connection.execute(
                update(workspace_documents).where(workspace_documents.c.workspace_id == workspace_id).values(**values)
            )
            if result.rowcount == 0:
                connection.execute(
                    insert(workspace_documents).values(
                        workspace_id=workspace_id,
                        **values,
                    )
                )
        return WorkspaceDocumentRecord(
            workspace_id=workspace_id,
            document=sanitized,
            updated_at=updated_at,
        )

    def list_workspace_documents(self) -> list[WorkspaceDocumentRecord]:
        with self.engine.connect() as connection:
            rows = (
                connection.execute(select(workspace_documents).order_by(workspace_documents.c.updated_at.desc()))
                .mappings()
                .all()
            )
        return [
            WorkspaceDocumentRecord(
                workspace_id=row["workspace_id"],
                document=_json_value(row["document_json"], {}),
                updated_at=row["updated_at"],
            )
            for row in rows
        ]

    def get_workspace_document(
        self,
        workspace_id: str,
    ) -> WorkspaceDocumentRecord | None:
        with self.engine.connect() as connection:
            row = (
                connection.execute(
                    select(workspace_documents).where(workspace_documents.c.workspace_id == workspace_id)
                )
                .mappings()
                .first()
            )
        if row is None:
            return None
        return WorkspaceDocumentRecord(
            workspace_id=row["workspace_id"],
            document=_json_value(row["document_json"], {}),
            updated_at=row["updated_at"],
        )

    def delete_workspace_document(self, workspace_id: str) -> bool:
        with self.engine.begin() as connection:
            result = connection.execute(
                delete(workspace_documents).where(workspace_documents.c.workspace_id == workspace_id)
            )
        return bool(result.rowcount)

    def save_workspace_settings(
        self,
        workspace_id: str,
        settings: WorkspaceSettingsPayload,
    ) -> WorkspaceSettingsStatus:
        current = self.get_workspace_settings(workspace_id)
        environment = settings.environmentVariables
        twilio_auth_token = environment.twilioAuthToken or (current.twilio_auth_token if current else "")
        openai_api_key = environment.openaiApiKey or (current.openai_api_key if current else "")
        public_url = settings.connections.publicUrl.rstrip("/")
        openai_endpoint = environment.openaiEndpoint.rstrip("/")
        updated_at = utc_now()
        values = {
            "public_url": public_url,
            "telephony_integration": settings.connections.telephonyIntegration,
            "twilio_account_sid": environment.twilioAccountSid,
            "twilio_auth_token_encrypted": self._cipher.encrypt(twilio_auth_token),
            "twilio_phone_number": environment.twilioPhoneNumber,
            "openai_endpoint": openai_endpoint,
            "openai_api_key_encrypted": self._cipher.encrypt(openai_api_key),
            "updated_at": updated_at,
        }
        with self.engine.begin() as connection:
            result = connection.execute(
                update(workspace_settings).where(workspace_settings.c.workspace_id == workspace_id).values(**values)
            )
            if result.rowcount == 0:
                connection.execute(insert(workspace_settings).values(workspace_id=workspace_id, **values))
        return WorkspaceSettingsStatus(
            workspace_id=workspace_id,
            public_url=public_url,
            telephony_integration=settings.connections.telephonyIntegration,
            twilio_account_sid=environment.twilioAccountSid,
            twilio_phone_number=environment.twilioPhoneNumber,
            openai_endpoint=openai_endpoint,
            twilio_auth_token_configured=bool(twilio_auth_token),
            openai_api_key_configured=bool(openai_api_key),
            updated_at=updated_at,
        )

    def get_workspace_settings(self, workspace_id: str) -> WorkspaceRuntimeCredentials | None:
        with self.engine.connect() as connection:
            row = (
                connection.execute(select(workspace_settings).where(workspace_settings.c.workspace_id == workspace_id))
                .mappings()
                .first()
            )
        if row is None:
            return None
        return WorkspaceRuntimeCredentials(
            workspace_id=row["workspace_id"],
            public_url=row["public_url"],
            telephony_integration=row["telephony_integration"],
            twilio_account_sid=row["twilio_account_sid"],
            twilio_auth_token=self._cipher.decrypt(row["twilio_auth_token_encrypted"]),
            twilio_phone_number=row["twilio_phone_number"],
            openai_endpoint=row["openai_endpoint"],
            openai_api_key=self._cipher.decrypt(row["openai_api_key_encrypted"]),
            updated_at=row["updated_at"],
        )

    def deploy(self, bundle: DeploymentBundle) -> DeploymentRecord:
        flow = bundle.flow_spec
        deployment_id = f"deployment-{uuid4()}"
        created_at = utc_now()
        with self.engine.begin() as connection:
            connection.execute(
                update(deployments)
                .where(
                    deployments.c.agent_id == flow["id"],
                    deployments.c.active.is_(True),
                )
                .values(active=False)
            )
            connection.execute(
                insert(deployments).values(
                    id=deployment_id,
                    workspace_id=bundle.workspace_id,
                    agent_id=flow["id"],
                    agent_name=flow.get("name", flow["id"]),
                    version=flow["version"],
                    active=True,
                    bundle_json=bundle.model_dump(mode="json"),
                    created_at=created_at,
                )
            )
        return DeploymentRecord(
            id=deployment_id,
            workspace_id=bundle.workspace_id,
            agent_id=flow["id"],
            agent_name=flow.get("name", flow["id"]),
            version=flow["version"],
            active=True,
            created_at=created_at,
        )

    def list_active_deployments(self, workspace_id: str | None = None) -> list[DeploymentRecord]:
        statement = select(deployments).where(deployments.c.active.is_(True))
        if workspace_id:
            statement = statement.where(deployments.c.workspace_id == workspace_id)
        statement = statement.order_by(deployments.c.created_at.desc())
        with self.engine.connect() as connection:
            rows = connection.execute(statement).mappings().all()
        return [self._deployment_record(row) for row in rows]

    def get_active_bundle(self, agent_id: str) -> tuple[DeploymentRecord, DeploymentBundle] | None:
        with self.engine.connect() as connection:
            row = (
                connection.execute(
                    select(deployments)
                    .where(
                        deployments.c.agent_id == agent_id,
                        deployments.c.active.is_(True),
                    )
                    .limit(1)
                )
                .mappings()
                .first()
            )
        if row is None:
            return None
        return self._deployment_record(row), self._bundle(row["bundle_json"])

    def get_bundle(self, deployment_id: str) -> DeploymentBundle | None:
        with self.engine.connect() as connection:
            value = connection.execute(
                select(deployments.c.bundle_json).where(deployments.c.id == deployment_id)
            ).scalar_one_or_none()
        return self._bundle(value) if value is not None else None

    def create_call(
        self,
        *,
        agent_id: str,
        deployment_id: str,
        from_number: str,
        to_number: str,
        contact_id: str | None = None,
        contact_name: str | None = None,
        contact_photo_data_url: str | None = None,
    ) -> tuple[str, OutboundCallResponse]:
        call_id = f"call-{uuid4()}"
        token = uuid4().hex
        created_at = utc_now()
        record = OutboundCallResponse(
            id=call_id,
            call_sid=None,
            status="preparing",
            agent_id=agent_id,
            deployment_id=deployment_id,
            from_number=from_number,
            to_number=to_number,
            created_at=created_at,
        )
        with self.engine.begin() as connection:
            connection.execute(
                insert(outbound_calls).values(
                    id=call_id,
                    token=token,
                    agent_id=agent_id,
                    deployment_id=deployment_id,
                    from_number=from_number,
                    to_number=to_number,
                    contact_id=contact_id,
                    contact_name=contact_name,
                    contact_photo_data_url=contact_photo_data_url,
                    call_sid=None,
                    status="preparing",
                    created_at=created_at,
                )
            )
        return token, record

    def update_call(self, call_id: str, *, status: str, call_sid: str | None = None) -> None:
        values: dict[str, Any] = {"status": status}
        if call_sid is not None:
            values["call_sid"] = call_sid
        with self.engine.begin() as connection:
            connection.execute(update(outbound_calls).where(outbound_calls.c.id == call_id).values(**values))

    def mark_call_started(self, call_id: str, *, call_sid: str | None = None) -> None:
        values: dict[str, Any] = {
            "status": "in-progress",
            "started_at": func.coalesce(outbound_calls.c.started_at, utc_now()),
        }
        if call_sid is not None:
            values["call_sid"] = call_sid
        with self.engine.begin() as connection:
            connection.execute(update(outbound_calls).where(outbound_calls.c.id == call_id).values(**values))

    def finalize_call(
        self,
        call_id: str,
        *,
        status: str,
        transcript: dict[str, Any],
        state: dict[str, Any],
        trace: dict[str, Any],
        execution_path: list[str],
        flow_completed: bool = False,
    ) -> None:
        completed_at = utc_now()
        with self.engine.begin() as connection:
            row = (
                connection.execute(
                    select(outbound_calls.c.created_at, outbound_calls.c.started_at).where(
                        outbound_calls.c.id == call_id
                    )
                )
                .mappings()
                .first()
            )
            if row is None:
                return
            started_at = row["started_at"] or row["created_at"]
            duration_ms = max(
                0,
                round(
                    (datetime.fromisoformat(completed_at) - datetime.fromisoformat(started_at)).total_seconds() * 1000
                ),
            )
            turns = sum(
                1
                for turn in transcript.get("turns", [])
                if turn.get("speaker") == "user" and str(turn.get("raw_text", "")).strip()
            )
            latencies = [turn.get("latency_ms", {}).get("commit_to_first_audio") for turn in trace.get("turns", [])]
            measured = [float(value) for value in latencies if isinstance(value, (int, float))]
            connection.execute(
                update(outbound_calls)
                .where(outbound_calls.c.id == call_id)
                .values(
                    status=status,
                    completed_at=completed_at,
                    duration_ms=duration_ms,
                    turn_count=turns,
                    latency_ms=round(median(measured)) if measured else None,
                    execution_path_json=execution_path,
                    transcript_json=transcript,
                    state_json=state,
                    trace_json=trace,
                    flow_completed=flow_completed,
                )
            )

    def list_call_records(self, workspace_id: str) -> list[CallRecordSummary]:
        statement = (
            select(outbound_calls, deployments.c.workspace_id, deployments.c.agent_name)
            .join(deployments, deployments.c.id == outbound_calls.c.deployment_id)
            .where(deployments.c.workspace_id == workspace_id)
            .order_by(outbound_calls.c.created_at.desc())
        )
        with self.engine.connect() as connection:
            rows = connection.execute(statement).mappings().all()
        records: list[CallRecordSummary] = []
        for row in rows:
            state = _json_value(row["state_json"], {})
            flow_completed = row["flow_completed"]
            review = _call_review(state, row["status"], flow_completed) if isinstance(state, dict) else None
            records.append(
                CallRecordSummary(
                    id=row["id"],
                    workspace_id=row["workspace_id"],
                    agent_id=row["agent_id"],
                    agent_name=row["agent_name"],
                    deployment_id=row["deployment_id"],
                    from_number=row["from_number"],
                    to_number=row["to_number"],
                    contact_id=row["contact_id"],
                    contact_name=row["contact_name"],
                    contact_photo_data_url=row["contact_photo_data_url"],
                    call_sid=row["call_sid"],
                    status=row["status"],
                    created_at=row["created_at"],
                    started_at=row["started_at"],
                    completed_at=row["completed_at"],
                    duration_ms=row["duration_ms"],
                    turns=row["turn_count"] or 0,
                    latency_ms=row["latency_ms"],
                    review=review,
                    path=_json_value(row["execution_path_json"], []),
                    has_transcript=row["transcript_json"] is not None,
                    has_state=row["state_json"] is not None,
                )
            )
        return records

    def get_call_artifact(self, call_id: str, artifact: str) -> dict[str, Any] | None:
        column = {
            "transcript": outbound_calls.c.transcript_json,
            "state": outbound_calls.c.state_json,
        }.get(artifact)
        if column is None:
            raise ValueError(f"Unsupported call artifact: {artifact}")
        with self.engine.connect() as connection:
            value = connection.execute(select(column).where(outbound_calls.c.id == call_id)).scalar_one_or_none()
        payload = _json_value(value, None)
        return payload if isinstance(payload, dict) else None

    def delete_call_record(self, call_id: str) -> bool:
        with self.engine.begin() as connection:
            result = connection.execute(delete(outbound_calls).where(outbound_calls.c.id == call_id))
        return result.rowcount > 0

    def get_call_by_token(self, token: str) -> dict[str, Any] | None:
        with self.engine.connect() as connection:
            row = (
                connection.execute(select(outbound_calls).where(outbound_calls.c.token == token).limit(1))
                .mappings()
                .first()
            )
        return dict(row) if row else None

    @staticmethod
    def _deployment_record(row: Mapping[str, Any]) -> DeploymentRecord:
        return DeploymentRecord(
            id=row["id"],
            workspace_id=row["workspace_id"],
            agent_id=row["agent_id"],
            agent_name=row["agent_name"],
            version=row["version"],
            active=bool(row["active"]),
            created_at=row["created_at"],
        )

    @staticmethod
    def _bundle(value: Any) -> DeploymentBundle:
        return DeploymentBundle.model_validate(_json_value(value, {}))
