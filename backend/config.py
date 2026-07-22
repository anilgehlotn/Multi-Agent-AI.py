import os

from dotenv import load_dotenv
from pydantic_settings import BaseSettings, SettingsConfigDict

_BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
_ENV_PATH = os.path.join(_BACKEND_DIR, ".env")

# Also populate os.environ (not just pydantic's Settings below) — libraries
# like langchain-google-genai and the Tavily client read their API keys
# straight from the process environment. A bare load_dotenv() elsewhere in
# the codebase only searches upward from the current working directory,
# which silently finds the wrong (or no) .env depending on where the
# process was launched from; this pins it to backend/.env regardless.
load_dotenv(dotenv_path=_ENV_PATH)


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

    # Comma-separated list of allowed CORS origins. Parsed into a list in
    # main.py — kept as a raw string here so it can be set as a single env
    # var (e.g. on Render) without needing JSON-list syntax.
    CORS_ORIGINS: str = "http://localhost:5173,http://localhost:3000"

    model_config = SettingsConfigDict(
        env_file=_ENV_PATH,
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = Settings()
