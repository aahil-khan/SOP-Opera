from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

_ROOT_ENV = Path(__file__).resolve().parents[3] / ".env"
_BACKEND_ENV = Path(__file__).resolve().parents[2] / ".env"
_ENV_FILES = tuple(
    str(p) for p in (_BACKEND_ENV, _ROOT_ENV) if p.is_file()
) or (".env",)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=_ENV_FILES,
        env_file_encoding="utf-8",
        extra="ignore",
    )

    database_url: str = "postgresql+asyncpg://sop:sop@localhost:5433/sop_opera"
    cors_origins: str = "http://localhost:3000"

    ai_provider: str = "mock"
    openai_api_key: str = ""
    openai_base_url: str = "https://api.openai.com/v1"
    openai_model: str = "gpt-4o-mini"
    ollama_base_url: str = "http://localhost:11434"
    ollama_model: str = "llama3.2"

    assessment_max_retries: int = 1
    gas_elevated_threshold: float = 20.0
    cert_expiry_warning_days: int = 14
    default_owner_user_id: str = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
    simulator_default_step_delay_seconds: int = 5

    rag_enabled: bool = True
    embedding_provider: str = "mock"
    embedding_model: str = "text-embedding-3-small"
    embedding_dim: int = 1536
    rag_top_k: int = 5
    rag_score_threshold: float = 0.72
    rag_timeout_ms: int = 3000

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
