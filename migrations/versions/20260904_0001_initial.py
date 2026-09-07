"""Create Runtime and Research tables.

Revision ID: 20260904_0001
Revises:
Create Date: 2026-09-04
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "20260904_0001"
down_revision = None
branch_labels = None
depends_on = None


json_document = sa.JSON().with_variant(postgresql.JSONB(), "postgresql")


def upgrade() -> None:
    op.create_table(
        "deployments",
        sa.Column("id", sa.String(length=80), nullable=False),
        sa.Column("workspace_id", sa.String(length=200), nullable=False),
        sa.Column("agent_id", sa.String(length=200), nullable=False),
        sa.Column("agent_name", sa.String(length=300), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("bundle_json", json_document, nullable=False),
        sa.Column("created_at", sa.String(length=40), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("agent_id", "version", name="uq_deployments_agent_version"),
    )
    op.create_index("idx_deployments_active", "deployments", ["agent_id", "active"])

    op.create_table(
        "workspace_settings",
        sa.Column("workspace_id", sa.String(length=200), nullable=False),
        sa.Column("public_url", sa.Text(), nullable=False),
        sa.Column("telephony_integration", sa.String(length=40), nullable=False),
        sa.Column("twilio_account_sid", sa.Text(), nullable=False),
        sa.Column("twilio_auth_token_encrypted", sa.Text(), nullable=False),
        sa.Column("twilio_phone_number", sa.String(length=24), server_default="", nullable=False),
        sa.Column("openai_endpoint", sa.Text(), nullable=False),
        sa.Column("openai_api_key_encrypted", sa.Text(), nullable=False),
        sa.Column("updated_at", sa.String(length=40), nullable=False),
        sa.PrimaryKeyConstraint("workspace_id"),
    )

    op.create_table(
        "outbound_calls",
        sa.Column("id", sa.String(length=80), nullable=False),
        sa.Column("token", sa.String(length=64), nullable=False),
        sa.Column("agent_id", sa.String(length=200), nullable=False),
        sa.Column("deployment_id", sa.String(length=80), nullable=False),
        sa.Column("from_number", sa.String(length=24), nullable=False),
        sa.Column("to_number", sa.String(length=24), nullable=False),
        sa.Column("contact_id", sa.String(length=200)),
        sa.Column("contact_name", sa.String(length=300)),
        sa.Column("contact_photo_data_url", sa.Text()),
        sa.Column("call_sid", sa.String(length=80)),
        sa.Column("status", sa.String(length=40), nullable=False),
        sa.Column("created_at", sa.String(length=40), nullable=False),
        sa.Column("started_at", sa.String(length=40)),
        sa.Column("completed_at", sa.String(length=40)),
        sa.Column("duration_ms", sa.Integer()),
        sa.Column("turn_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column("latency_ms", sa.Integer()),
        sa.Column("execution_path_json", json_document),
        sa.Column("transcript_json", json_document),
        sa.Column("state_json", json_document),
        sa.Column("trace_json", json_document),
        sa.Column("flow_completed", sa.Boolean()),
        sa.ForeignKeyConstraint(["deployment_id"], ["deployments.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token"),
    )
    op.create_index("idx_outbound_calls_deployment", "outbound_calls", ["deployment_id"])
    op.create_index("idx_outbound_calls_contact", "outbound_calls", ["contact_id", "created_at"])

    op.create_table(
        "research_reports",
        sa.Column("id", sa.String(length=80), nullable=False),
        sa.Column("call_id", sa.String(length=80), nullable=False),
        sa.Column("workspace_id", sa.String(length=200), nullable=False),
        sa.Column("contact_id", sa.String(length=200)),
        sa.Column("status", sa.String(length=40), nullable=False),
        sa.Column("model", sa.String(length=200), nullable=False),
        sa.Column("report_json", json_document),
        sa.Column("error", sa.Text()),
        sa.Column("created_at", sa.String(length=40), nullable=False),
        sa.Column("updated_at", sa.String(length=40), nullable=False),
        sa.ForeignKeyConstraint(["call_id"], ["outbound_calls.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("call_id"),
    )
    op.create_index("idx_research_reports_workspace", "research_reports", ["workspace_id", "updated_at"])
    op.create_index("idx_research_reports_contact", "research_reports", ["contact_id", "updated_at"])


def downgrade() -> None:
    op.drop_index("idx_research_reports_contact", table_name="research_reports")
    op.drop_index("idx_research_reports_workspace", table_name="research_reports")
    op.drop_table("research_reports")
    op.drop_index("idx_outbound_calls_contact", table_name="outbound_calls")
    op.drop_index("idx_outbound_calls_deployment", table_name="outbound_calls")
    op.drop_table("outbound_calls")
    op.drop_table("workspace_settings")
    op.drop_index("idx_deployments_active", table_name="deployments")
    op.drop_table("deployments")
