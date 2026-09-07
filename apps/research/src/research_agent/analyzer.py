from __future__ import annotations

import json
from typing import Any, Protocol

from openai import AsyncOpenAI

from .models import AssessmentResult

ANALYSIS_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "summary": {"type": "string"},
        "data_quality": {"type": "string", "enum": ["sufficient", "limited"]},
        "evidence": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "domain": {
                        "type": "string",
                        "enum": [
                            "mood",
                            "anxiety",
                            "social_connection",
                            "daily_life",
                            "protective_factor",
                        ],
                    },
                    "finding": {"type": "string"},
                    "quote": {"type": "string"},
                    "turn_id": {"type": "string"},
                },
                "required": ["domain", "finding", "quote", "turn_id"],
            },
        },
        "strengths": {"type": "array", "items": {"type": "string"}},
        "concerns": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["summary", "data_quality", "evidence", "strengths", "concerns"],
}


class ReportAnalyzer(Protocol):
    async def analyze(
        self,
        *,
        transcript: dict[str, Any],
        assessments: list[AssessmentResult],
        contact_name: str,
        endpoint: str,
        api_key: str,
        model: str,
    ) -> tuple[dict[str, Any], str]: ...


def _transcript_lines(transcript: dict[str, Any]) -> list[str]:
    lines: list[str] = []
    for index, turn in enumerate(transcript.get("turns", [])):
        if not isinstance(turn, dict):
            continue
        speaker = str(turn.get("speaker", "unknown"))
        text = str(turn.get("raw_text") or turn.get("text") or "").strip()
        if not text:
            continue
        turn_id = str(turn.get("id") or turn.get("turn_id") or f"turn_{index + 1}")
        lines.append(f"[{turn_id}] {speaker}: {text}")
    return lines


def _ground_evidence(payload: dict[str, Any], transcript: dict[str, Any]) -> dict[str, Any]:
    turn_text: dict[str, str] = {}
    for index, turn in enumerate(transcript.get("turns", [])):
        if not isinstance(turn, dict):
            continue
        turn_id = str(turn.get("id") or turn.get("turn_id") or f"turn_{index + 1}")
        turn_text[turn_id] = str(turn.get("raw_text") or turn.get("text") or "")
    grounded = []
    for evidence in payload.get("evidence", []):
        if not isinstance(evidence, dict):
            continue
        quote = str(evidence.get("quote", "")).strip()
        source = turn_text.get(str(evidence.get("turn_id", "")), "")
        if quote and quote in source:
            grounded.append(evidence)
    return {**payload, "evidence": grounded}


def deterministic_fallback(
    assessments: list[AssessmentResult],
    *,
    reason: str | None = None,
) -> dict[str, Any]:
    completed = [item for item in assessments if item.complete]
    if completed:
        summary = "완료된 선별검사 결과를 기준으로 정신건강 상태를 요약했습니다."
    else:
        summary = "완료된 선별검사가 없어 대화 근거를 충분히 분석하기 어렵습니다."
    concerns = []
    for item in completed:
        if item.classification in {
            "further_assessment_needed",
            "moderate_depression",
            "moderately_severe_depression",
            "severe_depression",
            "moderate_anxiety",
            "severe_anxiety",
            "social_isolation_risk",
        }:
            concerns.append(f"{item.form}: {item.classification.replace('_', ' ')}")
    if reason:
        concerns.append("Model narrative was unavailable; deterministic results only.")
    return {
        "summary": summary,
        "data_quality": "sufficient" if completed else "limited",
        "evidence": [],
        "strengths": [],
        "concerns": concerns,
    }


class OpenAIReportAnalyzer:
    async def analyze(
        self,
        *,
        transcript: dict[str, Any],
        assessments: list[AssessmentResult],
        contact_name: str,
        endpoint: str,
        api_key: str,
        model: str,
    ) -> tuple[dict[str, Any], str]:
        if not api_key:
            return deterministic_fallback(assessments, reason="missing_api_key"), "deterministic_fallback"
        client_options: dict[str, Any] = {"api_key": api_key}
        normalized_endpoint = endpoint.rstrip("/")
        if normalized_endpoint and normalized_endpoint != "https://api.openai.com/v1":
            client_options["base_url"] = normalized_endpoint
        client = AsyncOpenAI(**client_options)
        prompt = {
            "contact_name": contact_name,
            "deterministic_assessments": [item.model_dump() for item in assessments],
            "transcript": _transcript_lines(transcript),
        }
        instructions = """당신은 노년층 안부전화 기록을 검토하는 정신건강 리서치 분석가입니다.
진단을 내리지 말고, 제공된 통화 내용에서 직접 확인되는 사실만 한국어로 요약하세요.
척도 점수와 판정은 입력된 deterministic_assessments를 그대로 사용하고 직접 재계산하거나 변경하지 마세요.
근거에는 반드시 transcript에 실제로 존재하는 짧은 직접 인용과 turn_id를 사용하세요.
추측, 인과관계 단정, 지역기관 안내, 응급 연계 정책, 약물·치료 지시는 작성하지 마세요.
강점과 우려는 대화에서 근거가 있을 때만 작성하고, 근거가 부족하면 빈 배열을 반환하세요."""
        try:
            response = await client.responses.create(
                model=model,
                instructions=instructions,
                input=json.dumps(prompt, ensure_ascii=False),
                store=False,
                text={
                    "format": {
                        "type": "json_schema",
                        "name": "on_call_research_analysis",
                        "strict": True,
                        "schema": ANALYSIS_SCHEMA,
                    }
                },
            )
            return _ground_evidence(json.loads(response.output_text), transcript), "model"
        except Exception:
            return deterministic_fallback(assessments, reason="model_request_failed"), "deterministic_fallback"
