import uuid
from sqlalchemy import Column, Index, Integer, String, Text, DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.database import Base


class KnowledgeChunk(Base):
    # On Postgres the table also has a generated `search_vector` tsvector column with a GIN
    # index (migration 0002). It is Postgres-only, so it is managed by the migration and
    # queried with raw SQL rather than mapped here; alembic/env.py shields it from autogenerate.
    __tablename__ = "knowledge_chunks"
    __table_args__ = (Index("ix_knowledge_chunks_client_source", "client_id", "source_label"),)

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    client_id = Column(UUID(as_uuid=True), ForeignKey("clients.id", ondelete="CASCADE"), nullable=False, index=True)
    chunk_text = Column(Text, nullable=False)
    chunk_index = Column(Integer, nullable=False)
    source_label = Column(String(255), default="manual")
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    client = relationship("Client", back_populates="knowledge_chunks")
