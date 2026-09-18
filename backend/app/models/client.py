import uuid
from sqlalchemy import Column, String, Boolean, Text, DateTime
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.database import Base


class Client(Base):
    __tablename__ = "clients"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(255), nullable=False)
    domain = Column(String(255), nullable=False)
    client_id = Column(String(64), unique=True, nullable=False, index=True)
    bot_name = Column(String(100), nullable=False, default="Assistant")
    system_prompt = Column(Text, nullable=False, default="")
    welcome_message = Column(Text, nullable=False, default="Hi! How can I help you?")
    theme_color = Column(String(7), nullable=False, default="#2563eb")
    widget_position = Column(String(16), nullable=False, default="bottom-right")
    font_family = Column(String(200), nullable=True)
    custom_css = Column(Text, nullable=True)
    ai_provider = Column(String(32), nullable=False, default="openai")
    ai_model = Column(String(100), nullable=True)
    ai_api_key = Column(String(255), nullable=True)
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    knowledge_chunks = relationship("KnowledgeChunk", back_populates="client", cascade="all, delete-orphan")
    conversations = relationship("Conversation", back_populates="client", cascade="all, delete-orphan")
    leads = relationship("Lead", back_populates="client", cascade="all, delete-orphan")
