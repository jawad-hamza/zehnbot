import uuid
from sqlalchemy import Column, String, Boolean, DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.database import Base

ROLE_SUPERADMIN = "superadmin"   # platform operator: sees every tenant, tenant_id is NULL
ROLE_TENANT_ADMIN = "tenant_admin"   # customer login: confined to its own tenant


class User(Base):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # Historically a free-form username, so it is not required to be an email address.
    email = Column(String(255), unique=True, nullable=False, index=True)
    hashed_password = Column(String(255), nullable=False)
    role = Column(String(32), nullable=False, default=ROLE_TENANT_ADMIN)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=True, index=True)
    is_active = Column(Boolean, nullable=False, default=True)
    # NULL = the address has not been confirmed yet (only enforced when the platform can send email)
    email_verified_at = Column(DateTime(timezone=True), nullable=True)
    # Google's stable account id ("sub"), set once this login has signed in with Google
    google_sub = Column(String(64), nullable=True, unique=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    tenant = relationship("Tenant", back_populates="users")

    @property
    def is_superadmin(self) -> bool:
        return self.role == ROLE_SUPERADMIN
