from __future__ import annotations

from typing import Any, TypedDict

from langgraph.graph import END, START, StateGraph

from .analyzer import ReportAnalyzer
from .models import AssessmentResult, LongitudinalChange, ReportEvidence, ResearchReport
from .repository import ResearchRepository, utc_now
from .scoring import report_priority, score_assessments


class GraphState(TypedDict, total=False):
    call_id: str
    report_id: str
    call: dict[str, Any]
    assessments: list[AssessmentResult]
    longitudinal: list[dict[str, Any]]
    narrative: dict[str, Any]
    analysis_mode: str
    report: ResearchReport


def build_research_graph(
    repository: ResearchRepository,
    analyzer: ReportAnalyzer,
    model: str,
):
    async def load_call(state: GraphState) -> GraphState:
        call = repository.get_call_context(state["call_id"])
        if call is None:
            raise ValueError("Call record not found.")
        if not call["eligible"]:
            raise ValueError("Only completed calls without review flags can be analyzed.")
        return {"call": call}

    async def calculate_scores(state: GraphState) -> GraphState:
        call = state["call"]
        return {"assessments": score_assessments(call["state"], call["bundle"])}

    async def compare_history(state: GraphState) -> GraphState:
        call = state["call"]
        return {
            "longitudinal": repository.longitudinal_changes(
                call.get("contact_id"),
                call.get("started_at") or call["created_at"],
                state["assessments"],
            )
        }

    async def analyze_transcript(state: GraphState) -> GraphState:
        call = state["call"]
        credentials = repository.get_openai_credentials(call["workspace_id"])
        endpoint, api_key = credentials or ("https://api.openai.com/v1", "")
        narrative, mode = await analyzer.analyze(
            transcript=call["transcript"],
            assessments=state["assessments"],
            contact_name=call.get("contact_name") or "Unknown Contact",
            endpoint=endpoint,
            api_key=api_key,
            model=model,
        )
        return {"narrative": narrative, "analysis_mode": mode}

    async def compose_report(state: GraphState) -> GraphState:
        call = state["call"]
        narrative = state["narrative"]
        report = ResearchReport(
            id=state["report_id"],
            call_id=call["id"],
            call_sid=call.get("call_sid"),
            workspace_id=call["workspace_id"],
            agent_id=call["agent_id"],
            agent_name=call["agent_name"],
            contact_id=call.get("contact_id"),
            contact_name=call.get("contact_name") or "Unknown Contact",
            contact_photo_data_url=call.get("contact_photo_data_url"),
            to_number=call["to_number"],
            call_started_at=call.get("started_at") or call.get("created_at"),
            generated_at=utc_now(),
            model=model,
            analysis_mode=state["analysis_mode"],
            priority=report_priority(state["assessments"]),
            summary=str(narrative.get("summary", "")),
            data_quality=narrative.get("data_quality", "limited"),
            assessments=state["assessments"],
            evidence=[ReportEvidence.model_validate(item) for item in narrative.get("evidence", [])],
            strengths=[str(item) for item in narrative.get("strengths", [])],
            concerns=[str(item) for item in narrative.get("concerns", [])],
            longitudinal=[LongitudinalChange.model_validate(item) for item in state["longitudinal"]],
            disclaimer="This report supports research review and is not a diagnosis or a substitute for clinical assessment.",
        )
        return {"report": report}

    graph = StateGraph(GraphState)
    graph.add_node("load_call", load_call)
    graph.add_node("calculate_scores", calculate_scores)
    graph.add_node("compare_history", compare_history)
    graph.add_node("analyze_transcript", analyze_transcript)
    graph.add_node("compose_report", compose_report)
    graph.add_edge(START, "load_call")
    graph.add_edge("load_call", "calculate_scores")
    graph.add_edge("calculate_scores", "compare_history")
    graph.add_edge("compare_history", "analyze_transcript")
    graph.add_edge("analyze_transcript", "compose_report")
    graph.add_edge("compose_report", END)
    return graph.compile()
