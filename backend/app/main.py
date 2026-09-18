from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import os

from app.config import settings
from app.routers import auth, clients, knowledge, widget, chat, conversations
from app.routers.leads import public_router as leads_public, admin_router as leads_admin


def create_app() -> FastAPI:
    app = FastAPI(title="ChatBot SaaS API", version="1.0.0")

    origins = settings.allowed_origins_list
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_credentials="*" not in origins,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Public endpoints (no auth)
    app.include_router(auth.router,         prefix="/api/auth",   tags=["auth"])
    app.include_router(widget.router,       prefix="/api/widget", tags=["widget"])
    app.include_router(chat.router,         prefix="/api/chat",   tags=["chat"])
    app.include_router(leads_public,        prefix="/api/leads",  tags=["leads"])

    # Admin endpoints (JWT required)
    app.include_router(clients.router,          prefix="/api/admin", tags=["admin"])
    app.include_router(knowledge.router,        prefix="/api/admin", tags=["admin"])
    app.include_router(conversations.router,    prefix="/api/admin", tags=["admin"])
    app.include_router(leads_admin,             prefix="/api/admin", tags=["admin"])

    # Serve built widget bundle at /static/widget.js
    static_dir = os.path.join(os.path.dirname(__file__), "..", "static")
    if os.path.isdir(static_dir):
        app.mount("/static", StaticFiles(directory=static_dir), name="static")

    return app


app = create_app()
