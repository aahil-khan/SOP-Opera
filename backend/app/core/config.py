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
    # Elevated = compound-engine early warning (sub-critical co-occurrence).
    # Critical = single-sensor "incident threshold" — baseline alarm line for
    # false-negative / lead-time eval. Critical must stay above elevated.
    gas_elevated_threshold: float = 20.0
    gas_critical_threshold: float = 50.0
    temp_elevated_threshold: float = 80.0
    temp_critical_threshold: float = 120.0
    vibration_anomaly_threshold: float = 7.1
    effluent_ph_min: float = 6.0
    effluent_ph_max: float = 9.0
    tank_level_high_pct: float = 95.0
    tank_level_low_pct: float = 5.0
    weather_wind_hold_ms: float = 15.0
    cert_expiry_warning_days: int = 14
    default_owner_user_id: str = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
    simulator_default_step_delay_seconds: int = 5
    random_max_concurrent_issues: int = 8
    random_spawn_interval_min_seconds: float = 4.0
    random_spawn_interval_max_seconds: float = 12.0
    random_compound_probability: float = 0.25

    rag_enabled: bool = True
    embedding_provider: str = "mock"
    embedding_model: str = "text-embedding-3-small"
    embedding_dim: int = 1536
    rag_top_k: int = 5
    rag_score_threshold: float = 0.72
    rag_timeout_ms: int = 3000

    # LangGraph / LangSmith
    langchain_tracing_v2: bool = False
    langchain_api_key: str = ""
    langchain_project: str = "sop-opera"
    # Optional deep-link override; empty → https://smith.langchain.com when enabled
    langsmith_project_url: str = ""
    agent_spatial_radius_m: float = 15.0
    # ~0.04 m/px puts Vessel A ↔ Walkway 3 (~337px) inside a 15m radius
    agent_scale_m_per_px: float = 0.04
    agent_timeout_seconds: float = 45.0
    agent_llm_timeout_seconds: float = 20.0

    # Always-on ambient plant telemetry (tuned for low WS/UI load)
    ambient_enabled: bool = True
    ambient_tick_seconds: float = 3.0
    ambient_coincidence_probability: float = 0.01
    ambient_heartbeat_seconds: float = 120.0
    ambient_batch_size: int = 2
    ambient_status_every_n_ticks: int = 4
    # Soft telemetry ring size per asset (hydrates UI charts on open)
    ambient_telemetry_keep: int = 40

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
