import logging
import os
import time
import uuid

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text

from app.config import settings
from app.database import SessionLocal
from app.routers import analytics, auth, clients, knowledge, overview, widget, chat, conversations, tenants
from app.routers.leads import public_router as leads_public, admin_router as leads_admin
from app.routers.enquiries import public_router as enquiries_public, admin_router as enquiries_admin
from app.routers.pricing import public_router as pricing_public, admin_router as pricing_admin

logging.basicConfig(
    level=settings.LOG_LEVEL.upper(),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger("app")

ADMIN_PATH_PREFIXES = ("/api/admin", "/api/auth")


class SplitCORSMiddleware:
    """Two CORS policies in one app.

    The widget is embedded on customers' websites, so its endpoints must answer any origin.
    The admin API is only ever called by the dashboard (same-origin), so it answers no
    foreign origin unless one is listed in ALLOWED_ORIGINS."""

    def __init__(self, app):
        self.public = CORSMiddleware(
            app,
            allow_origins=["*"],
            allow_methods=["GET", "POST", "OPTIONS"],
            allow_headers=["Content-Type", "Accept"],
            max_age=600,
        )
        self.admin = CORSMiddleware(
            app,
            allow_origins=settings.allowed_origins_list,
            allow_methods=["*"],
            allow_headers=["Authorization", "Content-Type", "Accept"],
        )

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http" and scope["path"].startswith(ADMIN_PATH_PREFIXES):
            await self.admin(scope, receive, send)
        else:
            await self.public(scope, receive, send)


def create_app() -> FastAPI:
    docs = None if settings.is_production else "/docs"
    app = FastAPI(
        title="ChatBot SaaS API",
        version="2.0.0",
        docs_url=docs,
        redoc_url=None,
        openapi_url=None if settings.is_production else "/openapi.json",
    )

    @app.middleware("http")
    async def request_context(request: Request, call_next):
        request_id = request.headers.get("x-request-id") or uuid.uuid4().hex
        started = time.perf_counter()
        try:
            response = await call_next(request)
        except Exception:
            # Never leak internals to the caller; the id ties the response to the log line
            logger.exception("Unhandled error %s %s rid=%s", request.method, request.url.path, request_id)
            response = JSONResponse(status_code=500, content={"detail": "Internal server error", "request_id": request_id})
        response.headers["X-Request-ID"] = request_id
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        # /api/public/ is the same for everyone and sets its own short cache; everything else is per person
        if request.url.path.startswith("/api/") and not request.url.path.startswith("/api/public/"):
            response.headers["Cache-Control"] = "no-store"
        if not request.url.path.startswith("/health"):
            logger.info(
                "%s %s -> %s %.0fms rid=%s",
                request.method, request.url.path, response.status_code,
                (time.perf_counter() - started) * 1000, request_id,
            )
        return response

    app.add_middleware(SplitCORSMiddleware)

    @app.get("/health", include_in_schema=False)
    def health():
        """Liveness: the process is up."""
        return {"status": "ok"}

    @app.get("/health/ready", include_in_schema=False)
    def ready():
        """Readiness: the database answers."""
        try:
            with SessionLocal() as db:
                db.execute(text("SELECT 1"))
        except Exception:
            logger.exception("Readiness check failed")
            return JSONResponse(status_code=503, content={"status": "database unavailable"})
        return {"status": "ready"}

    # Public endpoints (no auth)
    app.include_router(auth.router,         prefix="/api/auth",   tags=["auth"])
    app.include_router(widget.router,       prefix="/api/widget", tags=["widget"])
    app.include_router(chat.router,         prefix="/api/chat",   tags=["chat"])
    app.include_router(leads_public,        prefix="/api/leads",  tags=["leads"])
    app.include_router(enquiries_public,    prefix="/api/contact", tags=["contact"])
    app.include_router(pricing_public,      prefix="/api/public",  tags=["public"])

    # Dashboard endpoints (JWT required, scoped to the caller's tenant)
    app.include_router(clients.router,          prefix="/api/admin", tags=["admin"])
    app.include_router(knowledge.router,        prefix="/api/admin", tags=["admin"])
    app.include_router(conversations.router,    prefix="/api/admin", tags=["admin"])
    app.include_router(leads_admin,             prefix="/api/admin", tags=["admin"])
    app.include_router(analytics.router,        prefix="/api/admin", tags=["admin"])
    app.include_router(overview.router,         prefix="/api/admin", tags=["admin"])

    # Platform operator endpoints (super admin only)
    app.include_router(tenants.router,          prefix="/api/admin", tags=["superadmin"])
    app.include_router(enquiries_admin,         prefix="/api/admin", tags=["superadmin"])
    app.include_router(pricing_admin,           prefix="/api/admin", tags=["superadmin"])

    # Serve built widget bundle at /static/widget.js
    static_dir = os.path.join(os.path.dirname(__file__), "..", "static")
    if os.path.isdir(static_dir):
        app.mount("/static", StaticFiles(directory=static_dir), name="static")

    return app


app = create_app()
