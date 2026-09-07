from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv


@dataclass(frozen=True, slots=True)
class ResearchSettings:
    database_url: str
    secret_encryption_key: str = "local-development-only-change-me"
    model: str = "gpt-5.6-terra"
    cors_origins: tuple[str, ...] = (
        "http://localhost:4173",
        "http://127.0.0.1:4173",
    )

    @classmethod
    def from_env(cls) -> "ResearchSettings":
        project_root = Path(__file__).resolve().parents[4]
        # Runtime and Research intentionally share one repository-level environment
        # so both services use the same database and encryption key locally.
        load_dotenv(project_root / ".env", override=False)
        return cls(
            database_url=os.getenv(
                "DATABASE_URL",
                "postgresql+psycopg://voice_agent_studio:local-voice-agent-studio-password@localhost:5432/voice_agent_studio",
            ),
            secret_encryption_key=os.getenv("RUNTIME_SECRET_KEY", "local-development-only-change-me"),
            model=os.getenv("RESEARCH_MODEL", "gpt-5.6-terra"),
            cors_origins=tuple(
                origin.strip()
                for origin in os.getenv(
                    "STUDIO_ORIGINS",
                    "http://localhost:4173,http://127.0.0.1:4173",
                ).split(",")
                if origin.strip()
            ),
        )
