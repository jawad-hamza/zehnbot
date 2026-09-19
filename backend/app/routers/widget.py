from typing import Optional

from fastapi import APIRouter, Depends, Header, Query, Request
from sqlalchemy.orm import Session

from app.dependencies import get_db
from app.schemas.chat import WidgetConfig
from app.services import rate_limit
from app.services.client_service import enforce_widget_origin, require_active_client

router = APIRouter()


@router.get("/config", response_model=WidgetConfig)
def get_widget_config(
    request: Request,
    client_id: str = Query(..., max_length=64),
    origin: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
):
    rate_limit.enforce("widget-config", rate_limit.client_ip(request), 120, 60)
    client = require_active_client(client_id, db)
    # Refuse here, not only at chat time: on a website that is not allowed, the widget should not
    # appear at all, rather than appear and then fail on the first message. Browsers attach Origin
    # to every cross-site fetch; a request without one is not a page embedding the widget.
    if origin:
        enforce_widget_origin(origin, client, request)
    return WidgetConfig(
        bot_name=client.bot_name,
        welcome_message=client.welcome_message,
        theme_color=client.theme_color,
        widget_position=client.widget_position,
        font_family=client.font_family,
        custom_css=client.custom_css,
        notification_sound=client.notification_sound,
    )
