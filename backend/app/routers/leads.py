from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
import uuid

from app.dependencies import get_db, get_current_admin
from app.models.lead import Lead
from app.models.client import Client
from app.schemas.lead import LeadCapture, LeadListResponse, LeadResponse
from app.services.client_service import require_active_client
from app.services.lead_service import save_lead

# Public router — no auth required
public_router = APIRouter()

# Admin router — JWT required
admin_router = APIRouter()


@public_router.post("/capture", status_code=status.HTTP_201_CREATED)
def capture_lead(body: LeadCapture, db: Session = Depends(get_db)):
    client = require_active_client(body.client_id, db)
    lead = save_lead(
        client=client,
        conversation_id=body.conversation_id,
        name=body.name,
        email=body.email,
        phone=body.phone,
        raw_context=None,
        db=db,
    )
    return {"lead_id": str(lead.id)}


@admin_router.get("/clients/{client_uuid}/leads", response_model=LeadListResponse)
def list_leads(
    client_uuid: uuid.UUID,
    page: int = 1,
    page_size: int = 20,
    db: Session = Depends(get_db),
    _=Depends(get_current_admin),
):
    client = db.query(Client).filter(Client.id == client_uuid).first()
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    total = db.query(Lead).filter(Lead.client_id == client_uuid).count()
    items = (
        db.query(Lead)
        .filter(Lead.client_id == client_uuid)
        .order_by(Lead.captured_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return LeadListResponse(total=total, items=[LeadResponse.model_validate(i) for i in items])
