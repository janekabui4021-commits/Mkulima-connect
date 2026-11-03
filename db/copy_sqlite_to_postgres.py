import sqlite3
from collections.abc import Iterable
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path

import psycopg
from psycopg import sql

from postgres_support import postgres_migration_connection_string


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SQLITE_PATH = ROOT / "backend" / "mkulima.db"
BATCH_SIZE = 500


def _sqlite_tables(connection: sqlite3.Connection) -> list[str]:
    return [
        row[0]
        for row in connection.execute(
            """
            SELECT name
            FROM sqlite_master
            WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
            ORDER BY name
            """
        )
    ]


def _sqlite_columns(connection: sqlite3.Connection, table: str) -> list[str]:
    escaped_table = table.replace('"', '""')
    return [
        row[1]
        for row in connection.execute(f'PRAGMA table_info("{escaped_table}")')
    ]


def _postgres_schema(connection: psycopg.Connection) -> tuple[set[str], dict[str, dict[str, str]]]:
    rows = connection.execute(
        """
        SELECT table_name, column_name, data_type
        FROM information_schema.columns
        WHERE table_schema = 'public'
        ORDER BY table_name, ordinal_position
        """
    ).fetchall()
    columns: dict[str, dict[str, str]] = {}
    for table, column, data_type in rows:
        columns.setdefault(table, {})[column] = data_type
    return set(columns), columns


def _postgres_table_counts(
    connection: psycopg.Connection, tables: Iterable[str]
) -> dict[str, int]:
    counts = {}
    for table in tables:
        result = connection.execute(
            sql.SQL("SELECT COUNT(*) FROM {}.{}").format(
                sql.Identifier("public"), sql.Identifier(table)
            )
        ).fetchone()
        counts[table] = result[0]
    return counts


def _table_order(connection: psycopg.Connection, tables: set[str]) -> list[str]:
    dependencies = {table: set() for table in tables}
    foreign_keys = connection.execute(
        """
        SELECT kcu.table_name, ccu.table_name
        FROM information_schema.table_constraints AS tc
        JOIN information_schema.key_column_usage AS kcu
          ON kcu.constraint_catalog = tc.constraint_catalog
         AND kcu.constraint_schema = tc.constraint_schema
         AND kcu.constraint_name = tc.constraint_name
        JOIN information_schema.constraint_column_usage AS ccu
          ON ccu.constraint_catalog = tc.constraint_catalog
         AND ccu.constraint_schema = tc.constraint_schema
         AND ccu.constraint_name = tc.constraint_name
        WHERE tc.constraint_type = 'FOREIGN KEY'
          AND tc.table_schema = 'public'
          AND kcu.table_schema = 'public'
          AND ccu.table_schema = 'public'
        """
    ).fetchall()
    for table, referenced_table in foreign_keys:
        if table != referenced_table and table in tables and referenced_table in tables:
            dependencies[table].add(referenced_table)

    ordered = []
    while dependencies:
        ready = sorted(
            table for table, required in dependencies.items() if not required
        )
        if not ready:
            raise RuntimeError("PostgreSQL tables contain a foreign-key cycle.")
        for table in ready:
            ordered.append(table)
            del dependencies[table]
        for required in dependencies.values():
            required.difference_update(ready)
    return ordered


def _convert_value(value: object, data_type: str) -> object:
    if value is None:
        return None
    if data_type == "boolean":
        if isinstance(value, str):
            normalized = value.strip().lower()
            if normalized in {"1", "true", "t", "yes"}:
                return True
            if normalized in {"0", "false", "f", "no"}:
                return False
            raise ValueError(f"Cannot convert {value!r} to PostgreSQL boolean.")
        return bool(value)
    if data_type == "date" and isinstance(value, str):
        return date.fromisoformat(value)
    if data_type.startswith("timestamp") and isinstance(value, str):
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    if data_type in {"numeric", "real", "double precision"} and isinstance(
        value, (int, float)
    ):
        return Decimal(str(value))
    return value


