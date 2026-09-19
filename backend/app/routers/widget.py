from typing import Optional

from fastapi import APIRouter, Depends, Header, Query, Request
from sqlalchemy.orm import Session

from app.dependencies import get_db
from app.schemas.chat import WidgetConfig
from app.services import rate_limit
from app.services.client_service import enforce_widget_origin, is_platform_origin, require_active_client
from app.services.media_service import launcher_image_urls

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
    # A bot's own JavaScript is its owner's code. It may run on the owner's website, never on ours
    # (the dashboard, its previews, the landing page), where it could act as whoever is signed in.
    # Same-origin requests carry no Origin header, so "no Origin" counts as ours too.
    ours = not origin or is_platform_origin(origin, request)
    return WidgetConfig(
        bot_name=client.bot_name,
        welcome_message=client.welcome_message,
        theme_color=client.theme_color,
        widget_position=client.widget_position,
        font_family=client.font_family,
        custom_css=client.custom_css,
        custom_js=None if ours else client.custom_js,
        launcher_images=launcher_image_urls(client),
        notification_sound=client.notification_sound,
    )
