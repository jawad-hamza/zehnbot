import uuid
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, UploadFile, File, status
from sqlalchemy.orm import Session

from app.dependencies import get_db, get_owned_client
from app.models.client import Client
from app.models.job import IngestJob
from app.models.knowledge import KnowledgeChunk
from app.schemas.knowledge import (
    IngestJobResponse,
    KnowledgeChunkResponse,
    KnowledgeCrawlRequest,
    KnowledgeListResponse,
    KnowledgeUpload,
    KnowledgeUploadResponse,
    KnowledgeUrlIngest,
)
from app.services import knowledge_service
from app.services.knowledge_service import KnowledgeLimitError
from app.services.net_guard import UnsafeURLError, assert_public_url

router = APIRouter()

MAX_FILE_BYTES = 10 * 1024 * 1024  # 10 MB


def _store(action, *args) -> KnowledgeUploadResponse:
    try:
        return KnowledgeUploadResponse(chunks_created=action(*args))
    except KnowledgeLimitError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/clients/{client_uuid}/knowledge", response_model=KnowledgeListResponse)
def get_knowledge(client: Client = Depends(get_owned_client), db: Session = Depends(get_db)):
    chunks = (
        db.query(KnowledgeChunk)
        .filter(KnowledgeChunk.client_id == client.id)
        .order_by(KnowledgeChunk.chunk_index)
        .all()
    )
    return KnowledgeListResponse(chunks=[KnowledgeChunkResponse.model_validate(c) for c in chunks])


@router.post("/clients/{client_uuid}/knowledge", response_model=KnowledgeUploadResponse, status_code=status.HTTP_201_CREATED)
def upload_knowledge(body: KnowledgeUpload, client: Client = Depends(get_owned_client), db: Session = Depends(get_db)):
    """Pasted text. Replaces the source with the same label only; other sources are kept."""
    return _store(knowledge_service.replace_source, body.raw_text, client.id, body.source_label.strip(), db)


@router.post("/clients/{client_uuid}/knowledge/url", response_model=KnowledgeUploadResponse, status_code=status.HTTP_201_CREATED)
def ingest_url(body: KnowledgeUrlIngest, client: Client = Depends(get_owned_client), db: Session = Depends(get_db)):
    client_db_id = client.id
    db.commit()   # give the connection back while we wait on the remote site
    text = knowledge_service.fetch_url_text(body.url)
    return _store(knowledge_service.replace_source, text, client_db_id, body.url.strip(), db)


@router.post("/clients/{client_uuid}/knowledge/crawl", response_model=IngestJobResponse, status_code=status.HTTP_202_ACCEPTED)
def crawl_knowledge(
    body: KnowledgeCrawlRequest,
    background: BackgroundTasks,
    client: Client = Depends(get_owned_client),
    db: Session = Depends(get_db),
):
    """Crawls take minutes, so they run in the background. Poll the returned job."""
    url = body.url.strip()
    try:
        assert_public_url(url)
    except UnsafeURLError as e:
        raise HTTPException(status_code=400, detail=str(e))

    running = (
        db.query(IngestJob.id)
        .filter(IngestJob.client_id == client.id, IngestJob.status.in_(("pending", "running")))
        .first()
    )
    if running:
        raise HTTPException(status_code=409, detail="A crawl is already running for this bot.")

    job = IngestJob(client_id=client.id, kind="crawl", url=url, max_pages=body.max_pages)
    db.add(job)
    db.commit()
    db.refresh(job)
    background.add_task(knowledge_service.run_crawl_job, job.id)
    return job


@router.get("/clients/{client_uuid}/knowledge/jobs/{job_id}", response_model=IngestJobResponse)
def get_job(job_id: uuid.UUID, client: Client = Depends(get_owned_client), db: Session = Depends(get_db)):
    job = db.query(IngestJob).filter(IngestJob.id == job_id, IngestJob.client_id == client.id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


@router.post("/clients/{client_uuid}/knowledge/file", response_model=KnowledgeUploadResponse, status_code=status.HTTP_201_CREATED)
async def ingest_file(
    file: UploadFile = File(...),
    client: Client = Depends(get_owned_client),
    db: Session = Depends(get_db),
):
    data = await file.read(MAX_FILE_BYTES + 1)
    if len(data) > MAX_FILE_BYTES:
        raise HTTPException(status_code=413, detail="File too large (max 10 MB).")
    if not data:
        raise HTTPException(status_code=400, detail="Empty file.")
    filename = (file.filename or "upload")[:200]
    text = knowledge_service.extract_file_text(filename, data)
    return _store(knowledge_service.replace_source, text, client.id, f"file:{filename}", db)


@router.delete("/clients/{client_uuid}/knowledge", status_code=status.HTTP_204_NO_CONTENT)
def delete_knowledge(
    source_label: Optional[str] = None,
    client: Client = Depends(get_owned_client),
    db: Session = Depends(get_db),
):
    """Deletes one source when `source_label` is given, otherwise everything."""
    knowledge_service.delete_knowledge(client.id, db, source_label)
