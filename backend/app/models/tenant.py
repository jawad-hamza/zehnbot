import uuid
from sqlalchemy import Column, String, Boolean, Integer, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.database import Base


class Tenant(Base):
    """A paying customer account. Owns users and bots (the `clients` table)."""
    __tablename__ = "tenants"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(255), nullable=False)
    plan = Column(String(32), nullable=False, default="free")
    monthly_message_quota = Column(Integer, nullable=False, default=200)
    max_bots = Column(Integer, nullable=False, default=1)
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    users = relationship("User", back_populates="tenant", cascade="all, delete-orphan")
    clients = relationship("Client", back_populates="tenant", cascade="all, delete-orphan")
    usage = relationship("UsageCounter", back_populates="tenant", cascade="all, delete-orphan")


class UsageCounter(Base):
    """Messages and tokens consumed by a tenant in one calendar month (period = 'YYYY-MM')."""
    __tablename__ = "usage_counters"
    __table_args__ = (UniqueConstraint("tenant_id", "period", name="uq_usage_tenant_period"),)

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    period = Column(String(7), nullable=False)
    messages = Column(Integer, nullable=False, default=0)
    platform_messages = Column(Integer, nullable=False, default=0)   # subset answered with the platform key
    tokens = Column(Integer, nullable=False, default=0)

    tenant = relationship("Tenant", back_populates="usage")
