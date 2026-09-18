from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from app.dependencies import get_db
from app.schemas.chat import ChatRequest, ChatResponse
from app.services.chat_service import process_message

router = APIRouter()


@router.post("/message", response_model=ChatResponse)
def send_message(body: ChatRequest, db: Session = Depends(get_db)):
    return process_message(body, db)
