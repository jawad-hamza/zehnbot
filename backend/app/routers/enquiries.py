"""Leads for the platform itself. Anyone may send one from the landing page; only the super admin reads them."""
import csv
import io
import re
import uuid
from datetime import datetime
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.config import settings
from app.dependencies import get_db, require_superadmin
from app.models.enquiry import Enquiry
from app.models.user import User
from app.services import rate_limit

public_router = APIRouter()
admin_router = APIRouter()

_PHONE = re.compile(r"^[0-9+()\-.\s]{5,30}$")


class EnquiryCreate(BaseModel):
    name: Optional[str] = Field(default=None, max_length=255)
    email: Optional[EmailStr] = None
    phone: Optional[str] = Field(default=None, max_length=30)
    company: Optional[str] = Field(default=None, max_length=255)
    plan: Optional[str] = Field(default=None, max_length=32)
    message: Optional[str] = Field(default=None, max_length=4000)
    source: str = Field(default="landing", max_length=32, pattern=r"^[a-z0-9-]+$")
    fax: Optional[str] = Field(default=None, max_length=500)     # honeypot: people never see this field

    @field_validator("name", "email", "phone", "company", "plan", "message", mode="before")
    @classmethod
    def _blank_to_none(cls, v):
        if isinstance(v, str):
            v = v.strip()
        return v or None

    @field_validator("phone")
    @classmethod
    def _phone_shape(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and not _PHONE.match(v):
            raise ValueError("That phone number doesn't look right")
        return v

    @model_validator(mode="after")
    def _contactable(self):
        if not self.email and not self.phone:
            raise ValueError("Provide an email or a phone number")
        return self


class EnquiryResponse(BaseModel):
    id: uuid.UUID
    name: Optional[str]
    email: Optional[str]
    phone: Optional[str]
    company: Optional[str]
    plan: Optional[str]
    message: Optional[str]
    source: str
    status: str
    created_at: datetime

    model_config = {"from_attributes": True}


class EnquiryList(BaseModel):
    total: int
    new: int
    items: List[EnquiryResponse]


class EnquiryUpdate(BaseModel):
    status: Literal["new", "contacted", "closed"]


@public_router.post("", status_code=status.HTTP_201_CREATED)
def send_enquiry(body: EnquiryCreate, request: Request, db: Session = Depends(get_db)):
    rate_limit.enforce(
        "contact-ip", rate_limit.client_ip(request), settings.RATE_CONTACT_PER_IP_PER_HOUR, 3600,
        "You have sent several requests already. We will be in touch.",
    )
    if body.fax:
        # a bot filled the hidden field: answer as if it worked, store nothing
        return {"received": True}
    db.add(Enquiry(**body.model_dump(exclude={"fax"})))
    db.commit()
    return {"received": True}


@admin_router.get("/enquiries", response_model=EnquiryList)
def list_enquiries(
    state: Optional[Literal["new", "contacted", "closed"]] = Query(default=None, alias="status"),
    q: Optional[str] = Query(default=None, max_length=100),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    _: User = Depends(require_superadmin),
):
    query = db.query(Enquiry)
    if state:
        query = query.filter(Enquiry.status == state)
    if q and q.strip():
        like = f"%{q.strip()}%"
        query = query.filter(or_(Enquiry.name.ilike(like), Enquiry.email.ilike(like), Enquiry.phone.ilike(like),
                                 Enquiry.company.ilike(like), Enquiry.message.ilike(like)))
    items = query.order_by(Enquiry.created_at.desc()).offset((page - 1) * page_size).limit(page_size).all()
    return EnquiryList(
        total=query.count(),
        new=db.query(Enquiry).filter(Enquiry.status == "new").count(),
        items=[EnquiryResponse.model_validate(i) for i in items],
    )


def _spreadsheet_safe(value) -> str:
    """Visitors control these values; a cell starting with = + - @ would run as a formula in Excel."""
    text = "" if value is None else str(value)
    return "'" + text if text[:1] in ("=", "+", "-", "@", "\t", "\r") else text


@admin_router.get("/enquiries/export")
def export_enquiries(db: Session = Depends(get_db), _: User = Depends(require_superadmin)):
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(["received_at_utc", "status", "name", "email", "phone", "company", "plan", "source", "message"])
    for e in db.query(Enquiry).order_by(Enquiry.created_at.desc()).yield_per(500):
        writer.writerow([
            e.created_at.strftime("%Y-%m-%d %H:%M:%S") if e.created_at else "", e.status,
            _spreadsheet_safe(e.name), _spreadsheet_safe(e.email), _spreadsheet_safe(e.phone),
            _spreadsheet_safe(e.company), _spreadsheet_safe(e.plan), e.source, _spreadsheet_safe(e.message),
        ])
    return Response(
        content="﻿" + buffer.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="zehnbot-enquiries.csv"'},
    )


def _find(enquiry_id: uuid.UUID, db: Session) -> Enquiry:
    enquiry = db.query(Enquiry).filter(Enquiry.id == enquiry_id).first()
    if not enquiry:
        raise HTTPException(status_code=404, detail="Enquiry not found")
    return enquiry


@admin_router.patch("/enquiries/{enquiry_id}", response_model=EnquiryResponse)
def update_enquiry(enquiry_id: uuid.UUID, body: EnquiryUpdate, db: Session = Depends(get_db), _: User = Depends(require_superadmin)):
    enquiry = _find(enquiry_id, db)
    enquiry.status = body.status
    db.commit()
    db.refresh(enquiry)
    return EnquiryResponse.model_validate(enquiry)


@admin_router.delete("/enquiries/{enquiry_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_enquiry(enquiry_id: uuid.UUID, db: Session = Depends(get_db), _: User = Depends(require_superadmin)):
    db.delete(_find(enquiry_id, db))
    db.commit()