def _copy_table(
    source: sqlite3.Connection,
    destination: psycopg.Connection,
    table: str,
    source_columns: list[str],
    postgres_columns: dict[str, str],
) -> int:
    escaped_table = table.replace('"', '""')
    order_by = ' ORDER BY "id"' if "id" in source_columns else ""
    select = source.execute(
        f'SELECT * FROM "{escaped_table}"{order_by}'
    )
    insert = sql.SQL("INSERT INTO {}.{} ({}) VALUES ({})").format(
        sql.Identifier("public"),
        sql.Identifier(table),
        sql.SQL(", ").join(sql.Identifier(column) for column in source_columns),
        sql.SQL(", ").join(sql.Placeholder() for _ in source_columns),
    )

    copied = 0
    with destination.cursor() as cursor:
        while batch := select.fetchmany(BATCH_SIZE):
            converted = [
                tuple(
                    _convert_value(value, postgres_columns[column])
                    for column, value in zip(source_columns, row, strict=True)
                )
                for row in batch
            ]
            cursor.executemany(insert, converted)
            copied += len(converted)
    return copied


def _reset_sequences(
    connection: psycopg.Connection,
    tables: Iterable[str],
    postgres_columns: dict[str, dict[str, str]],
) -> None:
    for table in tables:
        if "id" not in postgres_columns[table]:
            continue
        sequence = connection.execute(
            "SELECT pg_get_serial_sequence(%s, 'id')",
            (f"public.{table}",),
        ).fetchone()[0]
        if sequence:
            connection.execute(
                sql.SQL(
                    """
                    SELECT setval(
                        %s::regclass,
                        GREATEST(COALESCE(MAX(id), 1), 1),
                        COUNT(*) > 0
                    )
                    FROM {}.{}
                    """
                ).format(sql.Identifier("public"), sql.Identifier(table)),
                (sequence,),
            )


def copy_sqlite_to_postgres(sqlite_path: Path) -> dict[str, int]:
    if not sqlite_path.is_file():
        raise FileNotFoundError(f"SQLite database not found: {sqlite_path}")
    connection_string = postgres_migration_connection_string()
    source = sqlite3.connect(f"file:{sqlite_path.resolve()}?mode=ro", uri=True)
    try:
        source.execute("BEGIN")
        integrity = source.execute("PRAGMA integrity_check").fetchone()[0]
        if integrity != "ok":
            raise RuntimeError(f"SQLite integrity check failed: {integrity}")

        tables = _sqlite_tables(source)
        source_columns = {table: _sqlite_columns(source, table) for table in tables}
        expected_counts = {
            table: source.execute(
                f'SELECT COUNT(*) FROM "{table.replace(chr(34), chr(34) * 2)}"'
            ).fetchone()[0]
            for table in tables
        }

        with psycopg.connect(connection_string) as destination:
            destination.execute("SET TIME ZONE 'UTC'")
            postgres_tables, postgres_columns = _postgres_schema(destination)
            if set(tables) != postgres_tables:
                missing = sorted(set(tables) - postgres_tables)
                extra = sorted(postgres_tables - set(tables))
                raise RuntimeError(
                    f"Schema table mismatch; missing={missing}, extra={extra}."
                )

            for table in tables:
                source_names = set(source_columns[table])
                destination_names = set(postgres_columns[table])
                if source_names != destination_names:
                    missing = sorted(source_names - destination_names)
                    extra = sorted(destination_names - source_names)
                    raise RuntimeError(
                        f"Column mismatch in {table}; missing={missing}, extra={extra}."
                    )

            existing_counts = _postgres_table_counts(destination, tables)
            populated = {
                table: count for table, count in existing_counts.items() if count
            }
            if populated:
                raise RuntimeError(
                    "Refusing to copy into a non-empty PostgreSQL database: "
                    f"{populated}"
                )

            order = _table_order(destination, set(tables))
            for table in order:
                _copy_table(
                    source,
                    destination,
                    table,
                    source_columns[table],
                    postgres_columns[table],
                )
            _reset_sequences(destination, order, postgres_columns)

            actual_counts = _postgres_table_counts(destination, tables)
            if actual_counts != expected_counts:
                raise RuntimeError(
                    "Row counts do not match; "
                    f"SQLite={expected_counts}, PostgreSQL={actual_counts}."
                )
        return expected_counts
    finally:
        source.close()


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(
        description="Copy a SQLite database into an empty PostgreSQL database."
    )
    parser.add_argument(
        "sqlite_path",
        nargs="?",
        type=Path,
        default=DEFAULT_SQLITE_PATH,
        help="SQLite database to copy (defaults to backend/mkulima.db).",
    )
    args = parser.parse_args()
    counts = copy_sqlite_to_postgres(args.sqlite_path)
    print(f"Copied and verified {len(counts)} tables.")
    for table, count in sorted(counts.items()):
        print(f"{table}: {count}")
