import uuid

from sqlalchemy import Column, DateTime, Index, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func

from app.database import Base

STATUSES = ("new", "contacted", "closed")


class Enquiry(Base):
    """A lead for the platform itself: someone on the landing page (or a customer in their
    settings) asking the operator to get in touch. Belongs to no tenant; only the super admin sees it."""
    __tablename__ = "enquiries"
    __table_args__ = (Index("ix_enquiries_status_created", "status", "created_at"),)

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(255), nullable=True)
    email = Column(String(255), nullable=True)
    phone = Column(String(50), nullable=True)
    company = Column(String(255), nullable=True)          # business name or website
    plan = Column(String(32), nullable=True)              # the plan they were looking at, if any
    message = Column(Text, nullable=True)
    source = Column(String(32), nullable=False, default="landing", server_default="landing")
    status = Column(String(16), nullable=False, default="new", server_default="new")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
