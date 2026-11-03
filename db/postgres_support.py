import os
from pathlib import Path

from sqlalchemy.engine.url import make_url


ROOT = Path(__file__).resolve().parents[1]
LOCAL_ENV_PATH = ROOT / "backend" / ".env"


def postgres_migration_connection_string() -> str:
    local_values = {}
    try:
        lines = LOCAL_ENV_PATH.read_text(encoding="utf-8-sig").splitlines()
    except FileNotFoundError:
        lines = []

    for line in lines:
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "'\"":
            value = value[1:-1]
        local_values[key.strip().upper()] = value

    raw_url = (
        os.environ.get("POSTGRES_MIGRATION_URL")
        or local_values.get("POSTGRES_MIGRATION_URL")
    )
    if not raw_url:
        raise RuntimeError(
            "Set POSTGRES_MIGRATION_URL locally to a disposable PostgreSQL database. "
            "The application DATABASE_URL is not used."
        )

    url = make_url(raw_url)
    if url.get_backend_name() != "postgresql":
        raise ValueError("POSTGRES_MIGRATION_URL must use PostgreSQL.")
    return url.set(drivername="postgresql").render_as_string(hide_password=False)
