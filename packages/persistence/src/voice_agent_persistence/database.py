from __future__ import annotations

from sqlalchemy import Engine, create_engine


def normalize_database_url(database_url: str) -> str:
    value = database_url.strip()
    if not value:
        raise ValueError("DATABASE_URL must not be empty")
    if value.startswith("postgresql://"):
        return value.replace("postgresql://", "postgresql+psycopg://", 1)
    if not value.startswith("postgresql+psycopg://"):
        raise ValueError("DATABASE_URL must use PostgreSQL with the psycopg driver")
    return value


def create_database_engine(database_url: str) -> Engine:
    return create_engine(
        normalize_database_url(database_url),
        pool_pre_ping=True,
        pool_size=5,
        max_overflow=5,
        pool_recycle=1_800,
    )
