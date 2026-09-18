import uuid
from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func
from app.database import Base


class IngestJob(Base):
    """A background knowledge-ingest job (site crawl). Polled by the dashboard."""
    __tablename__ = "ingest_jobs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    client_id = Column(UUID(as_uuid=True), ForeignKey("clients.id", ondelete="CASCADE"), nullable=False, index=True)
    kind = Column(String(16), nullable=False, default="crawl")
    url = Column(String(2048), nullable=False)
    max_pages = Column(Integer, nullable=False, default=25)
    status = Column(String(16), nullable=False, default="pending")   # pending | running | done | failed
    pages_crawled = Column(Integer, nullable=False, default=0)
    chunks_created = Column(Integer, nullable=False, default=0)
    error = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    finished_at = Column(DateTime(timezone=True), nullable=True)
