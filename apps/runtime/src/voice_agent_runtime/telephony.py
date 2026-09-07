from __future__ import annotations

import asyncio
import json
from typing import Any, Callable
from urllib.parse import quote
from urllib.request import Request as UrlRequest
from urllib.request import urlopen
from xml.sax.saxutils import quoteattr

from fastapi import APIRouter, HTTPException, Request, WebSocket, WebSocketDisconnect, status
from fastapi.responses import Response
from starlette.websockets import WebSocketState
from twilio.http.http_client import TwilioHttpClient
from twilio.rest import Client as TwilioClient

from .config import RuntimeSettings
from .live_events import ScopedRuntimeEventStream
from .models import CallRecordSummary, OutboundCallRequest, OutboundCallResponse
from .orchestrator import FlowOrchestrator
from .phone_number import InvalidPhoneNumberError, normalize_phone_number
from .realtime_gateway import RealtimeGateway
from .realtime_session import RealtimeSession
from .repository import RuntimeRepository


def _default_twilio_client(account_sid: str, auth_token: str) -> TwilioClient:
    # The Twilio SDK otherwise waits indefinitely when the local network or
    # DNS path stalls, which leaves the Studio's Start Call action spinning.
    return TwilioClient(
        account_sid,
        auth_token,
        http_client=TwilioHttpClient(timeout=10),
    )


def _stream_twiml(public_url: str, token: str, deployment_id: str) -> str:
    websocket_url = public_url.replace("https://", "wss://", 1).replace("http://", "ws://", 1)
    websocket_url = f"{websocket_url}/api/twilio/media/{quote(token)}"
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url={quoteattr(websocket_url)}>
      <Parameter name="call_token" value={quoteattr(token)} />
      <Parameter name="deployment_id" value={quoteattr(deployment_id)} />
    </Stream>
  </Connect>
