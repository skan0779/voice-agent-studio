from __future__ import annotations

import uvicorn
from fastapi import BackgroundTasks, FastAPI, HTTPException, Query, status
from fastapi.middleware.cors import CORSMiddleware

from .analyzer import OpenAIReportAnalyzer, ReportAnalyzer
from .config import ResearchSettings
from .events import ResearchEventStream, create_report_events_router
from .graph import build_research_graph
from .models import AnalyzePendingResponse, AnalyzeResponse, ReportListItem, ResearchReport
from .repository import ResearchRepository


def create_app(
    *,
    settings: ResearchSettings | None = None,
    repository: ResearchRepository | None = None,
    analyzer: ReportAnalyzer | None = None,
    event_stream: ResearchEventStream | None = None,
) -> FastAPI:
    research_settings = settings or ResearchSettings.from_env()
    research_repository = repository or ResearchRepository(
        research_settings.database_url,
        research_settings.secret_encryption_key,
    )
    report_analyzer = analyzer or OpenAIReportAnalyzer()
    graph = build_research_graph(research_repository, report_analyzer, research_settings.model)
    report_events = event_stream or ResearchEventStream()
    app = FastAPI(title="Voice Agent Research", version="0.1.0")
    app.state.event_stream = report_events
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(research_settings.cors_origins),
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    async def execute(call_id: str, report_id: str, workspace_id: str) -> None:
        research_repository.mark_running(report_id)
        report_events.emit(
            "report_running",
            {"workspace_id": workspace_id, "call_id": call_id, "report_id": report_id, "status": "running"},
        )
        try:
            result = await graph.ainvoke({"call_id": call_id, "report_id": report_id})
            research_repository.save_report(result["report"])
            report_events.emit(
                "report_completed",
                {"workspace_id": workspace_id, "call_id": call_id, "report_id": report_id, "status": "completed"},
            )
        except Exception as exc:
            research_repository.fail_report(report_id, str(exc))
            report_events.emit(
                "report_failed",
                {
                    "workspace_id": workspace_id,
                    "call_id": call_id,
                    "report_id": report_id,
                    "status": "failed",
                    "error": str(exc)[:1000],
                },
            )

    @app.get("/api/health")
    async def health() -> dict[str, str]:
        return {"status": "ok", "model": research_settings.model}

    @app.get("/api/reports", response_model=list[ReportListItem])
    async def reports(workspace_id: str = Query(min_length=1)) -> list[ReportListItem]:
        return research_repository.list_candidates(workspace_id)

    @app.get("/api/reports/{report_id}", response_model=ResearchReport)
    async def report(report_id: str) -> ResearchReport:
        result = research_repository.get_report(report_id)
        if result is None:
            raise HTTPException(status_code=404, detail="Completed report not found.")
        return result

    @app.post(
        "/api/reports/analyze/{call_id}",
        response_model=AnalyzeResponse,
        status_code=status.HTTP_202_ACCEPTED,
    )
    async def analyze(
        call_id: str,
        background_tasks: BackgroundTasks,
        force: bool = Query(default=False),
    ) -> AnalyzeResponse:
        call = research_repository.get_call_context(call_id)
        if call is None:
            raise HTTPException(status_code=404, detail="Call record not found.")
        if not call["eligible"]:
            raise HTTPException(
                status_code=409,
                detail="Only completed calls without review flags can be analyzed.",
            )
        report_id, reservation_status = research_repository.reserve_report(call, research_settings.model, force=force)
        if reservation_status == "already_completed":
            return AnalyzeResponse(call_id=call_id, status="already_completed")
        workspace_id = str(call["workspace_id"])
        report_events.emit(
            "report_queued",
            {"workspace_id": workspace_id, "call_id": call_id, "report_id": report_id, "status": "queued"},
        )
        background_tasks.add_task(execute, call_id, report_id, workspace_id)
        return AnalyzeResponse(call_id=call_id, status="queued")

    @app.post(
        "/api/reports/analyze-pending",
        response_model=AnalyzePendingResponse,
        status_code=status.HTTP_202_ACCEPTED,
    )
    async def analyze_pending(
        background_tasks: BackgroundTasks,
        workspace_id: str = Query(min_length=1),
    ) -> AnalyzePendingResponse:
        queued = 0
        for candidate in research_repository.list_candidates(workspace_id):
            if candidate.status not in {"not_started", "failed"}:
                continue
            call = research_repository.get_call_context(candidate.call_id)
            if call is None:
                continue
            report_id, reservation_status = research_repository.reserve_report(
                call, research_settings.model, force=candidate.status == "failed"
            )
            if reservation_status == "queued":
                report_events.emit(
                    "report_queued",
                    {
                        "workspace_id": workspace_id,
                        "call_id": candidate.call_id,
                        "report_id": report_id,
                        "status": "queued",
                    },
                )
                background_tasks.add_task(execute, candidate.call_id, report_id, workspace_id)
                queued += 1
        return AnalyzePendingResponse(queued=queued)

    app.include_router(create_report_events_router(report_events), prefix="/api")
    return app


app = create_app()


def run() -> None:
    uvicorn.run("research_agent.main:app", host="0.0.0.0", port=8081, reload=False)
