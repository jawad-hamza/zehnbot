import csv
import io
from typing import Optional

from fastapi import APIRouter, Depends, Header, Query, Request, Response, status
from sqlalchemy.orm import Session

from app.config import settings
from app.dependencies import get_db, get_owned_client
from app.models.client import Client
from app.models.lead import Lead
from app.schemas.lead import LeadCapture, LeadListResponse, LeadResponse
from app.services import rate_limit
from app.services.client_service import enforce_widget_origin, require_active_client
from app.services.lead_service import save_lead

# Public router — no auth required
public_router = APIRouter()

# Admin router — JWT required
admin_router = APIRouter()


@public_router.post("/capture", status_code=status.HTTP_201_CREATED)
def capture_lead(
    body: LeadCapture,
    request: Request,
    origin: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
):
    rate_limit.enforce("lead-ip", rate_limit.client_ip(request), settings.RATE_LEAD_PER_IP_PER_MIN, 60)
    client = require_active_client(body.client_id, db)
    enforce_widget_origin(origin, client, request)
    lead = save_lead(
        client=client,
        conversation_id=body.conversation_id,
        name=body.name,
        email=str(body.email) if body.email else None,
        phone=body.phone,
        raw_context=None,
        db=db,
    )
    return {"lead_id": str(lead.id)}


@admin_router.get("/clients/{client_uuid}/leads", response_model=LeadListResponse)
def list_leads(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    client: Client = Depends(get_owned_client),
    db: Session = Depends(get_db),
):
    total = db.query(Lead).filter(Lead.client_id == client.id).count()
    items = (
        db.query(Lead)
        .filter(Lead.client_id == client.id)
        .order_by(Lead.captured_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return LeadListResponse(total=total, items=[LeadResponse.model_validate(i) for i in items])


def _spreadsheet_safe(value) -> str:
    """A visitor controls these values. A cell starting with = + - @ would run as a formula when
    the owner opens the export in Excel, so such cells are forced to be read as text."""
    text = "" if value is None else str(value)
    return "'" + text if text[:1] in ("=", "+", "-", "@", "\t", "\r") else text


@admin_router.get("/clients/{client_uuid}/leads/export")
def export_leads(client: Client = Depends(get_owned_client), db: Session = Depends(get_db)):
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(["captured_at_utc", "name", "email", "phone", "source", "conversation_id", "said_in_chat"])
    for lead in db.query(Lead).filter(Lead.client_id == client.id).order_by(Lead.captured_at.desc()).yield_per(500):
        writer.writerow([
            lead.captured_at.strftime("%Y-%m-%d %H:%M:%S") if lead.captured_at else "",
            _spreadsheet_safe(lead.name),
            _spreadsheet_safe(lead.email),
            _spreadsheet_safe(lead.phone),
            lead.source,
            lead.conversation_id or "",
            _spreadsheet_safe(lead.raw_context),
        ])
    return Response(
        content="\ufeff" + buffer.getvalue(),   # BOM: Excel otherwise misreads non-ASCII names
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="leads-{client.client_id}.csv"'},
    )
