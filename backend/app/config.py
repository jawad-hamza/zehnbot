from pydantic_settings import BaseSettings
from typing import List
import json


class Settings(BaseSettings):
    DATABASE_URL: str
    SECRET_KEY: str
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 8
    OPENAI_API_KEY: str = ""   # fallback; each bot/client has its own key set via dashboard
    ALLOWED_ORIGINS: str = '["*"]'
    ADMIN_SEED_EMAIL: str = "admin@example.com"
    ADMIN_SEED_PASSWORD: str = "changeme"

    @property
    def allowed_origins_list(self) -> List[str]:
        try:
            return json.loads(self.ALLOWED_ORIGINS)
        except Exception:
            return ["*"]

    class Config:
        env_file = ".env"


settings = Settings()
