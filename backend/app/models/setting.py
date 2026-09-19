from sqlalchemy import JSON, Column, DateTime, String
from sqlalchemy.sql import func

from app.database import Base


class PlatformSetting(Base):
    """Things the operator changes from the dashboard instead of from .env (one JSON value per key)."""
    __tablename__ = "platform_settings"

    key = Column(String(64), primary_key=True)
    value = Column(JSON, nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
