from pathlib import Path

try:
    import psycopg  # type: ignore[import-not-found]
except ImportError as exc:
    raise RuntimeError(
        "psycopg is required to initialize PostgreSQL. "
        "Install it with `pip install psycopg[binary]`."
    ) from exc

from postgres_support import postgres_migration_connection_string


ROOT = Path(__file__).resolve().parents[1]
SCHEMA_PATH = ROOT / "db" / "schema.sql"
MIGRATIONS_PATH = ROOT / "db" / "migrations"
REQUIRED_TABLES = {
    "admin_audit_logs",
    "buyer_crop_demands",
    "content_reports",
    "marketplace_settings",
    "offtake_quotes",
    "orders",
    "products",
    "users",
}


def initialize_empty_database() -> list[str]:
    migrations = sorted(MIGRATIONS_PATH.glob("*.sql"))
    if not migrations:
        raise RuntimeError(f"No PostgreSQL migrations found in {MIGRATIONS_PATH}.")
    connection_string = postgres_migration_connection_string()

    with psycopg.connect(connection_string) as connection:
        existing_tables = connection.execute(
            """
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
            ORDER BY table_name
            """
        ).fetchall()
        if existing_tables:
            names = [row[0] for row in existing_tables]
            raise RuntimeError(
                "Refusing to initialize a database that already has tables: "
                f"{names}"
            )

        connection.execute("SET TIME ZONE 'UTC'")
        connection.execute(SCHEMA_PATH.read_text(encoding="utf-8"), prepare=False)
        for migration in migrations:
            connection.execute(migration.read_text(encoding="utf-8"), prepare=False)

        created_tables = {
            row[0]
            for row in connection.execute(
                """
                SELECT table_name
                FROM information_schema.tables
                WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
                """
            ).fetchall()
        }
        missing_tables = sorted(REQUIRED_TABLES - created_tables)
        if missing_tables:
            raise RuntimeError(
                f"PostgreSQL schema is incomplete; missing tables: {missing_tables}"
            )
    return [migration.name for migration in migrations]


if __name__ == "__main__":
    applied = initialize_empty_database()
    print(f"Initialized PostgreSQL with schema.sql and {len(applied)} migrations.")
    for migration in applied:
        print(migration)
