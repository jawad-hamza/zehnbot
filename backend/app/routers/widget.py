from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from app.dependencies import get_db
from app.schemas.chat import WidgetConfig
from app.services.client_service import require_active_client

router = APIRouter()


@router.get("/config", response_model=WidgetConfig)
def get_widget_config(client_id: str = Query(...), db: Session = Depends(get_db)):
    client = require_active_client(client_id, db)
    return WidgetConfig(
        bot_name=client.bot_name,
        welcome_message=client.welcome_message,
        theme_color=client.theme_color,
        widget_position=client.widget_position,
        font_family=client.font_family,
        custom_css=client.custom_css,
    )
