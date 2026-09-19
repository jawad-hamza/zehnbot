import uuid
from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field, field_validator


def with_scheme(value: str) -> str:
    """People type "example.com/pricing", not "https://example.com/pricing"."""
    value = value.strip()
    return value if "://" in value else "https://" + value


class KnowledgeUpload(BaseModel):
    raw_text: str = Field(min_length=1, max_length=2_000_000)
    source_label: str = Field(default="manual", min_length=1, max_length=255)


class KnowledgeUrlIngest(BaseModel):
    url: str = Field(min_length=4, max_length=2048)

    _url = field_validator("url")(with_scheme)


class KnowledgeCrawlRequest(BaseModel):
    url: str = Field(min_length=4, max_length=2048)
    max_pages: int = Field(default=25, ge=1, le=50)

    _url = field_validator("url")(with_scheme)


class IngestJobResponse(BaseModel):
    id: uuid.UUID
    status: str
    url: str
    pages_crawled: int
    chunks_created: int
    error: Optional[str] = None
    created_at: datetime
    finished_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class KnowledgeChunkResponse(BaseModel):
    id: uuid.UUID
    chunk_text: str
    chunk_index: int
    source_label: str
    created_at: datetime

    model_config = {"from_attributes": True}


class KnowledgeListResponse(BaseModel):
    chunks: List[KnowledgeChunkResponse]


class KnowledgeUploadResponse(BaseModel):
    chunks_created: int