</Response>
"""


async def _request_post_call_analysis(research_agent_url: str, call_id: str) -> None:
    request = UrlRequest(
        f"{research_agent_url}/api/reports/analyze/{quote(call_id)}",
        data=b"",
        method="POST",
    )
    try:

        def send() -> None:
            with urlopen(request, timeout=3) as response:
                response.read()

        await asyncio.to_thread(send)
    except Exception as exc:
        # Research analysis is best-effort and must never affect call cleanup.
        print(f"[Research agent trigger error] {type(exc).__name__}: {exc}")


def create_telephony_router(
    repository: RuntimeRepository,
    settings: RuntimeSettings,
    *,
    twilio_client_factory: Callable[[str, str], Any] = _default_twilio_client,
) -> APIRouter:
    router = APIRouter()
    research_tasks: set[asyncio.Task[None]] = set()

    @router.get("/call-records", response_model=list[CallRecordSummary])
    async def list_call_records(workspace_id: str) -> list[CallRecordSummary]:
        return repository.list_call_records(workspace_id)

    @router.get("/call-records/{call_id}/{artifact}")
    async def get_call_artifact(call_id: str, artifact: str) -> dict[str, Any]:
        if artifact not in {"transcript", "state"}:
            raise HTTPException(status_code=404, detail="Unknown call artifact.")
        payload = repository.get_call_artifact(call_id, artifact)
        if payload is None:
            raise HTTPException(
                status_code=404,
                detail=f"This call does not have a saved {artifact} artifact.",
            )
        return payload

    @router.delete("/call-records/{call_id}", status_code=status.HTTP_204_NO_CONTENT)
    async def delete_call_record(call_id: str) -> Response:
        if not repository.delete_call_record(call_id):
            raise HTTPException(status_code=404, detail="Call record not found.")
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    @router.post(
        "/outbound-calls",
        response_model=OutboundCallResponse,
        status_code=status.HTTP_201_CREATED,
    )
    async def start_outbound_call(request: OutboundCallRequest) -> OutboundCallResponse:
        deployment = repository.get_active_bundle(request.agent_id)
        if deployment is None:
            raise HTTPException(status_code=404, detail="No active deployment exists for this agent.")
        deployment_record, _ = deployment
        workspace_settings = repository.get_workspace_settings(deployment_record.workspace_id)
        if workspace_settings is None:
            raise HTTPException(
                status_code=409,
                detail="Save this Workspace's Settings before starting a call.",
            )
        if workspace_settings.telephony_integration != "media_streams":
            raise HTTPException(status_code=409, detail="Only Twilio Media Streams is currently supported.")
        if not all(
            (
                workspace_settings.twilio_account_sid,
                workspace_settings.twilio_auth_token,
                workspace_settings.twilio_phone_number,
                workspace_settings.openai_api_key,
                workspace_settings.public_url,
            )
        ):
            raise HTTPException(
                status_code=503,
                detail="Twilio credentials, TWILIO_PHONE_NUMBER, OpenAI, and PUBLIC_URL Workspace settings are required.",
            )
        try:
            from_number = normalize_phone_number(workspace_settings.twilio_phone_number)
            to_number = normalize_phone_number(request.to_number)
        except InvalidPhoneNumberError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

        token, call_record = repository.create_call(
            agent_id=request.agent_id,
            deployment_id=deployment_record.id,
            from_number=from_number,
            to_number=to_number,
            contact_id=request.contact_id,
            contact_name=request.contact_name,
            contact_photo_data_url=request.contact_photo_data_url,
        )
        twiml = _stream_twiml(
            workspace_settings.public_url,
            token,
            deployment_record.id,
        )

        try:
            client = twilio_client_factory(
                workspace_settings.twilio_account_sid,
                workspace_settings.twilio_auth_token,
            )
            twilio_call = await asyncio.to_thread(
                client.calls.create,
                to=to_number,
                from_=from_number,
                twiml=twiml,
            )
        except Exception as exc:
            repository.update_call(call_record.id, status="failed")
            raise HTTPException(status_code=502, detail="Twilio rejected the outbound call request.") from exc

        call_sid = getattr(twilio_call, "sid", None)
        call_status = getattr(twilio_call, "status", None) or "queued"
        repository.update_call(call_record.id, status=call_status, call_sid=call_sid)
        return call_record.model_copy(update={"call_sid": call_sid, "status": call_status})

    @router.api_route("/twilio/voice/{token}", methods=["GET", "POST"])
    async def twilio_voice(token: str, request: Request) -> Response:
        del request
        call = repository.get_call_by_token(token)
        if call is None:
            return Response(content="Unknown call", status_code=404, media_type="text/plain")
        bundle = repository.get_bundle(call["deployment_id"])
        if bundle is None:
            return Response(content="Deployment not found", status_code=404, media_type="text/plain")
        workspace_settings = repository.get_workspace_settings(bundle.workspace_id)
        if workspace_settings is None:
            return Response(content="Workspace Settings not found", status_code=409, media_type="text/plain")
        xml = _stream_twiml(workspace_settings.public_url, token, call["deployment_id"])
        return Response(content=xml, media_type="text/xml")

    @router.websocket("/twilio/media/{token}")
    async def twilio_media_stream(websocket: WebSocket, token: str) -> None:
        call = repository.get_call_by_token(token)
        if call is None:
            await websocket.close(code=1008, reason="Unknown call")
            return
        bundle = repository.get_bundle(call["deployment_id"])
        if bundle is None:
            await websocket.close(code=1011, reason="Deployment not found")
            return
        workspace_settings = repository.get_workspace_settings(bundle.workspace_id)
        if workspace_settings is None or not workspace_settings.openai_api_key:
            await websocket.close(code=1011, reason="Workspace OpenAI Settings not found")
            return

        await websocket.accept()
        event_stream = getattr(websocket.app.state, "event_stream", None)
        scoped_event_stream = (
            ScopedRuntimeEventStream(
                event_stream,
                {
                    "runtime_call_id": call["id"],
                    "runtime_workspace_id": bundle.workspace_id,
                    "runtime_agent_id": call["agent_id"],
                    "runtime_agent_name": bundle.flow_spec.get("name", call["agent_id"]),
                    "runtime_contact_name": call.get("contact_name"),
                    "runtime_to_number": call["to_number"],
                },
            )
            if event_stream is not None
            else None
        )
        initial_input_gate_ms = int(bundle.flow_spec.get("start", {}).get("initial_input_gate_ms", 0))

        def orchestrator_factory(session, stream):
            return FlowOrchestrator(
                session,
                bundle,
                event_stream=stream,
                allow_unsafe_code_actions=settings.allow_unsafe_code_actions,
            )

        gateway = RealtimeGateway(
            scoped_event_stream,
            orchestrator_factory=orchestrator_factory,
            realtime_session_factory=lambda trace: RealtimeSession(
                trace_collector=trace,
                endpoint=workspace_settings.openai_endpoint,
                api_key=workspace_settings.openai_api_key,
            ),
            initial_input_gate_ms=initial_input_gate_ms,
        )
        end_call_requested = False
        final_status = "disconnected"

        def connected() -> bool:
            return (
                websocket.application_state == WebSocketState.CONNECTED
                and websocket.client_state == WebSocketState.CONNECTED
            )

        async def send_media(payload: str) -> None:
            if gateway.stream_sid and connected():
                await websocket.send_json(
                    {"event": "media", "streamSid": gateway.stream_sid, "media": {"payload": payload}}
                )

        async def send_mark(name: str) -> None:
            if gateway.stream_sid and connected():
                await websocket.send_json({"event": "mark", "streamSid": gateway.stream_sid, "mark": {"name": name}})

        async def send_clear() -> None:
            if gateway.stream_sid and connected():
                await websocket.send_json({"event": "clear", "streamSid": gateway.stream_sid})

        async def end_call() -> None:
            nonlocal end_call_requested, final_status
            if end_call_requested:
                return
            end_call_requested = True
            final_status = "completed"
            repository.update_call(call["id"], status="completed")
            if connected():
                await websocket.close(code=1000)

        realtime_started = False
        try:
            while not end_call_requested and connected():
                event = json.loads(await websocket.receive_text())
                event_type = event.get("event")
                if event_type == "start":
                    start = event.get("start", {})
                    repository.mark_call_started(call["id"], call_sid=start.get("callSid"))
                    await gateway.realtime_start(call["to_number"], send_media, send_mark, send_clear, end_call)
                    realtime_started = True
                    await gateway.twilio_start(start.get("streamSid", ""), start.get("callSid"))
                elif event_type == "media" and realtime_started:
                    media = event.get("media", {})
                    await gateway.twilio_media(media.get("payload", ""), int(media.get("timestamp", 0)))
                elif event_type == "mark":
                    await gateway.twilio_mark(event.get("mark", {}).get("name"))
                elif event_type == "stop":
                    await gateway.twilio_stop()
                    final_status = "completed"
                    repository.update_call(call["id"], status="completed")
                    break
        except WebSocketDisconnect:
            if not end_call_requested:
                final_status = "disconnected"
                repository.update_call(call["id"], status="disconnected")
        except Exception as exc:
            final_status = "failed"
            repository.update_call(call["id"], status="failed")
            print(f"[Voice runtime connection error] {type(exc).__name__}: {exc}")
            if connected():
                await websocket.close(code=1011, reason="Voice runtime initialization failed")
        finally:
            await gateway.realtime_stop()
            runtime_snapshot = gateway.orchestrator.snapshot()
            repository.finalize_call(
                call["id"],
                status=final_status,
                transcript=gateway.get_transcript(),
                state=runtime_snapshot.get("state", {}),
                trace=gateway.get_trace(),
                execution_path=[
                    str(item.get("name", item.get("id", ""))) for item in runtime_snapshot.get("execution_path", [])
                ],
                flow_completed=gateway.orchestrator.is_complete,
            )
            if final_status == "completed" and settings.research_agent_url:
                task = asyncio.create_task(_request_post_call_analysis(settings.research_agent_url, call["id"]))
                research_tasks.add(task)
                task.add_done_callback(research_tasks.discard)
            if scoped_event_stream is not None:
                scoped_event_stream.emit(
                    "call_ended",
                    {
                        "status": final_status,
                        "state": runtime_snapshot.get("state", {}),
                    },
                )

    return router
