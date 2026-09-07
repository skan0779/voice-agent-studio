from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class AssessmentAnswer(BaseModel):
    item_id: str
    prompt: str
    response_id: str
    response_label: str
    score: int | float


class AssessmentResult(BaseModel):
    key: str
    title: str
    form: str
    score: int | float
    maximum: int | float
    classification: str
    complete: bool
    answered_count: int
    required_count: int
    answers: list[AssessmentAnswer]
    domain_scores: dict[str, int | float] = Field(default_factory=dict)


class ReportEvidence(BaseModel):
    domain: Literal["mood", "anxiety", "social_connection", "daily_life", "protective_factor"]
    finding: str
    quote: str
    turn_id: str


class LongitudinalChange(BaseModel):
    assessment_key: str
    form: str
    previous_score: int | float
    current_score: int | float
    delta: int | float
    direction: Literal["improved", "stable", "worsened"]
    previous_call_id: str


class ResearchReport(BaseModel):
    id: str
    call_id: str
    call_sid: str | None
    workspace_id: str
    agent_id: str
    agent_name: str
    contact_id: str | None
    contact_name: str
    contact_photo_data_url: str | None
    to_number: str
    call_started_at: str | None
    generated_at: str
    model: str
    analysis_mode: Literal["model", "deterministic_fallback"]
    priority: Literal["low", "monitor", "review"]
    summary: str
    data_quality: Literal["sufficient", "limited"]
    assessments: list[AssessmentResult]
    evidence: list[ReportEvidence]
    strengths: list[str]
    concerns: list[str]
    longitudinal: list[LongitudinalChange]
    disclaimer: str


class ReportListItem(BaseModel):
    id: str | None
    call_id: str
    call_sid: str | None
    workspace_id: str
    agent_id: str
    agent_name: str
    contact_id: str | None
    contact_name: str
    contact_photo_data_url: str | None
    to_number: str
    call_started_at: str | None
    status: Literal["not_started", "queued", "running", "completed", "failed"]
    generated_at: str | None
    priority: Literal["low", "monitor", "review"] | None
    summary: str | None
    assessments: list[AssessmentResult]
    error: str | None


class AnalyzeResponse(BaseModel):
    call_id: str
    status: Literal["queued", "already_completed"]


class AnalyzePendingResponse(BaseModel):
    queued: int


ResearchState = dict[str, Any]
