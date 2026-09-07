from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from voice_agent_runtime.config import RuntimeSettings
from voice_agent_runtime.repository import RuntimeRepository


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Import a Voice Agent Studio workspace JSON backup into PostgreSQL.",
    )
    parser.add_argument("--file", required=True, type=Path)
    parser.add_argument(
        "--database-url",
        help="PostgreSQL SQLAlchemy URL. Defaults to the repository-level .env.",
    )
    return parser.parse_args()


def load_documents(path: Path) -> list[dict[str, Any]]:
    payload = json.loads(path.expanduser().read_text(encoding="utf-8"))
    if not isinstance(payload, list):
        raise ValueError("Workspace backup must contain a JSON array.")
    documents: list[dict[str, Any]] = []
    for index, item in enumerate(payload):
        if not isinstance(item, dict):
            raise ValueError(f"Workspace at index {index} must be an object.")
        workspace_id = item.get("id")
        if not isinstance(workspace_id, str) or not workspace_id.strip():
            raise ValueError(f"Workspace at index {index} has no valid id.")
        documents.append(item)
    return documents


def main() -> None:
    args = parse_args()
    settings = RuntimeSettings.from_env()
    repository = RuntimeRepository(args.database_url or settings.database_url)
    documents = load_documents(args.file)
    for document in documents:
        workspace_id = str(document["id"])
        repository.save_workspace_document(workspace_id, document)
        print(f"Imported {workspace_id}")
    print(f"Imported {len(documents)} workspace document(s).")


if __name__ == "__main__":
    main()
