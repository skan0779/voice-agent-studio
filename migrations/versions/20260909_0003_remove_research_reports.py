"""Remove the domain-specific research reports table.

Revision ID: 20260909_0003
Revises: 20260904_0002
Create Date: 2026-09-09
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "20260909_0003"
down_revision = "20260904_0002"
branch_labels = None
depends_on = None


json_document = sa.JSON().with_variant(postgresql.JSONB(), "postgresql")


def upgrade() -> None:
    op.drop_index("idx_research_reports_contact", table_name="research_reports")
    op.drop_index("idx_research_reports_workspace", table_name="research_reports")
    op.drop_table("research_reports")


def downgrade() -> None:
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
