from __future__ import annotations

from sqlalchemy import (
    JSON,
    Boolean,
    Column,
    ForeignKey,
    Index,
    Integer,
    MetaData,
    String,
    Table,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB

metadata = MetaData()
json_document = JSON().with_variant(JSONB(), "postgresql")


workspace_documents = Table(
    "workspace_documents",
    metadata,
    Column("workspace_id", String(200), primary_key=True),
    Column("document_json", json_document, nullable=False),
    Column("updated_at", String(40), nullable=False),
)


deployments = Table(
    "deployments",
    metadata,
    Column("id", String(80), primary_key=True),
    Column("workspace_id", String(200), nullable=False),
    Column("agent_id", String(200), nullable=False),
    Column("agent_name", String(300), nullable=False),
    Column("version", Integer, nullable=False),
    Column("active", Boolean, nullable=False, default=True, server_default="true"),
    Column("bundle_json", json_document, nullable=False),
    Column("created_at", String(40), nullable=False),
    UniqueConstraint("agent_id", "version", name="uq_deployments_agent_version"),
)
Index("idx_deployments_active", deployments.c.agent_id, deployments.c.active)


outbound_calls = Table(
    "outbound_calls",
    metadata,
    Column("id", String(80), primary_key=True),
    Column("token", String(64), nullable=False, unique=True),
    Column("agent_id", String(200), nullable=False),
    Column(
        "deployment_id",
        String(80),
        ForeignKey("deployments.id"),
        nullable=False,
    ),
    Column("from_number", String(24), nullable=False),
    Column("to_number", String(24), nullable=False),
    Column("contact_id", String(200)),
    Column("contact_name", String(300)),
    Column("contact_photo_data_url", Text),
    Column("call_sid", String(80)),
    Column("status", String(40), nullable=False),
    Column("created_at", String(40), nullable=False),
    Column("started_at", String(40)),
    Column("completed_at", String(40)),
    Column("duration_ms", Integer),
    Column("turn_count", Integer, nullable=False, default=0, server_default="0"),
    Column("latency_ms", Integer),
    Column("execution_path_json", json_document),
    Column("transcript_json", json_document),
    Column("state_json", json_document),
    Column("trace_json", json_document),
    Column("flow_completed", Boolean),
)
Index("idx_outbound_calls_deployment", outbound_calls.c.deployment_id)
Index("idx_outbound_calls_contact", outbound_calls.c.contact_id, outbound_calls.c.created_at)


workspace_settings = Table(
    "workspace_settings",
    metadata,
    Column("workspace_id", String(200), primary_key=True),
    Column("public_url", Text, nullable=False),
    Column("telephony_integration", String(40), nullable=False),
    Column("twilio_account_sid", Text, nullable=False),
    Column("twilio_auth_token_encrypted", Text, nullable=False),
    Column("twilio_phone_number", String(24), nullable=False, default="", server_default=""),
    Column("openai_endpoint", Text, nullable=False),
    Column("openai_api_key_encrypted", Text, nullable=False),
    Column("updated_at", String(40), nullable=False),
)


research_reports = Table(
    "research_reports",
    metadata,
    Column("id", String(80), primary_key=True),
    Column(
        "call_id",
        String(80),
        ForeignKey("outbound_calls.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
    ),
    Column("workspace_id", String(200), nullable=False),
    Column("contact_id", String(200)),
    Column("status", String(40), nullable=False),
    Column("model", String(200), nullable=False),
    Column("report_json", json_document),
    Column("error", Text),
    Column("created_at", String(40), nullable=False),
    Column("updated_at", String(40), nullable=False),
)
Index("idx_research_reports_workspace", research_reports.c.workspace_id, research_reports.c.updated_at)
Index("idx_research_reports_contact", research_reports.c.contact_id, research_reports.c.updated_at)
