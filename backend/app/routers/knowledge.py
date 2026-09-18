from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, status
from sqlalchemy.orm import Session
import uuid

from app.dependencies import get_db, get_current_admin
from app.models.client import Client
from app.models.knowledge import KnowledgeChunk
from app.schemas.knowledge import (
    KnowledgeUpload,
    KnowledgeUrlIngest,
    KnowledgeCrawlRequest,
    KnowledgeCrawlResponse,
    KnowledgeListResponse,
    KnowledgeUploadResponse,
    KnowledgeChunkResponse,
)
from app.services.knowledge_service import save_knowledge, append_knowledge, fetch_url_text, extract_file_text, crawl_site

router = APIRouter()

MAX_FILE_BYTES = 10 * 1024 * 1024  # 10 MB


def _get_client_or_404(client_uuid: uuid.UUID, db: Session) -> Client:
    client = db.query(Client).filter(Client.id == client_uuid).first()
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    return client


@router.get("/clients/{client_uuid}/knowledge", response_model=KnowledgeListResponse)
def get_knowledge(client_uuid: uuid.UUID, db: Session = Depends(get_db), _=Depends(get_current_admin)):
    _get_client_or_404(client_uuid, db)
    chunks = (
        db.query(KnowledgeChunk)
        .filter(KnowledgeChunk.client_id == client_uuid)
        .order_by(KnowledgeChunk.chunk_index)
        .all()
    )
    return KnowledgeListResponse(chunks=[KnowledgeChunkResponse.model_validate(c) for c in chunks])


@router.post("/clients/{client_uuid}/knowledge", response_model=KnowledgeUploadResponse, status_code=status.HTTP_201_CREATED)
def upload_knowledge(client_uuid: uuid.UUID, body: KnowledgeUpload, db: Session = Depends(get_db), _=Depends(get_current_admin)):
    client = _get_client_or_404(client_uuid, db)
    count = save_knowledge(body.raw_text, client.id, body.source_label, db)
    return KnowledgeUploadResponse(chunks_created=count)


@router.post("/clients/{client_uuid}/knowledge/url", response_model=KnowledgeUploadResponse, status_code=status.HTTP_201_CREATED)
def ingest_url(client_uuid: uuid.UUID, body: KnowledgeUrlIngest, db: Session = Depends(get_db), _=Depends(get_current_admin)):
    client = _get_client_or_404(client_uuid, db)
    text = fetch_url_text(body.url)
    count = append_knowledge(text, client.id, body.url, db)
    return KnowledgeUploadResponse(chunks_created=count)


@router.post("/clients/{client_uuid}/knowledge/crawl", response_model=KnowledgeCrawlResponse, status_code=status.HTTP_201_CREATED)
def crawl_knowledge(client_uuid: uuid.UUID, body: KnowledgeCrawlRequest, db: Session = Depends(get_db), _=Depends(get_current_admin)):
    client = _get_client_or_404(client_uuid, db)
    pages = crawl_site(body.url, max_pages=min(max(body.max_pages, 1), 50))
    total_chunks = 0
    for page_url, text in pages:
        total_chunks += append_knowledge(text, client.id, page_url, db)
    return KnowledgeCrawlResponse(pages_crawled=len(pages), chunks_created=total_chunks)


@router.post("/clients/{client_uuid}/knowledge/file", response_model=KnowledgeUploadResponse, status_code=status.HTTP_201_CREATED)
async def ingest_file(
    client_uuid: uuid.UUID,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    _=Depends(get_current_admin),
):
    client = _get_client_or_404(client_uuid, db)
    data = await file.read()
    if len(data) > MAX_FILE_BYTES:
        raise HTTPException(status_code=413, detail="File too large (max 10 MB).")
    if not data:
        raise HTTPException(status_code=400, detail="Empty file.")
    text = extract_file_text(file.filename or "upload", data)
    label = f"file:{file.filename}" if file.filename else "file"
    count = append_knowledge(text, client.id, label, db)
    return KnowledgeUploadResponse(chunks_created=count)


@router.delete("/clients/{client_uuid}/knowledge", status_code=status.HTTP_204_NO_CONTENT)
def delete_knowledge(client_uuid: uuid.UUID, db: Session = Depends(get_db), _=Depends(get_current_admin)):
    _get_client_or_404(client_uuid, db)
    db.query(KnowledgeChunk).filter(KnowledgeChunk.client_id == client_uuid).delete()
    db.commit()
