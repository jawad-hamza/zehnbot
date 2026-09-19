import uuid
from sqlalchemy import Column, String, Boolean, Text, DateTime, ForeignKey, true
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.database import Base


class Client(Base):
    """One chatbot. Belongs to a tenant; `client_id` is the public slug used in the embed script."""
    __tablename__ = "clients"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    domain = Column(String(255), nullable=False)
    client_id = Column(String(64), unique=True, nullable=False, index=True)
    bot_name = Column(String(100), nullable=False, default="Assistant")
    system_prompt = Column(Text, nullable=False, default="")
    welcome_message = Column(Text, nullable=False, default="Hi! How can I help you?")
    theme_color = Column(String(7), nullable=False, default="#1a52d7")
    widget_position = Column(String(16), nullable=False, default="bottom-right")
    font_family = Column(String(200), nullable=True)
    custom_css = Column(Text, nullable=True)
    # Runs on the owner's own website only, never on the platform's pages (see widget config)
    custom_js = Column(Text, nullable=True)
    notification_sound = Column(Boolean, nullable=False, default=True, server_default=true())   # soft chirp when the bot replies
    # A provider id from app/services/providers.py. Only used when the bot has its own key;
    # without one, the platform's provider answers.
    ai_provider = Column(String(32), nullable=False, default="deepseek")
    ai_model = Column(String(100), nullable=True)
    ai_base_url = Column(String(500), nullable=True)   # only for the "custom" provider
    # Encrypted at rest (see crypto_service). Never returned by the API.
    ai_api_key = Column(Text, nullable=True)
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    tenant = relationship("Tenant", back_populates="clients")
    knowledge_chunks = relationship("KnowledgeChunk", back_populates="client", cascade="all, delete-orphan")
    conversations = relationship("Conversation", back_populates="client", cascade="all, delete-orphan")
    leads = relationship("Lead", back_populates="client", cascade="all, delete-orphan")
    media = relationship("BotMedia", back_populates="client", cascade="all, delete-orphan", passive_deletes=True)
