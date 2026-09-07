from __future__ import annotations

from typing import Any, Callable

import uvicorn
from fastapi import FastAPI, HTTPException, Query, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.exc import IntegrityError

from .config import RuntimeSettings
from .live_events import RuntimeEventStream, create_live_events_router
from .models import (
    DeploymentBundle,
    DeploymentRecord,
    WorkspaceDocumentPayload,
    WorkspaceDocumentRecord,
    WorkspaceSettingsPayload,
    WorkspaceSettingsStatus,
)
from .repository import RuntimeRepository
from .telephony import create_telephony_router
from .validation import DeploymentValidationError, validate_bundle


def create_app(
    *,
    settings: RuntimeSettings | None = None,
    repository: RuntimeRepository | None = None,
    twilio_client_factory: Callable[[str, str], Any] | None = None,
) -> FastAPI:
    runtime_settings = settings or RuntimeSettings.from_env()
    runtime_repository = repository or RuntimeRepository(
        runtime_settings.database_url,
        runtime_settings.secret_encryption_key,
    )
    app = FastAPI(title="Voice Agent Studio Runtime", version="0.1.0")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(runtime_settings.cors_origins),
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.state.settings = runtime_settings
    app.state.repository = runtime_repository
    app.state.event_stream = RuntimeEventStream()

    @app.get("/api/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/api/workspaces", response_model=list[WorkspaceDocumentRecord])
    async def list_workspaces() -> list[WorkspaceDocumentRecord]:
        return runtime_repository.list_workspace_documents()

    @app.get(
        "/api/workspaces/{workspace_id}",
        response_model=WorkspaceDocumentRecord,
    )
    async def get_workspace(workspace_id: str) -> WorkspaceDocumentRecord:
        record = runtime_repository.get_workspace_document(workspace_id)
        if record is None:
            raise HTTPException(status_code=404, detail="Workspace not found.")
        return record

    @app.put(
        "/api/workspaces/{workspace_id}",
        response_model=WorkspaceDocumentRecord,
    )
    async def save_workspace(
        workspace_id: str,
        payload: WorkspaceDocumentPayload,
    ) -> WorkspaceDocumentRecord:
        document_id = payload.document.get("id")
        if document_id is not None and document_id != workspace_id:
            raise HTTPException(
                status_code=422,
                detail="Workspace document id does not match the request path.",
            )
        return runtime_repository.save_workspace_document(
            workspace_id,
            payload.document,
        )

    @app.delete(
        "/api/workspaces/{workspace_id}",
        status_code=status.HTTP_204_NO_CONTENT,
    )
    async def delete_workspace(workspace_id: str) -> None:
        if not runtime_repository.delete_workspace_document(workspace_id):
            raise HTTPException(status_code=404, detail="Workspace not found.")

    @app.put(
        "/api/workspaces/{workspace_id}/settings",
        response_model=WorkspaceSettingsStatus,
    )
    async def save_workspace_settings(
        workspace_id: str,
        payload: WorkspaceSettingsPayload,
    ) -> WorkspaceSettingsStatus:
        return runtime_repository.save_workspace_settings(workspace_id, payload)

    @app.post(
        "/api/deployments",
        response_model=DeploymentRecord,
        status_code=status.HTTP_201_CREATED,
    )
    async def deploy(bundle: DeploymentBundle) -> DeploymentRecord:
        try:
            validate_bundle(
                bundle,
                allow_code_actions=runtime_settings.allow_unsafe_code_actions,
            )
            return runtime_repository.deploy(bundle)
        except DeploymentValidationError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        except IntegrityError as exc:
            raise HTTPException(
                status_code=409,
                detail="This agent version has already been deployed.",
            ) from exc

    @app.get("/api/deployments", response_model=list[DeploymentRecord])
    async def deployments(workspace_id: str | None = Query(default=None)) -> list[DeploymentRecord]:
        return runtime_repository.list_active_deployments(workspace_id)

    telephony_kwargs = {}
    if twilio_client_factory is not None:
        telephony_kwargs["twilio_client_factory"] = twilio_client_factory
    app.include_router(
        create_telephony_router(runtime_repository, runtime_settings, **telephony_kwargs),
        prefix="/api",
    )
    app.include_router(create_live_events_router(app.state.event_stream), prefix="/api")
    return app


app = create_app()


def run() -> None:
    uvicorn.run("voice_agent_runtime.main:app", host="0.0.0.0", port=8080, reload=False)
