import uuid
from sqlalchemy import Column, DateTime, ForeignKey, LargeBinary, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.database import Base

LAUNCHER_SLOTS = ("normal", "hover", "open")


class BotMedia(Base):
    """A picture for the widget's launcher button: one per bot and state (normal, hover, open)."""
    __tablename__ = "bot_media"
    __table_args__ = (UniqueConstraint("client_id", "slot", name="uq_bot_media_client_slot"),)

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    client_id = Column(UUID(as_uuid=True), ForeignKey("clients.id", ondelete="CASCADE"), nullable=False)
    slot = Column(String(16), nullable=False)
    content_type = Column(String(32), nullable=False)
    data = Column(LargeBinary, nullable=False)
    sha256 = Column(String(64), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    client = relationship("Client", back_populates="media")
