from pydantic import BaseModel
from typing import List
from datetime import datetime
import uuid


class KnowledgeUpload(BaseModel):
    raw_text: str
    source_label: str = "manual"


class KnowledgeUrlIngest(BaseModel):
    url: str


class KnowledgeCrawlRequest(BaseModel):
    url: str
    max_pages: int = 25


class KnowledgeCrawlResponse(BaseModel):
    pages_crawled: int
    chunks_created: int


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
