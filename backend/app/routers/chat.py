from typing import Optional

from fastapi import APIRouter, Depends, Header, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.config import settings
from app.dependencies import get_db
from app.models.client import Client
from app.schemas.chat import ChatRequest, ChatResponse
from app.routers.support import demo_client_id, support_client_id
from app.services import rate_limit
from app.services.chat_service import prepare_turn, process_message, stream_events
from app.services.client_service import enforce_widget_origin, is_platform_origin, require_active_client

router = APIRouter()


def _admit(body: ChatRequest, request: Request, origin: Optional[str], db: Session) -> Client:
    """Shared gatekeeping for both chat endpoints (one budget: streaming is not a way around it)."""
    # Cheapest checks first: nothing below touches the database until the caller is within limits
    rate_limit.enforce("chat-ip", rate_limit.client_ip(request), settings.RATE_CHAT_PER_IP_PER_MIN, 60)
    rate_limit.enforce("chat-session", f"{body.client_id}:{body.session_id}", settings.RATE_CHAT_PER_SESSION_PER_MIN, 60)
    rate_limit.enforce("chat-bot", body.client_id, settings.RATE_CHAT_PER_BOT_PER_MIN, 60)
    # The public demo on the landing page: anyone may talk to this bot from our own pages, on its
    # owner's budget. The bot's real website (a different origin) is not touched by this allowance.
    on_our_pages = is_platform_origin(origin, request)
    if on_our_pages and body.client_id == demo_client_id(db):
        rate_limit.enforce(
            "demo-ip-day", rate_limit.client_ip(request), settings.RATE_LANDING_DEMO_PER_IP_PER_DAY, 86400,
            "That is the demo's limit for today. Come back tomorrow, or set up a bot of your own.",
        )
    # The support chat in the corner of our pages: open to anyone, so it gets a daily allowance too
    elif on_our_pages and body.client_id == support_client_id(db):
        rate_limit.enforce(
            "support-ip-day", rate_limit.client_ip(request), settings.RATE_SUPPORT_BOT_PER_IP_PER_DAY, 86400,
            "That is the support chat's limit for today. Email us, or use the contact form.",
        )

    client = require_active_client(body.client_id, db)
    enforce_widget_origin(origin, client, request)
    return client


@router.post("/message", response_model=ChatResponse)
def send_message(
    body: ChatRequest,
    request: Request,
    origin: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
):
    client = _admit(body, request, origin, db)
    return process_message(client, body.session_id, body.message, db)


@router.post("/stream")
def stream_message(
    body: ChatRequest,
    request: Request,
    origin: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
):
    """Same as /message, but the reply arrives as server-sent events while it is being written:
    `{"type":"delta","text":...}` repeatedly, then one `{"type":"done",...}` or `{"type":"error",...}`.

    Everything that can be refused (limits, origin, quota, validation) is refused here with a
    normal status code, before the stream opens."""
    client = _admit(body, request, origin, db)
    turn = prepare_turn(client, body.session_id, body.message, db)
    return StreamingResponse(
        stream_events(turn),
        media_type="text/event-stream",
        headers={"X-Accel-Buffering": "no"},   # tells nginx not to hold the reply back
    )
