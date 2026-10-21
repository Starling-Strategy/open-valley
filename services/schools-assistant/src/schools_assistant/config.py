"""Runtime settings. Secrets may come from the environment or from a file path."""

from __future__ import annotations

import ipaddress
from functools import cached_property
from pathlib import Path

from psycopg.conninfo import conninfo_to_dict
from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

RUNTIME_ROLE = "schools_runtime"
DEFAULT_EMBEDDING_MODEL = "baai/bge-m3"
DEFAULT_EMBEDDING_DIMS = 1024


class ConfigError(ValueError):
    """Raised for unusable configuration. Messages never contain secret values."""


def _secret(value: SecretStr | None, path: Path | None, name: str) -> str | None:
    if value is not None and path is not None:
        raise ConfigError(f"Set {name} or {name}_FILE, not both")
    if path is not None:
        try:
            text = path.read_text(encoding="utf-8").strip()
        except OSError as error:
            raise ConfigError(f"{name}_FILE is not readable") from error
        return text or None
    return value.get_secret_value().strip() or None if value is not None else None


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="", case_sensitive=False, extra="ignore")

    schools_database_url: SecretStr | None = None
    schools_database_url_file: Path | None = None
    openrouter_api_key: SecretStr | None = None
    openrouter_api_key_file: Path | None = None
    openrouter_base_url: str = "https://openrouter.ai/api/v1"

    # Chosen 2026-10-20 over Sonnet 5.5, GPT 6 Luna and DeepSeek V4.1 Flash on the 23-case eval:
    # highest pass rate, ~$0.0035 per answer (Sonnet: ~$0.27), p50 6.7 s. See README "Model choice".
    schools_assistant_model: str = "anthropic/claude-haiku-5.5"
    schools_assistant_embedding_model: str = DEFAULT_EMBEDDING_MODEL
    schools_unanswered_log_path: Path | None = None

    # Comma-separated IPs/CIDRs whose X-Forwarded-For header is trusted.
    schools_assistant_trusted_proxies: str = "127.0.0.1,::1"
    schools_assistant_rate_per_minute: float = Field(default=6.0, gt=0)
    schools_assistant_rate_burst: int = Field(default=4, ge=1)
    # Requests from a trusted proxy that carry no X-Forwarded-For share one separate, wider bucket
    # so they can neither impersonate a visitor nor throttle every visitor at once.
    schools_assistant_proxy_rate_per_minute: float = Field(default=60.0, gt=0)
    schools_assistant_proxy_rate_burst: int = Field(default=20, ge=1)
    # Questions that reach the model per UTC day, across all visitors. Guardrail declines don't count.
    schools_assistant_daily_limit: int = Field(default=500, ge=1)
    schools_assistant_max_concurrency: int = Field(default=4, ge=1)
    schools_assistant_answer_timeout_seconds: float = Field(default=45.0, gt=0)
    schools_assistant_model_request_timeout_seconds: float = Field(default=30.0, gt=0)
    schools_assistant_embedding_timeout_seconds: float = Field(default=8.0, gt=0)

    def validate_runtime(self) -> None:
        """Check secrets outside Pydantic validation so no error can echo their values."""
        url = self.database_url
        if url is None:
            raise ConfigError("Set SCHOOLS_DATABASE_URL or SCHOOLS_DATABASE_URL_FILE")
        try:
            user = conninfo_to_dict(url).get("user")
        except Exception:  # psycopg raises ProgrammingError for malformed strings
            raise ConfigError("SCHOOLS_DATABASE_URL is malformed") from None
        if user != RUNTIME_ROLE:
            raise ConfigError(f"The database connection must log in as {RUNTIME_ROLE}")
        self.trusted_proxy_networks  # noqa: B018 - validate eagerly
        self.openrouter_key  # noqa: B018 - an unreadable key file fails startup; a missing key degrades

    @cached_property
    def database_url(self) -> str | None:
        return _secret(self.schools_database_url, self.schools_database_url_file, "SCHOOLS_DATABASE_URL")

    @cached_property
    def openrouter_key(self) -> str | None:
        return _secret(self.openrouter_api_key, self.openrouter_api_key_file, "OPENROUTER_API_KEY")

    @cached_property
    def trusted_proxy_networks(self) -> tuple[ipaddress.IPv4Network | ipaddress.IPv6Network, ...]:
        networks = []
        for item in self.schools_assistant_trusted_proxies.split(","):
            if item.strip():
                try:
                    networks.append(ipaddress.ip_network(item.strip(), strict=False))
                except ValueError as error:
                    raise ConfigError("SCHOOLS_ASSISTANT_TRUSTED_PROXIES contains an invalid entry") from error
        return tuple(networks)
