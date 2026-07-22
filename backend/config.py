import os

from pydantic_settings import BaseSettings, SettingsConfigDict

_BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))


class Settings(BaseSettings):
    GOOGLE_API_KEY: str = ""
    TAVILY_API_KEY: str = ""
    MISTRAL_API_KEY: str = ""

    # Required — no default, so a missing secret fails loudly at startup
    # instead of silently issuing tokens signed with a blank/guessable key.
    JWT_SECRET_KEY: str
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_MINUTES: int = 60 * 24 * 7  # 7 days

    # SQLite file for now; swap to a Postgres URL later without code changes.
    DATABASE_URL: str = "sqlite:///./researchmind.db"

    model_config = SettingsConfigDict(
        env_file=os.path.join(_BACKEND_DIR, ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = Settings()
