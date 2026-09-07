from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class DeploymentBundle(BaseModel):
    model_config = ConfigDict(extra="forbid")

    workspace_id: str = Field(min_length=1)
    flow_spec: dict[str, Any]
    tools: list[dict[str, Any]] = Field(default_factory=list)
    functions: list[dict[str, Any]] = Field(default_factory=list)
    state_schema: dict[str, Any] | None = None
    data_assets: list[dict[str, Any]] = Field(default_factory=list)


class DeploymentRecord(BaseModel):
    id: str
    workspace_id: str
    agent_id: str
    agent_name: str
    version: int
    active: bool
    created_at: str


class WorkspaceDocumentPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    document: dict[str, Any]


class WorkspaceDocumentRecord(BaseModel):
    workspace_id: str
    document: dict[str, Any]
    updated_at: str


class OutboundCallRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    agent_id: str = Field(min_length=1)
    to_number: str = Field(min_length=8, max_length=24)
    contact_id: str | None = Field(default=None, max_length=200)
    contact_name: str | None = Field(default=None, max_length=200)
    contact_photo_data_url: str | None = Field(default=None, max_length=1_000_000)


class OutboundCallResponse(BaseModel):
    id: str
    call_sid: str | None
    status: str
    agent_id: str
    deployment_id: str
    from_number: str
    to_number: str
    created_at: str


class CallRecordSummary(BaseModel):
    id: str
    workspace_id: str
    agent_id: str
    agent_name: str
    deployment_id: str
    from_number: str
    to_number: str
    contact_id: str | None
    contact_name: str | None
    contact_photo_data_url: str | None
    call_sid: str | None
    status: str
    created_at: str
    started_at: str | None
    completed_at: str | None
    duration_ms: int | None
    turns: int
    latency_ms: int | None
    review: Literal["safety", "declined", "incomplete"] | None
    path: list[str]
    has_transcript: bool
    has_state: bool


class WorkspaceConnections(BaseModel):
    model_config = ConfigDict(extra="forbid")

    publicUrl: str
    telephonyIntegration: Literal["media_streams", "sip"]


class WorkspaceEnvironmentVariables(BaseModel):
    model_config = ConfigDict(extra="forbid")

    twilioAccountSid: str
    twilioAuthToken: str
    twilioPhoneNumber: str
    openaiEndpoint: str
    openaiApiKey: str


class WorkspaceSettingsPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    connections: WorkspaceConnections
    environmentVariables: WorkspaceEnvironmentVariables


class WorkspaceSettingsStatus(BaseModel):
    workspace_id: str
    public_url: str
    telephony_integration: Literal["media_streams", "sip"]
    twilio_account_sid: str
    twilio_phone_number: str
    openai_endpoint: str
    twilio_auth_token_configured: bool
    openai_api_key_configured: bool
    updated_at: str


class WorkspaceRuntimeCredentials(BaseModel):
    workspace_id: str
    public_url: str
    telephony_integration: Literal["media_streams", "sip"]
    twilio_account_sid: str
    twilio_auth_token: str
    twilio_phone_number: str
    openai_endpoint: str
    openai_api_key: str
    updated_at: str
