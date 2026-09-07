from __future__ import annotations

from pathlib import Path

from sqlalchemy import Engine, create_engine, event


def create_sqlite_test_engine(database_path: Path) -> Engine:
    """Create an isolated SQLite engine for unit tests only."""

    engine = create_engine(
        f"sqlite+pysqlite:///{database_path.expanduser().resolve()}",
        connect_args={"check_same_thread": False},
    )

    @event.listens_for(engine, "connect")
    def enable_foreign_keys(dbapi_connection, _connection_record) -> None:
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys = ON")
        cursor.close()

    return engine
