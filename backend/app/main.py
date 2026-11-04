import base64
import hashlib
import hmac
import json
import logging
import math
import os
import re
import secrets
import sqlite3
import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
from typing import Literal
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from zoneinfo import ZoneInfo

import httpx  # pyright: ignore[reportMissingImports]
from fastapi import BackgroundTasks, Depends, FastAPI, File, Form, HTTPException, Request, UploadFile  # pyright: ignore[reportMissingImports]
from fastapi.middleware.cors import CORSMiddleware  # pyright: ignore[reportMissingImports]
from fastapi.responses import FileResponse  # pyright: ignore[reportMissingImports]
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer  # pyright: ignore[reportMissingImports]
from pydantic import BaseModel, Field, ValidationError, field_validator, model_validator  # pyright: ignore[reportMissingImports]
from sqlalchemy import create_engine, text  # pyright: ignore[reportMissingImports]
from sqlalchemy.exc import SQLAlchemyError  # pyright: ignore[reportMissingImports]
from sqlalchemy.engine.url import make_url  # pyright: ignore[reportMissingImports]

from .ai_advisor import evaluate_produce_freshness


backend_dir = Path(__file__).resolve().parent.parent
private_farm_video_dir = backend_dir / "private_uploads" / "farm_verification"
product_image_dir = backend_dir / "product_images"
max_farm_video_bytes = 40 * 1024 * 1024
max_product_image_bytes = 5 * 1024 * 1024


def SettingsConfigDict(**kwargs):
    return kwargs


class BaseSettings(BaseModel):
    """Small pydantic-settings fallback for environments lacking that package."""

    def __init__(self, **values):
        config = getattr(type(self), "model_config", {})
        env_values = {}
        env_file = config.get("env_file")
        if env_file:
            try:
                for line in Path(env_file).read_text(encoding="utf-8-sig").splitlines():
                    line = line.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    name, value = line.split("=", 1)
                    name = name.strip().removeprefix("export ")
                    value = value.strip()
                    if len(value) >= 2 and value[0] == value[-1] and value[0] in "'\"":
                        value = value[1:-1]
                    env_values[name.lower()] = value
            except OSError:
                pass

        for name in type(self).model_fields:
            if name.lower() in env_values:
                env_values[name] = env_values[name.lower()]
            if name.upper() in os.environ:
                env_values[name] = os.environ[name.upper()]
            elif name in os.environ:
                env_values[name] = os.environ[name]
        env_values.update(values)
        super().__init__(**env_values)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=backend_dir / ".env")

    database_url: str = "sqlite:///./mkulima.db"
    daraja_environment: Literal["sandbox", "production"] = "sandbox"
    daraja_key: str = ""
    daraja_secret: str = ""
    shortcode: str = "174379"
    passkey: str = ""
    daraja_callback_secret: str = ""
    callback_url: str = "https://example.com/api/payments/mpesa/callback"
    auth_secret: str = ""
    admin_bootstrap_token: str = ""
    africastalking_username: str = ""
    africastalking_api_key: str = ""
    africastalking_sender_id: str = ""
    africastalking_environment: Literal["sandbox", "production"] = "sandbox"


settings = Settings()
logger = logging.getLogger("mkulima")
if not settings.auth_secret:
    settings.auth_secret = secrets.token_urlsafe(48)
    logger.warning("AUTH_SECRET is unset; issued tokens will expire after an API restart.")
database_url = make_url(settings.database_url)
if (
    database_url.get_backend_name() == "sqlite"
    and database_url.database
    and database_url.database != ":memory:"
    and not Path(database_url.database).is_absolute()
):
    database_url = database_url.set(
        database=str((backend_dir / database_url.database).resolve())
    )
engine = create_engine(
    database_url,
    connect_args={"check_same_thread": False}
    if database_url.get_backend_name() == "sqlite"
    else {},
)


def initialize_sqlite_database() -> None:
    if engine.dialect.name != "sqlite":
        return

    database_path = Path(engine.url.database or backend_dir / "mkulima.db")
    if database_path.parent != Path("."):
        database_path.parent.mkdir(parents=True, exist_ok=True)
    app_dir = Path(__file__).resolve().parent
    with sqlite3.connect(database_path) as connection:
        connection.execute("PRAGMA foreign_keys = ON")
        connection.executescript(
            (app_dir / "sqlite_schema.sql").read_text(encoding="utf-8")
        )
        for table in (
            "farm_documents",
            "contact_verification_codes",
            "password_reset_codes",
            "phone_verification_codes",
            "push_subscriptions",
            "conversation_sms_codes",
        ):
            connection.execute(f"DROP TABLE IF EXISTS {table}")
        legacy_user_columns = {
            row[1] for row in connection.execute("PRAGMA table_info(users)")
        }
        for column in (
            "contact_verified",
            "sms_notifications_enabled",
            "sms_consent_at",
            "session_version",
        ):
            if column in legacy_user_columns:
                connection.execute(f"ALTER TABLE users DROP COLUMN {column}")
        legacy_user_columns = {
            row[1] for row in connection.execute("PRAGMA table_info(users)")
        }
        if "account_status" not in legacy_user_columns:
            connection.execute(
                "ALTER TABLE users ADD COLUMN account_status TEXT NOT NULL DEFAULT 'active'"
            )
        for column, declaration in (
            ("phone_verified", "INTEGER NOT NULL DEFAULT 0"),
            ("token_version", "INTEGER NOT NULL DEFAULT 0"),
        ):
            if column not in legacy_user_columns:
                connection.execute(
                    f"ALTER TABLE users ADD COLUMN {column} {declaration}"
                )
                legacy_user_columns.add(column)
        users_schema = connection.execute(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'"
        ).fetchone()
        if users_schema is None:
            raise RuntimeError("SQLite users table was not initialized")
        status_constraint = re.search(
            r"account_status\s+TEXT[^,]*CHECK\s*\(\s*account_status\s+IN\s*\(([^)]*)\)",
            users_schema[0],
            re.IGNORECASE,
        )
        configured_statuses = (
            set(re.findall(r"'([^']+)'", status_constraint.group(1)))
            if status_constraint
            else set()
        )
        if configured_statuses != {"active", "suspended", "pending", "disabled"}:
            connection.commit()
            connection.execute("PRAGMA foreign_keys = OFF")
            connection.execute("BEGIN")
            connection.execute(
                """
                CREATE TABLE users_new (
                    id INTEGER PRIMARY KEY,
                    name TEXT NOT NULL,
                    phone TEXT UNIQUE NOT NULL,
                    email TEXT UNIQUE,
                    password_hash TEXT NOT NULL,
                    role TEXT NOT NULL CHECK (role IN ('farmer', 'buyer', 'admin')),
                    phone_verified INTEGER NOT NULL DEFAULT 0,
                    account_status TEXT NOT NULL DEFAULT 'active'
                        CHECK (account_status IN ('active', 'suspended', 'pending', 'disabled')),
                    token_version INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
            connection.execute(
                """
                INSERT INTO users_new
                    (id, name, phone, email, password_hash, role, phone_verified,
                     account_status, token_version, created_at)
                SELECT id, name, phone, email, password_hash, role, phone_verified,
                       account_status, token_version, created_at
                FROM users
                """
            )
            connection.execute("DROP TABLE users")
            connection.execute("ALTER TABLE users_new RENAME TO users")
            connection.commit()
            connection.execute("PRAGMA foreign_keys = ON")
            foreign_key_errors = connection.execute("PRAGMA foreign_key_check").fetchall()
            if foreign_key_errors:
                raise RuntimeError(
                    f"SQLite foreign-key check failed after users migration: {foreign_key_errors}"
                )
        migrations = {
            "users": {
                "account_status": "TEXT NOT NULL DEFAULT 'active'",
                "phone_verified": "INTEGER NOT NULL DEFAULT 0",
                "token_version": "INTEGER NOT NULL DEFAULT 0",
            },
            "farms": {
                "latitude": "NUMERIC",
                "longitude": "NUMERIC",
                "farming_methods": "TEXT NOT NULL DEFAULT ''",
                "admin_suspended": "INTEGER NOT NULL DEFAULT 0",
                "verification_level": "TEXT NOT NULL DEFAULT 'full'",
                "farm_boundary": "TEXT",
                "verification_video_path": "TEXT",
                "verification_video_latitude": "NUMERIC",
                "verification_video_longitude": "NUMERIC",
                "verification_video_accuracy_m": "NUMERIC",
                "verification_video_recorded_at": "TEXT",
                "verification_code": "TEXT",
                "verification_submitted_at": "TEXT",
            },
            "products": {
                "description": "TEXT NOT NULL DEFAULT ''",
                "category": "TEXT NOT NULL DEFAULT 'Other'",
                "variety": "TEXT NOT NULL DEFAULT 'Standard'",
                "grade": "TEXT NOT NULL DEFAULT 'Grade A'",
                "image_url": "TEXT",
                "preorder_enabled": "INTEGER NOT NULL DEFAULT 0",
                "season_tier": "TEXT NOT NULL DEFAULT 'in_season'",
                "admin_suspended": "INTEGER NOT NULL DEFAULT 0",
                "trace_code": "TEXT",
            },
            "farmer_groups": {
                "admin_suspended": "INTEGER NOT NULL DEFAULT 0",
            },
            "order_items": {
                "fulfillment_status": "TEXT NOT NULL DEFAULT 'pending'",
            },
            "buyer_crop_demands": {
                "variety": "TEXT NOT NULL DEFAULT ''",
                "request_type": "TEXT NOT NULL DEFAULT 'preorder'",
                "recurrence": "TEXT NOT NULL DEFAULT 'one_off'",
                "needed_by": "TEXT",
                "delivery_location": "TEXT NOT NULL DEFAULT ''",
                "delivery_method": "TEXT NOT NULL DEFAULT 'delivery'",
                "quality_notes": "TEXT NOT NULL DEFAULT ''",
                "buyer_name": "TEXT NOT NULL DEFAULT ''",
                "business_name": "TEXT NOT NULL DEFAULT ''",
                "buyer_phone": "TEXT NOT NULL DEFAULT ''",
                "buyer_email": "TEXT NOT NULL DEFAULT ''",
                "farm_id": "INTEGER REFERENCES farms(id)",
            },
            "reviews": {
                "quality_rating": "INTEGER NOT NULL DEFAULT 5",
                "delivery_speed_rating": "INTEGER NOT NULL DEFAULT 5",
            },
            "conversation_messages": {
                "provider_message_id": "TEXT",
            },
        }
        for table, columns in migrations.items():
            existing_columns = {
                row[1] for row in connection.execute(f"PRAGMA table_info({table})")
            }
            migrate_legacy_rating = (
                table == "reviews"
                and "rating" in existing_columns
                and "quality_rating" not in existing_columns
            )
            for column, definition in columns.items():
                if column not in existing_columns:
                    connection.execute(
                        f"ALTER TABLE {table} ADD COLUMN {column} {definition}"
                    )
            if migrate_legacy_rating:
                connection.execute(
                    """
                    UPDATE reviews
                    SET quality_rating = rating,
                        delivery_speed_rating = rating
                    WHERE rating IS NOT NULL
                    """
                )
        message_indexes = connection.execute(
            "PRAGMA index_list(conversation_messages)"
        ).fetchall()
        has_unique_provider_message_id = any(
            index[2]
            and [
                column[2]
                for column in connection.execute(
                    f"PRAGMA index_info({index[1]})"
                )
            ]
            == ["provider_message_id"]
            for index in message_indexes
        )
        if not has_unique_provider_message_id:
            connection.execute(
                """
                CREATE UNIQUE INDEX IF NOT EXISTS
                    idx_conversation_messages_provider_message_id
                ON conversation_messages (provider_message_id)
                """
            )
        products_schema = connection.execute(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'products'"
        ).fetchone()
        if products_schema is None:
            raise RuntimeError("SQLite products table was not initialized")
        has_variety_unique = re.search(
            r"UNIQUE\s*\(\s*farm_id\s*,\s*name\s*,\s*unit\s*,\s*variety\s*\)",
            products_schema[0],
            re.IGNORECASE,
        )
        if not has_variety_unique:
            connection.commit()
            connection.execute("PRAGMA foreign_keys = OFF")
            connection.execute("BEGIN")
            connection.execute(
                """
                CREATE TABLE products_new (
                    id INTEGER PRIMARY KEY,
                    farm_id INTEGER REFERENCES farms(id) ON DELETE CASCADE,
                    name TEXT NOT NULL,
                    description TEXT NOT NULL DEFAULT '',
                    category TEXT NOT NULL DEFAULT 'Other',
                    variety TEXT NOT NULL DEFAULT 'Standard',
                    grade TEXT NOT NULL DEFAULT 'Grade A',
                    unit TEXT DEFAULT 'kg',
                    price_kes NUMERIC NOT NULL,
                    stock NUMERIC NOT NULL,
                    harvest_date TEXT,
                    image_url TEXT,
                    preorder_enabled INTEGER NOT NULL DEFAULT 0 CHECK (preorder_enabled IN (0, 1)),
                    season_tier TEXT NOT NULL DEFAULT 'in_season' CHECK (
                        season_tier IN ('early', 'peak', 'late', 'in_season')
                    ),
                    admin_suspended INTEGER NOT NULL DEFAULT 0 CHECK (admin_suspended IN (0, 1)),
                    trace_code TEXT UNIQUE,
                    UNIQUE (farm_id, name, unit, variety)
                )
                """
            )
            connection.execute(
                """
                INSERT INTO products_new
                    (id, farm_id, name, description, category, variety, grade, unit,
                     price_kes, stock, harvest_date, image_url, preorder_enabled, season_tier,
                     admin_suspended, trace_code)
                SELECT id, farm_id, name, description, category, variety, grade, unit,
                       price_kes, stock, harvest_date, image_url, preorder_enabled, season_tier,
                       admin_suspended, trace_code
                FROM products
                """
            )
            connection.execute("DROP TABLE products")
            connection.execute("ALTER TABLE products_new RENAME TO products")
            connection.commit()
            connection.execute("PRAGMA foreign_keys = ON")
            foreign_key_errors = connection.execute("PRAGMA foreign_key_check").fetchall()
            if foreign_key_errors:
                raise RuntimeError(
                    f"SQLite foreign-key check failed after products migration: {foreign_key_errors}"
                )
        connection.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_products_trace_code ON products(trace_code)"
        )
        connection.execute(
            """
            UPDATE farms
            SET latitude = CASE county
                    WHEN 'Kiambu' THEN -1.1714
                    WHEN 'Meru' THEN -0.0467
                    WHEN 'Nakuru' THEN -0.3031
                    WHEN 'Kisii' THEN -0.6810
                    WHEN 'Uasin Gishu' THEN 0.5143
                    WHEN 'Nyandarua' THEN -0.2708
                    WHEN 'Kirinyaga' THEN -0.4989
                END,
                longitude = CASE county
                    WHEN 'Kiambu' THEN 36.8356
                    WHEN 'Meru' THEN 37.6559
                    WHEN 'Nakuru' THEN 36.0800
                    WHEN 'Kisii' THEN 34.7660
                    WHEN 'Uasin Gishu' THEN 35.2698
                    WHEN 'Nyandarua' THEN 36.3792
                    WHEN 'Kirinyaga' THEN 37.2803
                END
            WHERE latitude IS NULL OR longitude IS NULL
            """
        )
        connection.executescript(
            (app_dir / "sqlite_seed.sql").read_text(encoding="utf-8")
        )
        for (product_id,) in connection.execute(
            "SELECT id FROM products WHERE trace_code IS NULL"
        ).fetchall():
            connection.execute(
                "UPDATE products SET trace_code = ? WHERE id = ?",
                (uuid.uuid4().hex, product_id),
            )


initialize_sqlite_database()


def initialize_postgresql_offtake_schema() -> None:
    if engine.dialect.name != "postgresql":
        return
    demand_columns = {
        "variety": "TEXT NOT NULL DEFAULT ''",
        "request_type": "TEXT NOT NULL DEFAULT 'preorder'",
        "recurrence": "TEXT NOT NULL DEFAULT 'one_off'",
        "needed_by": "DATE",
        "delivery_location": "TEXT NOT NULL DEFAULT ''",
        "delivery_method": "TEXT NOT NULL DEFAULT 'delivery'",
        "quality_notes": "TEXT NOT NULL DEFAULT ''",
        "buyer_name": "TEXT NOT NULL DEFAULT ''",
        "business_name": "TEXT NOT NULL DEFAULT ''",
        "buyer_phone": "TEXT NOT NULL DEFAULT ''",
        "buyer_email": "TEXT NOT NULL DEFAULT ''",
        "farm_id": "INTEGER REFERENCES farms(id)",
    }
    with engine.begin() as connection:
        for column, definition in demand_columns.items():
            connection.execute(
                text(
                    "ALTER TABLE buyer_crop_demands "
                    f"ADD COLUMN IF NOT EXISTS {column} {definition}"
                )
            )
        connection.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS offtake_quotes (
                    id SERIAL PRIMARY KEY,
                    demand_id INTEGER NOT NULL
                        REFERENCES buyer_crop_demands(id) ON DELETE CASCADE,
                    farmer_id INTEGER NOT NULL REFERENCES users(id),
                    farm_id INTEGER NOT NULL REFERENCES farms(id),
                    product_id INTEGER REFERENCES products(id),
                    quantity NUMERIC NOT NULL CHECK (quantity > 0),
                    unit TEXT NOT NULL,
                    unit_price_kes NUMERIC NOT NULL CHECK (unit_price_kes > 0),
                    quality_notes TEXT NOT NULL DEFAULT '',
                    delivery_location TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'quoted' CHECK (
                        status IN ('quoted', 'countered', 'accepted', 'declined',
                                   'cancelled', 'fulfilled', 'expired')
                    ),
                    order_id INTEGER REFERENCES orders(id),
                    supersedes_quote_id INTEGER REFERENCES offtake_quotes(id),
                    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
                    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
        )
        connection.execute(
            text(
                "CREATE INDEX IF NOT EXISTS idx_offtake_quotes_demand "
                "ON offtake_quotes (demand_id, status, created_at)"
            )
        )
        connection.execute(
            text(
                "CREATE INDEX IF NOT EXISTS idx_offtake_quotes_farmer "
                "ON offtake_quotes (farmer_id, status, created_at)"
            )
        )


initialize_postgresql_offtake_schema()
app = FastAPI(title="Mkulima Connect API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

bearer = HTTPBearer(auto_error=False)


class AuthenticatedUser(BaseModel):
    id: int
    name: str
    email: str
    role: Literal["buyer", "farmer", "admin"]


def _require_active_account(account_status: str) -> None:
    if account_status == "active":
        return
    status_messages = {
        "suspended": "This account has been suspended",
        "pending": "This account is pending verification",
        "disabled": "This account has been disabled",
    }
    raise HTTPException(
        status_code=403,
        detail=status_messages.get(account_status, "This account is not active"),
    )


def _b64encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def _b64decode(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def _password_hash(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(
        password.encode("utf-8"), salt=salt, n=2**14, r=8, p=1
    )
    return f"scrypt${_b64encode(salt)}${_b64encode(digest)}"


def _password_matches(password: str, stored_hash: str) -> bool:
    try:
        algorithm, salt_text, digest_text = stored_hash.split("$", 2)
        if algorithm != "scrypt":
            return False
        expected = _b64decode(digest_text)
        actual = hashlib.scrypt(
            password.encode("utf-8"), salt=_b64decode(salt_text),
            n=2**14, r=8, p=1, dklen=len(expected),
        )
        return secrets.compare_digest(actual, expected)
    except (ValueError, TypeError):
        return False


def _issue_token(user: AuthenticatedUser, token_version: int = 0) -> str:
    now = int(datetime.now().timestamp())
    header = _b64encode(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
    payload = _b64encode(
        json.dumps(
            {
                "sub": user.id,
                "role": user.role,
                "ver": token_version,
                "iat": now,
                "exp": now + 60 * 60 * 12,
            }
        ).encode()
    )
    content = f"{header}.{payload}"
    signature = hmac.new(
        settings.auth_secret.encode(), content.encode(), hashlib.sha256
    ).digest()
    return f"{content}.{_b64encode(signature)}"


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
) -> AuthenticatedUser:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(status_code=401, detail="Sign in to continue")
    try:
        header, payload, signature = credentials.credentials.split(".")
        content = f"{header}.{payload}"
        expected = hmac.new(
            settings.auth_secret.encode(), content.encode(), hashlib.sha256
        ).digest()
        if not secrets.compare_digest(_b64decode(signature), expected):
            raise ValueError("Invalid signature")
        claims = json.loads(_b64decode(payload))
        if int(claims["exp"]) <= int(datetime.now().timestamp()):
            raise ValueError("Expired token")
        user_id = int(claims["sub"])
        token_version = int(claims.get("ver", 0))
    except (ValueError, KeyError, TypeError, json.JSONDecodeError):
        raise HTTPException(status_code=401, detail="Invalid or expired session")
    user = rows(
        """
        SELECT id, name, email, role, account_status, token_version FROM users
        WHERE id = :user_id AND email IS NOT NULL AND password_hash LIKE 'scrypt$%'
        """,
        user_id=user_id,
    )
    if not user:
        raise HTTPException(status_code=401, detail="Account is unavailable")
    if token_version != int(user[0]["token_version"]):
        raise HTTPException(status_code=401, detail="Session has expired; sign in again")
    _require_active_account(str(user[0]["account_status"]))
    return AuthenticatedUser(**{key: user[0][key] for key in ("id", "name", "email", "role")})


def require_role(*roles: str):
    def role_dependency(
        current_user: AuthenticatedUser = Depends(get_current_user),
    ) -> AuthenticatedUser:
        if current_user.role not in roles:
            raise HTTPException(status_code=403, detail="Your account role cannot perform this action")
        return current_user

    return role_dependency


def _owned_verified_farm(farm_id: int, farmer: AuthenticatedUser) -> None:
    if not rows(
        """
        SELECT id FROM farms
        WHERE id = :farm_id AND owner_id = :owner_id AND status = 'verified'
          AND admin_suspended = FALSE
        """,
        farm_id=farm_id,
        owner_id=farmer.id,
    ):
        raise HTTPException(status_code=403, detail="Farm is not assigned and verified for this account")


def _provisional_listing_limit(farm_id: int, connection) -> None:
    level = connection.execute(
        text("SELECT verification_level FROM farms WHERE id = :farm_id"),
        {"farm_id": farm_id},
    ).scalar()
    if level == "provisional":
        active_count = connection.execute(
            text(
                """
                SELECT COUNT(*) FROM products
                WHERE farm_id = :farm_id AND stock > 0 AND admin_suspended = FALSE
                """
            ),
            {"farm_id": farm_id},
        ).scalar_one()
        if active_count >= 3:
            raise HTTPException(
                status_code=403,
                detail="Provisionally verified farms can have up to 3 active listings",
            )


def _normalize_phone(phone: str) -> str:
    cleaned = re.sub(r"[\s().-]", "", phone)
    if cleaned.startswith("00"):
        cleaned = "+" + cleaned[2:]
    if cleaned.startswith("0") and len(cleaned) == 10:
        cleaned = "+254" + cleaned[1:]
    elif cleaned.startswith("254") and len(cleaned) == 12:
        cleaned = "+" + cleaned
    if not re.fullmatch(r"\+[1-9]\d{7,14}", cleaned):
        raise HTTPException(
            status_code=400,
            detail="Use a valid international phone number, such as +254712345678",
        )
    return cleaned


def _otp_hash(user_id: int, code: str) -> str:
    return hmac.new(
        settings.auth_secret.encode(),
        f"farmer-otp:{user_id}:{code}".encode(),
        hashlib.sha256,
    ).hexdigest()


def _send_otp_sms(phone: str, message: str, purpose: str) -> None:
    if not settings.africastalking_username or not settings.africastalking_api_key:
        raise HTTPException(
            status_code=503,
            detail=(
                "SMS delivery is unavailable until Africa's Talking credentials "
                "are configured"
            ),
        )
    form_data = {
        "username": settings.africastalking_username,
        "to": phone,
        "message": message,
    }
    if settings.africastalking_sender_id:
        form_data["from"] = settings.africastalking_sender_id
    api_host = (
        "https://api.africastalking.com"
        if settings.africastalking_environment == "production"
        else "https://api.sandbox.africastalking.com"
    )
    try:
        response = httpx.post(
            f"{api_host}/version1/messaging",
            data=form_data,
            headers={"apiKey": settings.africastalking_api_key, "Accept": "application/json"},
            timeout=10,
        )
        response.raise_for_status()
        payload = response.json()
        if not isinstance(payload, dict):
            raise ValueError("The SMS provider returned an invalid response")
        message_data = payload.get("SMSMessageData")
        delivery = message_data.get("Recipients") if isinstance(message_data, dict) else None
        if (
            not isinstance(delivery, list)
            or not delivery
            or not isinstance(delivery[0], dict)
            or str(delivery[0].get("statusCode")) != "101"
        ):
            raise ValueError("The SMS provider did not confirm delivery")
    except (httpx.HTTPError, ValueError, KeyError) as error:
        logger.warning("Africa's Talking could not deliver %s SMS: %s", purpose, error)
        raise HTTPException(
            status_code=502,
            detail="Could not deliver the code. Please try again.",
        ) from error


def _send_farmer_otp(phone: str, code: str) -> None:
    _send_otp_sms(
        phone,
        f"Your Mkulima Connect verification code is {code}. It expires in 10 minutes.",
        "farmer verification",
    )


def _send_password_reset_otp(phone: str, code: str) -> None:
    _send_otp_sms(
        phone,
        (
            f"Your Mkulima Connect password reset code is {code}. "
            "It expires in 10 minutes. If you did not request this, ignore this message."
        ),
        "password reset",
    )


def _send_farmer_message_sms(phone: str, message: str) -> str:
    if not settings.africastalking_username and not settings.africastalking_api_key:
        return "unavailable"
    if not settings.africastalking_username or not settings.africastalking_api_key:
        logger.warning("Farmer message SMS is unavailable because Africa's Talking is misconfigured")
        return "failed"
    form_data = {
        "username": settings.africastalking_username,
        "to": phone,
        "message": message,
    }
    if settings.africastalking_sender_id:
        form_data["from"] = settings.africastalking_sender_id
    api_host = (
        "https://api.africastalking.com"
        if settings.africastalking_environment == "production"
        else "https://api.sandbox.africastalking.com"
    )
    try:
        response = httpx.post(
            f"{api_host}/version1/messaging",
            data=form_data,
            headers={
                "apiKey": settings.africastalking_api_key,
                "Accept": "application/json",
            },
            timeout=10,
        )
        response.raise_for_status()
        payload = response.json()
        message_data = payload.get("SMSMessageData") if isinstance(payload, dict) else None
        recipients = message_data.get("Recipients") if isinstance(message_data, dict) else None
        if (
            not isinstance(recipients, list)
            or not recipients
            or not isinstance(recipients[0], dict)
            or str(recipients[0].get("statusCode")) != "101"
        ):
            raise ValueError("Africa's Talking did not confirm delivery")
    except (httpx.HTTPError, ValueError) as error:
        logger.warning("Africa's Talking could not deliver a farmer message notification: %s", error)
        return "failed"
    return "sent"


class RegistrationRequest(BaseModel):
    name: str = Field(min_length=2, max_length=100)
    email: str = Field(min_length=5, max_length=254)
    phone: str = Field(min_length=7, max_length=30)
    password: str = Field(min_length=12, max_length=128)
    role: Literal["buyer", "farmer"]

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        value = value.strip().lower()
        if "@" not in value or value.startswith("@") or value.endswith("@"):
            raise ValueError("Enter a valid email address")
        return value


def _create_account(
    name: str,
    email: str,
    phone: str,
    password: str,
    role: str,
):
    with engine.begin() as connection:
        existing = connection.execute(
            text("SELECT id FROM users WHERE lower(email) = :email OR phone = :phone"),
            {"email": email, "phone": phone},
        ).first()
        if existing:
            raise HTTPException(status_code=409, detail="Email or phone is already registered")
        user_id = connection.execute(
            text(
                """
                INSERT INTO users
                    (name, email, phone, password_hash, role)
                VALUES
                    (:name, :email, :phone, :password_hash, :role)
                RETURNING id
                """
            ),
            {
                "name": name.strip(),
                "email": email,
                "phone": phone.strip(),
                "password_hash": _password_hash(password),
                "role": role,
            },
        ).scalar()
    user = AuthenticatedUser(
        id=user_id,
        name=name.strip(),
        email=email,
        role=role,
    )
    return {"access_token": _issue_token(user), "token_type": "bearer", "user": user}


@app.post("/api/auth/register")
def register(request: RegistrationRequest):
    return _create_account(
        request.name,
        request.email,
        request.phone,
        request.password,
        request.role,
    )


class LoginRequest(BaseModel):
    email: str
    password: str


@app.post("/api/auth/login")
def login(request: LoginRequest):
    user = rows(
        """
        SELECT id, name, email, role, password_hash, account_status, token_version
        FROM users WHERE lower(email) = :email
        """,
        email=request.email.strip().lower(),
    )
    if (
        not user
        or not _password_matches(request.password, user[0]["password_hash"])
    ):
        raise HTTPException(status_code=401, detail="Email or password is incorrect")
    _require_active_account(str(user[0]["account_status"]))
    authenticated = AuthenticatedUser(**{key: user[0][key] for key in ("id", "name", "email", "role")})
    return {
        "access_token": _issue_token(authenticated, int(user[0]["token_version"])),
        "token_type": "bearer",
        "user": authenticated,
    }


class PasswordResetRequest(BaseModel):
    email: str = Field(min_length=5, max_length=254)
    phone: str = Field(min_length=7, max_length=30)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        normalized = value.strip().lower()
        if "@" not in normalized or normalized.startswith("@") or normalized.endswith("@"):
            raise ValueError("Enter a valid email address")
        return normalized

    @field_validator("phone")
    @classmethod
    def normalize_phone(cls, value: str) -> str:
        try:
            return _normalize_phone(value)
        except HTTPException as error:
            raise ValueError(error.detail) from error


class PasswordResetConfirm(PasswordResetRequest):
    code: str = Field(pattern=r"^\d{6}$")
    new_password: str = Field(min_length=12, max_length=128)


def _password_reset_otp_hash(user_id: int, code: str) -> str:
    return hmac.new(
        settings.auth_secret.encode(),
        f"password-reset-otp:{user_id}:{code}".encode(),
        hashlib.sha256,
    ).hexdigest()


def _as_utc_datetime(value: datetime | str) -> datetime:
    parsed = datetime.fromisoformat(value) if isinstance(value, str) else value
    return parsed.replace(tzinfo=timezone.utc) if parsed.tzinfo is None else parsed


@app.post("/api/auth/password-reset/request")
def request_password_reset(request: PasswordResetRequest):
    if not settings.africastalking_username or not settings.africastalking_api_key:
        raise HTTPException(
            status_code=503,
            detail="SMS password recovery is unavailable until Africa's Talking is configured.",
        )

    user = rows(
        """
        SELECT id, phone FROM users
        WHERE lower(email) = :email AND email IS NOT NULL
          AND password_hash LIKE 'scrypt$%'
        """,
        email=request.email,
    )
    if user:
        try:
            phone = _normalize_phone(str(user[0]["phone"]))
        except HTTPException:
            phone = ""
        if phone and secrets.compare_digest(phone, request.phone):
            user_id = int(user[0]["id"])
            previous = rows(
                "SELECT last_sent_at FROM password_reset_otps WHERE user_id = :user_id",
                user_id=user_id,
            )
            now = datetime.now(timezone.utc)
            if not previous or now - _as_utc_datetime(previous[0]["last_sent_at"]) >= timedelta(seconds=60):
                code = f"{secrets.randbelow(1_000_000):06d}"
                _send_password_reset_otp(phone, code)
                with engine.begin() as connection:
                    connection.execute(
                        text(
                            """
                            INSERT INTO password_reset_otps
                                (user_id, phone, code_hash, expires_at, attempts, last_sent_at)
                            VALUES
                                (:user_id, :phone, :code_hash, :expires_at, 0, :last_sent_at)
                            ON CONFLICT (user_id) DO UPDATE SET
                                phone = excluded.phone,
                                code_hash = excluded.code_hash,
                                expires_at = excluded.expires_at,
                                attempts = 0,
                                last_sent_at = excluded.last_sent_at
                            """
                        ),
                        {
                            "user_id": user_id,
                            "phone": phone,
                            "code_hash": _password_reset_otp_hash(user_id, code),
                            "expires_at": (now + timedelta(minutes=10)).isoformat(),
                            "last_sent_at": now.isoformat(),
                        },
                    )

    return {
        "ok": True,
        "message": "If the details match an account, a code has been sent to its registered phone.",
    }


@app.post("/api/auth/password-reset/confirm")
def confirm_password_reset(request: PasswordResetConfirm):
    failure_status = 400
    failure_detail = "The code or account details are invalid or expired."
    with engine.begin() as connection:
        user = connection.execute(
            text(
                """
                SELECT id, phone FROM users
                WHERE lower(email) = :email
                  AND email IS NOT NULL AND password_hash LIKE 'scrypt$%'
                """
            ),
            {"email": request.email},
        ).first()
        stored_phone = ""
        if user is not None:
            try:
                stored_phone = _normalize_phone(str(user.phone))
            except HTTPException:
                pass
        if user is None or not stored_phone or not secrets.compare_digest(stored_phone, request.phone):
            user = None
        otp = None
        if user is not None:
            otp = connection.execute(
                text(
                    """
                    SELECT phone, code_hash, expires_at, attempts
                    FROM password_reset_otps WHERE user_id = :user_id
                    """
                ),
                {"user_id": user.id},
            ).first()
        if otp is not None and int(otp.attempts) >= 5:
            failure_status = 429
            failure_detail = "Too many incorrect codes. Request a new code."
        elif otp is not None and datetime.now(timezone.utc) >= _as_utc_datetime(otp.expires_at):
            connection.execute(
                text("DELETE FROM password_reset_otps WHERE user_id = :user_id"),
                {"user_id": user.id},
            )
        elif otp is not None and not secrets.compare_digest(str(otp.phone), request.phone):
            otp = None
        elif otp is not None and not secrets.compare_digest(
            _password_reset_otp_hash(int(user.id), request.code),
            str(otp.code_hash),
        ):
            connection.execute(
                text(
                    "UPDATE password_reset_otps SET attempts = attempts + 1 "
                    "WHERE user_id = :user_id"
                ),
                {"user_id": user.id},
            )
        elif otp is not None:
            connection.execute(
                text(
                    "UPDATE users SET password_hash = :password_hash, "
                    "token_version = token_version + 1 WHERE id = :user_id"
                ),
                {
                    "password_hash": _password_hash(request.new_password),
                    "user_id": user.id,
                },
            )
            connection.execute(
                text("DELETE FROM password_reset_otps WHERE user_id = :user_id"),
                {"user_id": user.id},
            )
            return {"ok": True, "message": "Password reset. Sign in with your new password."}

    raise HTTPException(status_code=failure_status, detail=failure_detail)


@app.get("/api/auth/me")
def who_am_i(current_user: AuthenticatedUser = Depends(get_current_user)):
    return current_user


class ProfileUpdateRequest(BaseModel):
    name: str = Field(min_length=2, max_length=100)
    email: str = Field(min_length=5, max_length=254)

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        value = value.strip()
        if len(value) < 2:
            raise ValueError("Name must contain at least two characters")
        return value

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        value = value.strip().lower()
        if "@" not in value or value.startswith("@") or value.endswith("@"):
            raise ValueError("Enter a valid email address")
        return value


@app.get("/api/auth/profile")
def account_profile(current_user: AuthenticatedUser = Depends(get_current_user)):
    profile = rows(
        "SELECT id, name, email, phone, role FROM users WHERE id = :user_id",
        user_id=current_user.id,
    )
    if not profile:
        raise HTTPException(status_code=404, detail="Account not found")
    return profile[0]


@app.put("/api/auth/profile")
def update_account_profile(
    request: ProfileUpdateRequest,
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    duplicate = rows(
        "SELECT id FROM users WHERE lower(email) = :email AND id != :user_id",
        email=request.email,
        user_id=current_user.id,
    )
    if duplicate:
        raise HTTPException(status_code=409, detail="Email is already registered")
    with engine.begin() as connection:
        connection.execute(
            text("UPDATE users SET name = :name, email = :email WHERE id = :user_id"),
            {
                "name": request.name,
                "email": request.email,
                "user_id": current_user.id,
            },
        )
    return {
        "id": current_user.id,
        "name": request.name,
        "email": request.email,
        "phone": rows(
            "SELECT phone FROM users WHERE id = :user_id",
            user_id=current_user.id,
        )[0]["phone"],
        "role": current_user.role,
    }


class BootstrapAdminRequest(BaseModel):
    name: str = Field(min_length=2, max_length=100)
    email: str = Field(min_length=5, max_length=254)
    phone: str = Field(min_length=7, max_length=30)
    password: str = Field(min_length=12, max_length=128)
    bootstrap_token: str = Field(min_length=1, max_length=256)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        value = value.strip().lower()
        if "@" not in value or value.startswith("@") or value.endswith("@"):
            raise ValueError("Enter a valid email address")
        return value


@app.post("/api/auth/bootstrap-admin")
def bootstrap_admin(request: BootstrapAdminRequest):
    if not settings.admin_bootstrap_token or not secrets.compare_digest(
        request.bootstrap_token, settings.admin_bootstrap_token
    ):
        raise HTTPException(status_code=403, detail="Admin bootstrap is not configured or token is invalid")
    with engine.connect() as connection:
        admin_exists = connection.execute(
            text("SELECT id FROM users WHERE role = 'admin' AND password_hash LIKE 'scrypt$%' LIMIT 1")
        ).first()
    if admin_exists:
        raise HTTPException(status_code=409, detail="An administrator account already exists")
    return _create_account(
        request.name, request.email, request.phone, request.password, "admin"
    )


def rows(sql_query: str, **params: object) -> list[dict[str, object]]:
    with engine.connect() as connection:
        result = []
        for row in connection.execute(text(sql_query), params):
            record = dict(row._mapping)
            if "preorder_enabled" in record:
                record["preorder_enabled"] = bool(record["preorder_enabled"])
            for boolean_column in ("available", "contact_consent", "blocked_by_me"):
                if boolean_column in record:
                    record[boolean_column] = bool(record[boolean_column])
            result.append(record)
        return result


def _marketplace_options() -> dict[str, object]:
    stored = {
        str(row["setting_key"]): str(row["setting_value"])
        for row in rows(
            """
            SELECT setting_key, setting_value
            FROM marketplace_settings
            WHERE setting_key IN (
                'categories', 'counties', 'marketplace_enabled',
                'farm_applications_enabled'
            )
            """
        )
    }
    required_keys = {
        "categories",
        "counties",
        "marketplace_enabled",
        "farm_applications_enabled",
    }
    if not required_keys.issubset(stored):
        raise RuntimeError("Marketplace settings are incomplete")
    categories = json.loads(stored["categories"])
    counties = json.loads(stored["counties"])
    if not isinstance(categories, list) or not isinstance(counties, list):
        raise RuntimeError("Marketplace categories or counties are invalid")
    return {
        "categories": categories,
        "counties": counties,
        "marketplace_enabled": stored["marketplace_enabled"] == "true",
        "farm_applications_enabled": stored["farm_applications_enabled"] == "true",
    }


def _require_marketplace_enabled() -> None:
    if not _marketplace_options()["marketplace_enabled"]:
        raise HTTPException(status_code=503, detail="The marketplace is temporarily paused")


def _notify_user(
    user_id: int,
    category: str,
    title: str,
    body: str,
    background_tasks: BackgroundTasks | None = None,
) -> None:
    with engine.begin() as connection:
        connection.execute(
            text(
                """
                INSERT INTO notifications (user_id, category, title, body)
                VALUES (:user_id, :category, :title, :body)
                """
            ),
            {
                "user_id": user_id,
                "category": category,
                "title": title,
                "body": body,
            },
        )


@app.get("/api/notifications")
def get_notifications(
    limit: int = 30,
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    return rows(
        """
        SELECT id, category, title, body, read_at, created_at
        FROM notifications
        WHERE user_id = :user_id
        ORDER BY id DESC
        LIMIT :limit
        """,
        user_id=current_user.id,
        limit=min(max(limit, 1), 100),
    )


@app.post("/api/notifications/{notification_id}/read")
def mark_notification_read(
    notification_id: int,
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    with engine.begin() as connection:
        result = connection.execute(
            text(
                """
                UPDATE notifications SET read_at = CURRENT_TIMESTAMP
                WHERE id = :notification_id AND user_id = :user_id
                """
            ),
            {"notification_id": notification_id, "user_id": current_user.id},
        )
    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="Notification not found")
    return {"ok": True}


class PriceAlertRequest(BaseModel):
    product_id: int = Field(gt=0)
    target_price_kes: float = Field(gt=0)


@app.post("/api/price-alerts")
def save_price_alert(
    request: PriceAlertRequest,
    background_tasks: BackgroundTasks,
    buyer: AuthenticatedUser = Depends(require_role("buyer")),
):
    _require_marketplace_enabled()
    product = rows(
        """
        SELECT p.id, p.name, p.unit, p.price_kes
        FROM products AS p
        JOIN farms AS f ON f.id = p.farm_id
        WHERE p.id = :product_id AND p.admin_suspended = FALSE
          AND f.status = 'verified' AND f.admin_suspended = FALSE
        """,
        product_id=request.product_id,
    )
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    with engine.begin() as connection:
        connection.execute(
            text(
                """
                INSERT INTO price_alerts (buyer_id, product_id, target_price_kes)
                VALUES (:buyer_id, :product_id, :target_price_kes)
                ON CONFLICT (buyer_id, product_id) DO UPDATE SET
                    target_price_kes = excluded.target_price_kes,
                    notified_at = NULL
                """
            ),
            {
                "buyer_id": buyer.id,
                "product_id": request.product_id,
                "target_price_kes": request.target_price_kes,
            },
        )
        already_at_target = float(product[0]["price_kes"]) <= request.target_price_kes
        if already_at_target:
            connection.execute(
                text(
                    """
                    UPDATE price_alerts SET notified_at = CURRENT_TIMESTAMP
                    WHERE buyer_id = :buyer_id AND product_id = :product_id
                    """
                ),
                {"buyer_id": buyer.id, "product_id": request.product_id},
            )
    if already_at_target:
        _notify_user(
            buyer.id,
            "price",
            f"Price alert: {product[0]['name']}",
            (
                f"{product[0]['name']} is already listed at KES "
                f"{product[0]['price_kes']} per {product[0]['unit']}, at or below "
                f"your target of KES {request.target_price_kes}."
            ),
            background_tasks,
        )
    return {"ok": True}


@app.get("/api/farmer/income")
def farmer_income(
    farm_id: int,
    current_user: AuthenticatedUser = Depends(require_role("farmer")),
):
    _owned_verified_farm(farm_id, current_user)
    sales = rows(
        """
        SELECT COALESCE(SUM(oi.qty * oi.price_kes), 0) AS sales_kes,
               COALESCE(SUM(oi.qty), 0) AS units_sold,
               COUNT(DISTINCT o.id) AS paid_orders
        FROM order_items AS oi
        JOIN orders AS o ON o.id = oi.order_id
        JOIN products AS p ON p.id = oi.product_id
        WHERE p.farm_id = :farm_id
          AND o.status IN ('paid', 'shipped', 'delivered')
          AND oi.fulfillment_status != 'cancelled'
        """,
        farm_id=farm_id,
    )[0]
    expenses = rows(
        """
        SELECT id, category, amount_kes, expense_date, notes
        FROM farm_expenses
        WHERE farm_id = :farm_id
        ORDER BY expense_date DESC, id DESC
        """,
        farm_id=farm_id,
    )
    total_expenses = sum(float(expense["amount_kes"]) for expense in expenses)
    sales_kes = float(sales["sales_kes"])
    return {
        "sales_kes": sales_kes,
        "units_sold": float(sales["units_sold"]),
        "paid_orders": int(sales["paid_orders"]),
        "expenses_kes": total_expenses,
        "estimated_profit_kes": sales_kes - total_expenses,
        "expenses": expenses,
    }


@app.get("/api/farmer/analytics")
def farmer_sales_analytics(
    farm_id: int,
    current_user: AuthenticatedUser = Depends(require_role("farmer")),
):
    _owned_verified_farm(farm_id, current_user)
    products = rows(
        """
        SELECT p.id AS product_id, p.name AS product, p.variety, p.unit,
               COALESCE(SUM(CASE WHEN o.id IS NOT NULL THEN oi.qty ELSE 0 END), 0)
                   AS units_sold,
               COALESCE(
                   SUM(CASE WHEN o.id IS NOT NULL THEN oi.qty * oi.price_kes ELSE 0 END),
                   0
               ) AS sales_kes,
               COUNT(DISTINCT o.id) AS paid_orders
        FROM products AS p
        LEFT JOIN order_items AS oi
            ON oi.product_id = p.id AND oi.fulfillment_status != 'cancelled'
        LEFT JOIN orders AS o
            ON o.id = oi.order_id AND o.status IN ('paid', 'shipped', 'delivered')
        WHERE p.farm_id = :farm_id
        GROUP BY p.id, p.name, p.variety, p.unit
        ORDER BY sales_kes DESC, units_sold DESC, p.name
        """,
        farm_id=farm_id,
    )
    repeat_buyers = rows(
        """
        SELECT buyer.id AS buyer_id, buyer.name AS buyer_name,
               COUNT(DISTINCT o.id) AS paid_orders,
               COALESCE(SUM(oi.qty * oi.price_kes), 0) AS sales_kes,
               MAX(o.created_at) AS last_paid_order_at
        FROM orders AS o
        JOIN order_items AS oi ON oi.order_id = o.id
        JOIN products AS p ON p.id = oi.product_id
        JOIN users AS buyer ON buyer.id = o.buyer_id
        WHERE p.farm_id = :farm_id
          AND o.status IN ('paid', 'shipped', 'delivered')
          AND oi.fulfillment_status != 'cancelled'
        GROUP BY buyer.id, buyer.name
        HAVING COUNT(DISTINCT o.id) >= 2
        ORDER BY paid_orders DESC, sales_kes DESC, buyer.name
        LIMIT 20
        """,
        farm_id=farm_id,
    )
    totals = rows(
        """
        SELECT COALESCE(SUM(oi.qty * oi.price_kes), 0) AS sales_kes,
               COALESCE(SUM(oi.qty), 0) AS units_sold,
               COUNT(DISTINCT o.id) AS paid_orders
        FROM order_items AS oi
        JOIN orders AS o ON o.id = oi.order_id
        JOIN products AS p ON p.id = oi.product_id
        WHERE p.farm_id = :farm_id
          AND o.status IN ('paid', 'shipped', 'delivered')
          AND oi.fulfillment_status != 'cancelled'
        """,
        farm_id=farm_id,
    )[0]
    return {
        **totals,
        "products": products,
        "repeat_buyers": repeat_buyers,
        "repeat_buyer_definition": (
            "Buyers with at least two paid orders containing products from this farm. "
            "This is repeat-purchase history, not a credit or trust assessment."
        ),
    }


@app.get("/api/buyer/analytics")
def buyer_analytics(
    current_user: AuthenticatedUser = Depends(require_role("buyer")),
):
    paid_orders = rows(
        """
        SELECT id, total_kes, created_at
        FROM orders
        WHERE buyer_id = :buyer_id
          AND status IN ('paid', 'shipped', 'delivered')
        ORDER BY created_at DESC
        """,
        buyer_id=current_user.id,
    )
    today = date.today()
    current_iso = today.isocalendar()
    week_spend = 0.0
    month_spend = 0.0
    year_spend = 0.0
    total_spend = 0.0
    for order in paid_orders:
        value = float(order["total_kes"] or 0)
        total_spend += value
        created_at = datetime.fromisoformat(str(order["created_at"]))
        order_date = created_at.date()
        iso_date = order_date.isocalendar()
        if (iso_date.year, iso_date.week) == (current_iso.year, current_iso.week):
            week_spend += value
        if (order_date.year, order_date.month) == (today.year, today.month):
            month_spend += value
        if order_date.year == today.year:
            year_spend += value
    commodity_lines = rows(
        """
        SELECT p.name AS product, p.unit, oi.qty, oi.price_kes, o.created_at
        FROM orders AS o
        JOIN order_items AS oi ON oi.order_id = o.id
        JOIN products AS p ON p.id = oi.product_id
        WHERE o.buyer_id = :buyer_id
          AND o.status IN ('paid', 'shipped', 'delivered')
          AND oi.fulfillment_status != 'cancelled'
        """,
        buyer_id=current_user.id,
    )
    commodity_periods: dict[str, dict[tuple[str, str], dict[str, float]]] = {
        "all": {},
        "week": {},
        "month": {},
        "year": {},
    }
    for line in commodity_lines:
        created_at = datetime.fromisoformat(str(line["created_at"]))
        order_date = created_at.date()
        line_periods = ["all"]
        iso_date = order_date.isocalendar()
        if (iso_date.year, iso_date.week) == (current_iso.year, current_iso.week):
            line_periods.append("week")
        if (order_date.year, order_date.month) == (today.year, today.month):
            line_periods.append("month")
        if order_date.year == today.year:
            line_periods.append("year")
        product_key = (str(line["product"]), str(line["unit"]))
        quantity = float(line["qty"])
        amount = quantity * float(line["price_kes"])
        for period in line_periods:
            values = commodity_periods[period].setdefault(
                product_key,
                {"units_bought": 0.0, "amount_kes": 0.0},
            )
            values["units_bought"] += quantity
            values["amount_kes"] += amount

    def sorted_commodities(period: str) -> list[dict[str, object]]:
        return [
            {
                "product": product,
                "unit": unit,
                **values,
            }
            for (product, unit), values in sorted(
                commodity_periods[period].items(),
                key=lambda entry: (
                    -entry[1]["units_bought"],
                    -entry[1]["amount_kes"],
                    entry[0][0],
                ),
            )[:10]
        ]

    return {
        "paid_order_count": len(paid_orders),
        "total_spend_kes": total_spend,
        "this_week_spend_kes": week_spend,
        "this_month_spend_kes": month_spend,
        "this_year_spend_kes": year_spend,
        "commodities": sorted_commodities("all"),
        "this_week_commodities": sorted_commodities("week"),
        "this_month_commodities": sorted_commodities("month"),
        "this_year_commodities": sorted_commodities("year"),
    }


class FarmExpenseRequest(BaseModel):
    category: str = Field(min_length=2, max_length=80)
    amount_kes: float = Field(gt=0, le=1_000_000_000)
    expense_date: date
    notes: str = Field(default="", max_length=1000)
    client_id: str | None = Field(default=None, pattern=r"^[a-fA-F0-9-]{36}$")


@app.post("/api/farmer/income/expenses")
def add_farm_expense(
    farm_id: int,
    expense: FarmExpenseRequest,
    current_user: AuthenticatedUser = Depends(require_role("farmer")),
):
    _owned_verified_farm(farm_id, current_user)
    with engine.begin() as connection:
        expense_id = connection.execute(
            text(
                """
                INSERT INTO farm_expenses
                    (farm_id, client_id, category, amount_kes, expense_date, notes)
                VALUES
                    (:farm_id, :client_id, :category, :amount_kes, :expense_date, :notes)
                ON CONFLICT (client_id) DO NOTHING
                RETURNING id
                """
            ),
            {
                "farm_id": farm_id,
                "client_id": expense.client_id,
                "category": expense.category.strip(),
                "amount_kes": expense.amount_kes,
                "expense_date": expense.expense_date,
                "notes": expense.notes.strip(),
            },
        ).scalar()
        if expense_id is None and expense.client_id:
            expense_id = connection.execute(
                text("SELECT id FROM farm_expenses WHERE client_id = :client_id"),
                {"client_id": expense.client_id},
            ).scalar()
    return {"id": expense_id, "ok": True}


@app.post("/api/farmer/weather/check")
async def check_farm_weather(
    farm_id: int,
    background_tasks: BackgroundTasks,
    current_user: AuthenticatedUser = Depends(require_role("farmer")),
):
    _owned_verified_farm(farm_id, current_user)
    farm = rows(
        "SELECT id, name, latitude, longitude FROM farms WHERE id = :farm_id",
        farm_id=farm_id,
    )[0]
    if farm["latitude"] is None or farm["longitude"] is None:
        raise HTTPException(
            status_code=409,
            detail="Add farm coordinates before checking weather alerts.",
        )
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.get(
                "https://api.open-meteo.com/v1/forecast",
                params={
                    "latitude": farm["latitude"],
                    "longitude": farm["longitude"],
                    "daily": "weather_code,precipitation_probability_max",
                    "forecast_days": 1,
                    "timezone": "auto",
                },
            )
            response.raise_for_status()
            forecast = response.json()
    except (httpx.HTTPError, ValueError) as error:
        logger.exception("Could not retrieve weather forecast for farm %s.", farm_id)
        raise HTTPException(
            status_code=502,
            detail="The weather service is temporarily unavailable.",
        ) from error
    try:
        weather_code = int(forecast["daily"]["weather_code"][0])
        rain_probability = int(
            forecast["daily"]["precipitation_probability_max"][0] or 0
        )
        forecast_date = str(forecast["daily"]["time"][0])
    except (KeyError, IndexError, TypeError, ValueError) as error:
        logger.exception("Weather service returned an invalid response for farm %s.", farm_id)
        raise HTTPException(
            status_code=502,
            detail="The weather service returned an invalid forecast.",
        ) from error
    warning = weather_code in {65, 67, 82, 95, 96, 99} or rain_probability >= 80
    details = (
        f"Forecast rain probability: {rain_probability}%. Weather code: {weather_code}."
    )
    if warning:
        title = f"Weather warning for {farm['name']}"
        body = (
            f"Potentially disruptive weather is forecast for {forecast_date}. "
            f"{details} Check local conditions and protect crops as appropriate."
        )
        existing = rows(
            """
            SELECT id FROM notifications
            WHERE user_id = :user_id AND category = 'weather'
              AND title = :title AND DATE(created_at) = :forecast_day
            """,
            user_id=current_user.id,
            title=title,
            forecast_day=forecast_date,
        )
        if not existing:
            _notify_user(current_user.id, "weather", title, body, background_tasks)
    return {
        "farm": farm["name"],
        "forecast_date": forecast_date,
        "weather_code": weather_code,
        "rain_probability": rain_probability,
        "warning": warning,
        "message": details,
    }


class FarmerGroupRequest(BaseModel):
    name: str = Field(min_length=2, max_length=100)
    county: str = Field(min_length=2, max_length=80)
    topic: str = Field(min_length=2, max_length=100)
    description: str = Field(default="", max_length=1000)


@app.get("/api/farmer-groups")
def list_farmer_groups(
    current_user: AuthenticatedUser = Depends(require_role("farmer")),
):
    return rows(
        """
        SELECT g.id, g.name, g.county, g.topic, g.description,
               g.created_at, COUNT(DISTINCT m.user_id) AS member_count,
               MAX(CASE WHEN m.user_id = :user_id THEN 1 ELSE 0 END) AS is_member
        FROM farmer_groups AS g
        LEFT JOIN farmer_group_members AS m ON m.group_id = g.id
        WHERE g.admin_suspended = FALSE
        GROUP BY g.id, g.name, g.county, g.topic, g.description, g.created_at
        ORDER BY g.county, g.name
        """,
        user_id=current_user.id,
    )


@app.post("/api/farmer-groups")
def create_farmer_group(
    request: FarmerGroupRequest,
    current_user: AuthenticatedUser = Depends(require_role("farmer")),
):
    with engine.begin() as connection:
        group_id = connection.execute(
            text(
                """
                INSERT INTO farmer_groups (name, county, topic, description, created_by)
                VALUES (:name, :county, :topic, :description, :created_by)
                RETURNING id
                """
            ),
            {
                "name": request.name.strip(),
                "county": request.county.strip(),
                "topic": request.topic.strip(),
                "description": request.description.strip(),
                "created_by": current_user.id,
            },
        ).scalar()
        connection.execute(
            text(
                "INSERT INTO farmer_group_members (group_id, user_id) VALUES (:group_id, :user_id)"
            ),
            {"group_id": group_id, "user_id": current_user.id},
        )
    return {"id": group_id, "ok": True}


@app.post("/api/farmer-groups/{group_id}/join")
def join_farmer_group(
    group_id: int,
    current_user: AuthenticatedUser = Depends(require_role("farmer")),
):
    if not rows(
        "SELECT id FROM farmer_groups WHERE id = :group_id AND admin_suspended = FALSE",
        group_id=group_id,
    ):
        raise HTTPException(status_code=404, detail="Farmer group not found")
    with engine.begin() as connection:
        connection.execute(
            text(
                """
                INSERT INTO farmer_group_members (group_id, user_id)
                VALUES (:group_id, :user_id)
                ON CONFLICT (group_id, user_id) DO NOTHING
                """
            ),
            {"group_id": group_id, "user_id": current_user.id},
        )
    return {"ok": True}


@app.get("/api/farmer-groups/{group_id}/posts")
def list_farmer_group_posts(
    group_id: int,
    current_user: AuthenticatedUser = Depends(require_role("farmer")),
):
    membership = rows(
        """
        SELECT 1 FROM farmer_group_members
        WHERE group_id = :group_id AND user_id = :user_id
          AND EXISTS (
              SELECT 1 FROM farmer_groups
              WHERE id = :group_id AND admin_suspended = FALSE
          )
        """,
        group_id=group_id,
        user_id=current_user.id,
    )
    if not membership:
        raise HTTPException(status_code=403, detail="Join this group to view its posts")
    return rows(
        """
        SELECT p.id, p.author_id, p.post_type, p.body, p.produce_name, p.quantity,
               p.created_at, u.name AS author,
               CASE WHEN p.author_id = :current_user_id THEN 1 ELSE 0 END AS is_mine
        FROM farmer_group_posts AS p
        JOIN users AS u ON u.id = p.author_id
        WHERE p.group_id = :group_id
        ORDER BY p.id DESC
        """,
        group_id=group_id,
        current_user_id=current_user.id,
    )


class FarmerGroupPostRequest(BaseModel):
    post_type: Literal["discussion", "bulk_order"] = "discussion"
    body: str = Field(min_length=2, max_length=2000)
    produce_name: str | None = Field(default=None, min_length=2, max_length=100)
    quantity: float | None = Field(default=None, gt=0, le=1_000_000)

    @model_validator(mode="after")
    def require_bulk_order_details(self):
        if self.post_type == "bulk_order" and (
            self.produce_name is None or self.quantity is None
        ):
            raise ValueError("Bulk-order posts need a produce name and quantity")
        return self


@app.post("/api/farmer-groups/{group_id}/posts")
def create_farmer_group_post(
    group_id: int,
    request: FarmerGroupPostRequest,
    current_user: AuthenticatedUser = Depends(require_role("farmer")),
):
    membership = rows(
        """
        SELECT 1 FROM farmer_group_members
        WHERE group_id = :group_id AND user_id = :user_id
          AND EXISTS (
              SELECT 1 FROM farmer_groups
              WHERE id = :group_id AND admin_suspended = FALSE
          )
        """,
        group_id=group_id,
        user_id=current_user.id,
    )
    if not membership:
        raise HTTPException(status_code=403, detail="Join this group before posting")
    with engine.begin() as connection:
        post_id = connection.execute(
            text(
                """
                INSERT INTO farmer_group_posts
                    (group_id, author_id, post_type, body, produce_name, quantity)
                VALUES
                    (:group_id, :author_id, :post_type, :body, :produce_name, :quantity)
                RETURNING id
                """
            ),
            {
                "group_id": group_id,
                "author_id": current_user.id,
                "post_type": request.post_type,
                "body": request.body.strip(),
                "produce_name": request.produce_name,
                "quantity": request.quantity,
            },
        ).scalar()
    return {"id": post_id, "ok": True}


PRODUCT_SQL = """
SELECT p.id, p.name, p.description, p.category, p.variety, p.grade, p.price_kes, p.unit, p.stock, f.id AS farm_id,
       farmer.id AS farmer_id,
       p.harvest_date, p.image_url, p.preorder_enabled, p.season_tier,
       p.trace_code, f.name AS farm, f.county, f.verification_level,
       f.latitude, f.longitude,
       f.farming_methods,
       coalesce(
           (SELECT ROUND(AVG((r.quality_rating + r.delivery_speed_rating) / 2.0), 1)
            FROM reviews AS r WHERE r.farm_id = f.id),
           f.rating
       ) AS rating,
       (SELECT COUNT(*) FROM reviews AS r WHERE r.farm_id = f.id) AS rating_count,
       f.delivery_days
FROM products AS p
JOIN farms AS f ON f.id = p.farm_id
LEFT JOIN users AS farmer
  ON farmer.id = f.owner_id AND farmer.role = 'farmer'
 AND farmer.account_status = 'active'
WHERE f.status = 'verified' AND f.admin_suspended = FALSE
  AND p.admin_suspended = FALSE
"""


@app.get("/api/products")
def products(
    q: str = "",
    county: str = "",
    category: str = "",
    availability: Literal["in_stock", "all"] = "in_stock",
):
    _require_marketplace_enabled()
    availability_filter = (
        " AND p.stock > 0" if availability == "in_stock" else ""
    )
    return rows(
        PRODUCT_SQL
        + " AND (:county = '' OR f.county = :county)"
        + " AND (:category = '' OR p.category = :category)"
        + " AND (lower(p.name) LIKE '%' || lower(:search_query) || '%'"
        + " OR lower(p.variety) LIKE '%' || lower(:search_query) || '%'"
        + " OR lower(f.name) LIKE '%' || lower(:search_query) || '%'"
        + " OR lower(coalesce(farmer.name, '')) LIKE '%' || lower(:search_query) || '%')"
        + availability_filter
        + " ORDER BY p.name, p.price_kes",
        search_query=q,
        county=county,
        category=category,
    )


@app.get("/api/products/urgency")
def urgent_products():
    _require_marketplace_enabled()
    today = date.today()
    listings = rows(
        PRODUCT_SQL
        + " AND p.stock > 0 AND p.harvest_date IS NOT NULL "
        + "ORDER BY p.harvest_date, p.name"
    )
    urgent = []
    for listing in listings:
        try:
            harvest_date = date.fromisoformat(str(listing["harvest_date"]))
        except ValueError:
            logger.warning(
                "Skipping product %s in freshness suggestions: invalid harvest date.",
                listing["id"],
            )
            continue
        if harvest_date > today:
            continue

        freshness = evaluate_produce_freshness(
            str(listing["name"]),
            harvest_date.isoformat(),
            "not provided",
        )
        if freshness["risk_level"] == "Fresh":
            continue
        urgent.append({**listing, "freshness": freshness})

    return sorted(
        urgent,
        key=lambda listing: (
            0 if listing["freshness"]["risk_level"] == "Critical" else 1,
            -int(listing["freshness"]["age_in_days"]),
            float(listing["price_kes"]),
        ),
    )


@app.get("/api/products/compare")
def compare(name: str):
    _require_marketplace_enabled()
    return rows(
        PRODUCT_SQL
        + " AND p.stock > 0 AND lower(p.name) = lower(:name) "
        + "ORDER BY p.price_kes",
        name=name,
    )


@app.get("/api/products/{product_id}")
def product_detail(product_id: int):
    _require_marketplace_enabled()
    product = rows(
        PRODUCT_SQL + " AND p.stock > 0 AND p.id = :product_id",
        product_id=product_id,
    )
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    return product[0]


class BuyerFavoriteRequest(BaseModel):
    product_id: int = Field(gt=0)


@app.get("/api/buyer/favorites")
def buyer_favorites(
    current_user: AuthenticatedUser = Depends(require_role("buyer")),
):
    _require_marketplace_enabled()
    return rows(
        PRODUCT_SQL
        + """
        AND p.stock > 0
        AND p.id IN (
            SELECT product_id FROM buyer_favorites WHERE buyer_id = :buyer_id
        )
        ORDER BY p.name, p.price_kes
        """,
        buyer_id=current_user.id,
    )


@app.post("/api/buyer/favorites")
def add_buyer_favorite(
    request: BuyerFavoriteRequest,
    current_user: AuthenticatedUser = Depends(require_role("buyer")),
):
    _require_marketplace_enabled()
    if not rows(
        PRODUCT_SQL + " AND p.stock > 0 AND p.id = :product_id",
        product_id=request.product_id,
    ):
        raise HTTPException(status_code=404, detail="Available product not found")
    with engine.begin() as connection:
        connection.execute(
            text(
                """
                INSERT INTO buyer_favorites (buyer_id, product_id)
                VALUES (:buyer_id, :product_id)
                ON CONFLICT (buyer_id, product_id) DO NOTHING
                """
            ),
            {"buyer_id": current_user.id, "product_id": request.product_id},
        )
    return {"ok": True}


@app.delete("/api/buyer/favorites/{product_id}")
def remove_buyer_favorite(
    product_id: int,
    current_user: AuthenticatedUser = Depends(require_role("buyer")),
):
    with engine.begin() as connection:
        connection.execute(
            text(
                "DELETE FROM buyer_favorites "
                "WHERE buyer_id = :buyer_id AND product_id = :product_id"
            ),
            {"buyer_id": current_user.id, "product_id": product_id},
        )
    return {"ok": True}


@app.get("/api/trace/{trace_code}")
def trace_product(trace_code: str):
    _require_marketplace_enabled()
    product = rows(
        """
        SELECT p.trace_code, p.name AS product, p.variety, p.unit, p.harvest_date,
               p.preorder_enabled, p.season_tier, p.image_url,
               f.id AS farm_id, f.name AS farm, f.county, f.size_acres,
               f.latitude, f.longitude, f.farming_methods
        FROM products AS p
        JOIN farms AS f ON f.id = p.farm_id
        WHERE p.trace_code = :trace_code AND f.status = 'verified'
          AND f.admin_suspended = FALSE AND p.admin_suspended = FALSE
        """,
        trace_code=trace_code,
    )
    if not product:
        raise HTTPException(status_code=404, detail="Traceability record not found")
    return product[0]


class ProductRequest(BaseModel):
    name: str = Field(min_length=2, max_length=100)
    description: str = Field(default="", max_length=2000)
    category: str = Field(min_length=2, max_length=80)
    variety: str = Field(default="Standard", min_length=2, max_length=80)
    grade: str = Field(default="Grade A", min_length=1, max_length=40)
    unit: str = Field(default="kg", min_length=1, max_length=20)
    price_kes: float = Field(ge=0)
    stock: float = Field(ge=0)
    harvest_date: date | None = None
    image_url: str | None = Field(default=None, max_length=2048)
    preorder_enabled: bool = False
    season_tier: Literal["early", "peak", "late", "in_season"] = "in_season"

    @field_validator("description")
    @classmethod
    def clean_description(cls, value: str) -> str:
        return value.strip()

    @field_validator("category")
    @classmethod
    def validate_category(cls, value: str) -> str:
        category = value.strip()
        if category not in _marketplace_options()["categories"]:
            raise ValueError("Select an active marketplace category")
        return category

    @field_validator("variety")
    @classmethod
    def clean_variety(cls, value: str) -> str:
        variety = value.strip()
        if len(variety) < 2:
            raise ValueError("Enter a produce variety")
        return variety

    @field_validator("grade")
    @classmethod
    def clean_grade(cls, value: str) -> str:
        return value.strip()

    @field_validator("image_url")
    @classmethod
    def validate_image_url(cls, value: str | None) -> str | None:
        if value is None or value == "":
            return None
        if re.fullmatch(r"/api/product-images/[a-f0-9]{32}\.(?:jpg|png|webp)", value):
            return value
        parsed = urlsplit(value)
        if parsed.scheme != "https" or not parsed.hostname:
            raise ValueError("Product image URL must use HTTPS")
        return value

    @model_validator(mode="after")
    def validate_preorder_harvest(self):
        if self.preorder_enabled and (
            self.harvest_date is None or self.harvest_date <= date.today()
        ):
            raise ValueError("Pre-orders need a future expected harvest date")
        return self


@app.post("/api/farms/{farm_id}/product-images")
async def upload_product_image(
    farm_id: int,
    image: UploadFile = File(...),
    current_user: AuthenticatedUser = Depends(require_role("farmer")),
):
    _owned_verified_farm(farm_id, current_user)
    content = await image.read(max_product_image_bytes + 1)
    if len(content) > max_product_image_bytes:
        raise HTTPException(status_code=413, detail="Product photos must be 5 MB or smaller")

    image_types = (
        (content.startswith(b"\xff\xd8\xff"), ".jpg"),
        (content.startswith(b"\x89PNG\r\n\x1a\n"), ".png"),
        (len(content) >= 12 and content[:4] == b"RIFF" and content[8:12] == b"WEBP", ".webp"),
    )
    extension = next((suffix for valid, suffix in image_types if valid), None)
    if extension is None:
        raise HTTPException(
            status_code=415,
            detail="Upload a valid JPEG, PNG, or WebP product photo",
        )

    product_image_dir.mkdir(parents=True, exist_ok=True)
    filename = f"{uuid.uuid4().hex}{extension}"
    (product_image_dir / filename).write_bytes(content)
    return {"image_url": f"/api/product-images/{filename}"}


@app.get("/api/product-images/{filename}")
def get_product_image(filename: str):
    if not re.fullmatch(r"[a-f0-9]{32}\.(?:jpg|png|webp)", filename):
        raise HTTPException(status_code=404, detail="Product image not found")
    image_path = product_image_dir / filename
    if not image_path.is_file():
        raise HTTPException(status_code=404, detail="Product image not found")
    media_type = {
        ".jpg": "image/jpeg",
        ".png": "image/png",
        ".webp": "image/webp",
    }[image_path.suffix]
    return FileResponse(
        image_path,
        media_type=media_type,
        headers={"X-Content-Type-Options": "nosniff"},
    )


class FreshnessRequest(BaseModel):
    product_id: int = Field(gt=0)
    storage_type: str = Field(default="room temperature", min_length=2, max_length=80)

    @field_validator("storage_type")
    @classmethod
    def clean_storage_type(cls, value: str) -> str:
        return value.strip()


@app.post("/api/ai/analyze-stock")
def analyze_stock(
    request: FreshnessRequest,
    farmer: AuthenticatedUser = Depends(require_role("farmer")),
):
    product = rows(
        """
        SELECT p.name, p.harvest_date
        FROM products AS p
        JOIN farms AS f ON f.id = p.farm_id
        WHERE p.id = :product_id
          AND f.owner_id = :owner_id
          AND f.status = 'verified' AND f.admin_suspended = FALSE
        """,
        product_id=request.product_id,
        owner_id=farmer.id,
    )
    if not product:
        raise HTTPException(
            status_code=404, detail="Product not found in your verified farm"
        )
    if not product[0]["harvest_date"]:
        raise HTTPException(
            status_code=400, detail="Add a harvest date before checking freshness"
        )
    try:
        return evaluate_produce_freshness(
            str(product[0]["name"]),
            str(product[0]["harvest_date"]),
            request.storage_type,
        )
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@app.get("/api/farms/manage")
def manageable_farms(current_user: AuthenticatedUser = Depends(require_role("farmer"))):
    return rows(
        """
        SELECT id, name, county, status, latitude, longitude, farming_methods,
               verification_level, verification_submitted_at
        FROM farms WHERE owner_id = :owner_id
        ORDER BY name
        """,
        owner_id=current_user.id,
    )


@app.get("/api/farmer/verification/phone")
def farmer_phone_verification(
    current_user: AuthenticatedUser = Depends(require_role("farmer")),
):
    verification = rows(
        "SELECT phone_verified FROM users WHERE id = :user_id",
        user_id=current_user.id,
    )
    return {"verified": bool(verification[0]["phone_verified"])}


@app.post("/api/farmer/verification/otp/send")
def send_farmer_phone_otp(
    current_user: AuthenticatedUser = Depends(require_role("farmer")),
):
    user = rows(
        "SELECT phone, phone_verified FROM users WHERE id = :user_id",
        user_id=current_user.id,
    )
    if not user:
        raise HTTPException(status_code=404, detail="Farmer account not found")
    if user[0]["phone_verified"]:
        return {"ok": True, "verified": True}
    phone = _normalize_phone(str(user[0]["phone"]))
    previous = rows(
        "SELECT last_sent_at FROM farmer_phone_otps WHERE user_id = :user_id",
        user_id=current_user.id,
    )
    if previous:
        sent_at = previous[0]["last_sent_at"]
        if isinstance(sent_at, str):
            sent_at = datetime.fromisoformat(sent_at)
        if sent_at.tzinfo is None:
            sent_at = sent_at.replace(tzinfo=timezone.utc)
        if datetime.now(timezone.utc) - sent_at < timedelta(seconds=60):
            raise HTTPException(
                status_code=429,
                detail="Wait at least 60 seconds before requesting another code",
            )
    code = f"{secrets.randbelow(1_000_000):06d}"
    _send_farmer_otp(phone, code)
    now = datetime.now(timezone.utc)
    with engine.begin() as connection:
        connection.execute(
            text(
                """
                INSERT INTO farmer_phone_otps
                    (user_id, phone, code_hash, expires_at, attempts, last_sent_at)
                VALUES
                    (:user_id, :phone, :code_hash, :expires_at, 0, :last_sent_at)
                ON CONFLICT (user_id) DO UPDATE SET
                    phone = excluded.phone,
                    code_hash = excluded.code_hash,
                    expires_at = excluded.expires_at,
                    attempts = 0,
                    last_sent_at = excluded.last_sent_at
                """
            ),
            {
                "user_id": current_user.id,
                "phone": phone,
                "code_hash": _otp_hash(current_user.id, code),
                "expires_at": (now + timedelta(minutes=10)).isoformat(),
                "last_sent_at": now.isoformat(),
            },
        )
    return {"ok": True, "verified": False}


class FarmerOtpRequest(BaseModel):
    code: str = Field(pattern=r"^\d{6}$")


@app.post("/api/farmer/verification/otp/confirm")
def confirm_farmer_phone_otp(
    request: FarmerOtpRequest,
    current_user: AuthenticatedUser = Depends(require_role("farmer")),
):
    otp = rows(
        "SELECT phone, code_hash, expires_at, attempts "
        "FROM farmer_phone_otps WHERE user_id = :user_id",
        user_id=current_user.id,
    )
    if not otp:
        raise HTTPException(status_code=400, detail="Request a verification code first")
    expires_at = otp[0]["expires_at"]
    if isinstance(expires_at, str):
        expires_at = datetime.fromisoformat(expires_at)
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if datetime.now(timezone.utc) >= expires_at:
        with engine.begin() as connection:
            connection.execute(
                text("DELETE FROM farmer_phone_otps WHERE user_id = :user_id"),
                {"user_id": current_user.id},
            )
        raise HTTPException(status_code=400, detail="Verification code expired; request a new one")
    if int(otp[0]["attempts"]) >= 5:
        raise HTTPException(status_code=429, detail="Too many incorrect codes; request a new one")
    current_phone = rows(
        "SELECT phone FROM users WHERE id = :user_id",
        user_id=current_user.id,
    )[0]["phone"]
    is_current_phone = _normalize_phone(str(current_phone)) == str(otp[0]["phone"])
    matches = is_current_phone and secrets.compare_digest(
        _otp_hash(current_user.id, request.code), str(otp[0]["code_hash"])
    )
    with engine.begin() as connection:
        if matches:
            connection.execute(
                text("UPDATE users SET phone_verified = TRUE WHERE id = :user_id"),
                {"user_id": current_user.id},
            )
            connection.execute(
                text("DELETE FROM farmer_phone_otps WHERE user_id = :user_id"),
                {"user_id": current_user.id},
            )
        else:
            connection.execute(
                text(
                    "UPDATE farmer_phone_otps SET attempts = attempts + 1 "
                    "WHERE user_id = :user_id"
                ),
                {"user_id": current_user.id},
            )
    if not matches:
        raise HTTPException(status_code=400, detail="Verification code is incorrect")
    return {"ok": True, "verified": True}


class FarmBoundaryPoint(BaseModel):
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)


class FarmBoundary(BaseModel):
    points: list[FarmBoundaryPoint] = Field(min_length=3, max_length=100)

    @model_validator(mode="after")
    def validate_polygon(self):
        distinct_points = {
            (point.latitude, point.longitude) for point in self.points
        }
        area = sum(
            point.longitude * self.points[(index + 1) % len(self.points)].latitude
            - self.points[(index + 1) % len(self.points)].longitude * point.latitude
            for index, point in enumerate(self.points)
        )
        if len(distinct_points) < 3 or math.isclose(area, 0.0, abs_tol=1e-10):
            raise ValueError("Farm boundary must form a non-degenerate polygon")
        return self


def _point_in_boundary(latitude: float, longitude: float, points: list[FarmBoundaryPoint]) -> bool:
    inside = False
    previous = points[-1]
    for current in points:
        if (current.longitude > longitude) != (previous.longitude > longitude):
            crossing_latitude = (
                (previous.latitude - current.latitude)
                * (longitude - current.longitude)
                / (previous.longitude - current.longitude)
                + current.latitude
            )
            if latitude < crossing_latitude:
                inside = not inside
        previous = current
    return inside


@app.post("/api/farms/{farm_id}/verification/code")
def create_farm_verification_code(
    farm_id: int,
    current_user: AuthenticatedUser = Depends(require_role("farmer")),
):
    phone = rows(
        "SELECT phone_verified FROM users WHERE id = :user_id",
        user_id=current_user.id,
    )
    if not phone or not phone[0]["phone_verified"]:
        raise HTTPException(status_code=403, detail="Verify your phone before recording farm evidence")
    farm = rows(
        """
        SELECT id, status FROM farms
        WHERE id = :farm_id AND owner_id = :owner_id
        """,
        farm_id=farm_id,
        owner_id=current_user.id,
    )
    if not farm:
        raise HTTPException(status_code=404, detail="Farm not found")
    if farm[0]["status"] != "pending":
        raise HTTPException(status_code=409, detail="This farm cannot accept new verification evidence")
    code = f"MKC-{secrets.randbelow(9000) + 1000} | {datetime.now(ZoneInfo('Africa/Nairobi')).strftime('%d/%m/%Y')}"
    with engine.begin() as connection:
        connection.execute(
            text(
                """
                UPDATE farms SET verification_code = :code,
                    verification_submitted_at = NULL
                WHERE id = :farm_id AND owner_id = :owner_id
                """
            ),
            {"code": code, "farm_id": farm_id, "owner_id": current_user.id},
        )
    return {"code": code}


@app.post("/api/farms/{farm_id}/verification")
async def submit_farm_verification(
    farm_id: int,
    boundary: str = Form(...),
    verification_code: str = Form(..., min_length=10, max_length=40),
    video_latitude: float = Form(..., ge=-90, le=90),
    video_longitude: float = Form(..., ge=-180, le=180),
    video_accuracy_m: float = Form(..., ge=0, le=10000),
    recorded_at: datetime = Form(...),
    duration_seconds: float = Form(..., ge=15, le=30),
    video: UploadFile = File(...),
    current_user: AuthenticatedUser = Depends(require_role("farmer")),
):
    try:
        farm_boundary = FarmBoundary.model_validate_json(boundary)
    except ValidationError as error:
        raise HTTPException(status_code=422, detail="Farm boundary must contain at least 3 valid GPS points") from error
    farm = rows(
        """
        SELECT f.status, f.verification_code, u.phone_verified
        FROM farms AS f JOIN users AS u ON u.id = f.owner_id
        WHERE f.id = :farm_id AND f.owner_id = :owner_id
        """,
        farm_id=farm_id,
        owner_id=current_user.id,
    )
    if not farm:
        raise HTTPException(status_code=404, detail="Farm not found")
    if farm[0]["status"] != "pending":
        raise HTTPException(status_code=409, detail="This farm cannot accept new verification evidence")
    if not farm[0]["phone_verified"]:
        raise HTTPException(status_code=403, detail="Verify your phone before submitting farm evidence")
    if not farm[0]["verification_code"] or not secrets.compare_digest(
        str(farm[0]["verification_code"]), verification_code
    ):
        raise HTTPException(status_code=400, detail="Generate and show the current farm verification code")
    if recorded_at.tzinfo is None:
        recorded_at = recorded_at.replace(tzinfo=timezone.utc)
    now = datetime.now(timezone.utc)
    if recorded_at < now - timedelta(minutes=10) or recorded_at > now + timedelta(minutes=2):
        raise HTTPException(status_code=400, detail="Video GPS timestamp is too old or in the future")
    if video_accuracy_m > 200:
        raise HTTPException(status_code=400, detail="GPS accuracy must be 200 metres or better")
    points = farm_boundary.points
    inside = _point_in_boundary(video_latitude, video_longitude, points)
    near_boundary = (
        min(point.latitude for point in points) - 0.005
        <= video_latitude
        <= max(point.latitude for point in points) + 0.005
        and min(point.longitude for point in points) - 0.005
        <= video_longitude
        <= max(point.longitude for point in points) + 0.005
    )
    if not inside and not near_boundary:
        raise HTTPException(status_code=400, detail="Video GPS must be captured at or near the farm boundary")
    media_types = {
        "video/mp4": ".mp4",
        "video/webm": ".webm",
        "video/quicktime": ".mov",
        "video/x-m4v": ".mp4",
    }
    content_type = (video.content_type or "").split(";", maxsplit=1)[0].strip()
    extension = media_types.get(content_type)
    if extension is None:
        raise HTTPException(status_code=415, detail="Upload an MP4, MOV, or WebM farm video")
    private_farm_video_dir.mkdir(parents=True, exist_ok=True)
    filename = f"{uuid.uuid4().hex}{extension}"
    destination = private_farm_video_dir / filename
    total_bytes = 0
    header = b""
    video_too_large = False
    with destination.open("wb") as saved_video:
        while chunk := await video.read(1024 * 1024):
            total_bytes += len(chunk)
            if total_bytes > max_farm_video_bytes:
                video_too_large = True
                break
            if len(header) < 12:
                header += chunk[: 12 - len(header)]
            saved_video.write(chunk)
    if video_too_large:
        destination.unlink(missing_ok=True)
        raise HTTPException(status_code=413, detail="Farm videos must be 40 MB or smaller")
    valid_signature = (
        (extension in {".mp4", ".mov"} and len(header) >= 8 and header[4:8] == b"ftyp")
        or (extension == ".webm" and header.startswith(b"\x1aE\xdf\xa3"))
    )
    if total_bytes == 0 or not valid_signature:
        destination.unlink(missing_ok=True)
        raise HTTPException(status_code=415, detail="The uploaded file is not a supported video")
    boundary_json = json.dumps(
        [point.model_dump() for point in farm_boundary.points],
        separators=(",", ":"),
    )
    try:
        with engine.begin() as connection:
            connection.execute(
                text(
                    """
                    UPDATE farms
                    SET status = 'verified', verification_level = 'provisional',
                        verified_at = CURRENT_TIMESTAMP, farm_boundary = :boundary,
                        verification_video_path = :video_path,
                        verification_video_latitude = :video_latitude,
                        verification_video_longitude = :video_longitude,
                        verification_video_accuracy_m = :video_accuracy_m,
                        verification_video_recorded_at = :recorded_at,
                        verification_submitted_at = CURRENT_TIMESTAMP
                    WHERE id = :farm_id AND owner_id = :owner_id
                    """
                ),
                {
                    "boundary": boundary_json,
                    "video_path": filename,
                    "video_latitude": video_latitude,
                    "video_longitude": video_longitude,
                    "video_accuracy_m": video_accuracy_m,
                    "recorded_at": recorded_at.isoformat(),
                    "farm_id": farm_id,
                    "owner_id": current_user.id,
                },
            )
    except SQLAlchemyError:
        destination.unlink(missing_ok=True)
        raise
    return {"ok": True, "status": "verified", "verification_level": "provisional"}


class FarmApplication(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    county: str = Field(min_length=2, max_length=80)
    size_acres: float = Field(gt=0)
    farming_methods: str = Field(default="", max_length=2000)


class TransporterProfileRequest(BaseModel):
    display_name: str = Field(min_length=2, max_length=100)
    contact_phone: str = Field(min_length=7, max_length=30)
    vehicle_type: str = Field(min_length=2, max_length=80)
    capacity_kg: float = Field(gt=0, le=1_000_000)
    service_counties: str = Field(min_length=2, max_length=500)
    details: str = Field(default="", max_length=1000)
    available: bool = True
    contact_consent: bool

    @field_validator("service_counties")
    @classmethod
    def normalize_service_counties(cls, value: str) -> str:
        counties = [county.strip() for county in value.split(",") if county.strip()]
        if not counties:
            raise ValueError("Enter at least one service county")
        return ", ".join(dict.fromkeys(counties))

    @model_validator(mode="after")
    def require_contact_consent(self):
        if self.available and not self.contact_consent:
            raise ValueError("Consent is required before publishing contact details")
        return self


@app.get("/api/transporters")
def transporters(county: str = ""):
    listings = rows(
        """
        SELECT p.id, p.display_name, p.contact_phone, p.vehicle_type,
               p.capacity_kg, p.service_counties, p.details
        FROM transporter_profiles AS p
        JOIN users AS u ON u.id = p.user_id
        WHERE p.available = TRUE AND p.contact_consent = TRUE
          AND u.account_status = 'active'
        ORDER BY display_name
        """
    )
    if not county.strip():
        return listings
    county_key = county.strip().casefold()
    return [
        listing
        for listing in listings
        if county_key
        in {
            service_county.strip().casefold()
            for service_county in str(listing["service_counties"]).split(",")
        }
    ]


@app.get("/api/transporters/me")
def my_transporter_profile(
    current_user: AuthenticatedUser = Depends(require_role("buyer", "farmer")),
):
    profiles = rows(
        """
        SELECT id, display_name, contact_phone, vehicle_type, capacity_kg,
               service_counties, details, available, contact_consent
        FROM transporter_profiles
        WHERE user_id = :user_id
        """,
        user_id=current_user.id,
    )
    return profiles[0] if profiles else None


@app.put("/api/transporters/me")
def save_transporter_profile(
    profile: TransporterProfileRequest,
    current_user: AuthenticatedUser = Depends(require_role("buyer", "farmer")),
):
    with engine.begin() as connection:
        connection.execute(
            text(
                """
                INSERT INTO transporter_profiles
                    (user_id, display_name, contact_phone, vehicle_type, capacity_kg,
                     service_counties, details, available, contact_consent)
                VALUES
                    (:user_id, :display_name, :contact_phone, :vehicle_type, :capacity_kg,
                     :service_counties, :details, :available, :contact_consent)
                ON CONFLICT (user_id) DO UPDATE SET
                    display_name = excluded.display_name,
                    contact_phone = excluded.contact_phone,
                    vehicle_type = excluded.vehicle_type,
                    capacity_kg = excluded.capacity_kg,
                    service_counties = excluded.service_counties,
                    details = excluded.details,
                    available = excluded.available,
                    contact_consent = excluded.contact_consent,
                    updated_at = CURRENT_TIMESTAMP
                """
            ),
            {
                "user_id": current_user.id,
                "display_name": profile.display_name.strip(),
                "contact_phone": profile.contact_phone.strip(),
                "vehicle_type": profile.vehicle_type.strip(),
                "capacity_kg": profile.capacity_kg,
                "service_counties": profile.service_counties,
                "details": profile.details.strip(),
                "available": profile.available,
                "contact_consent": profile.contact_consent,
            },
        )
    return {"ok": True}


class TransporterMessageRequest(BaseModel):
    body: str = Field(min_length=1, max_length=1000)
    requester_id: int | None = Field(default=None, gt=0)

    @field_validator("body")
    @classmethod
    def normalize_message_body(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Message cannot be blank")
        return value


@app.get("/api/transporters/{transporter_id}/messages")
def transporter_conversation(
    transporter_id: int,
    requester_id: int | None = None,
    current_user: AuthenticatedUser = Depends(require_role("buyer", "farmer")),
):
    profiles = rows(
        """
        SELECT id, user_id, contact_consent
        FROM transporter_profiles
        WHERE id = :transporter_id
        """,
        transporter_id=transporter_id,
    )
    if not profiles:
        raise HTTPException(status_code=404, detail="Transporter not found")
    is_transporter = int(profiles[0]["user_id"]) == current_user.id
    if not is_transporter and not profiles[0]["contact_consent"]:
        raise HTTPException(status_code=404, detail="Transporter not found")
    if is_transporter and requester_id is None:
        return rows(
            """
            SELECT tm.requester_id, u.name AS requester_name,
                   MAX(tm.created_at) AS last_message_at
            FROM transporter_messages AS tm
            JOIN users AS u ON u.id = tm.requester_id
            WHERE tm.transporter_id = :transporter_id
            GROUP BY tm.requester_id, u.name
            ORDER BY last_message_at DESC
            """,
            transporter_id=transporter_id,
        )
    conversation_requester_id = (
        requester_id if is_transporter else current_user.id
    )
    if conversation_requester_id is None:
        raise HTTPException(status_code=400, detail="Choose a transport conversation")
    if is_transporter and not rows(
        """
        SELECT id FROM transporter_messages
        WHERE transporter_id = :transporter_id AND requester_id = :requester_id
        LIMIT 1
        """,
        transporter_id=transporter_id,
        requester_id=conversation_requester_id,
    ):
        raise HTTPException(status_code=404, detail="Transport conversation not found")
    return rows(
        """
        SELECT id, requester_id, sender_id, body, created_at
        FROM transporter_messages
        WHERE transporter_id = :transporter_id
          AND requester_id = :requester_id
        ORDER BY id
        """,
        transporter_id=transporter_id,
        requester_id=conversation_requester_id,
    )


@app.post("/api/transporters/{transporter_id}/messages")
def send_transporter_message(
    transporter_id: int,
    request: TransporterMessageRequest,
    current_user: AuthenticatedUser = Depends(require_role("buyer", "farmer")),
):
    profiles = rows(
        """
        SELECT id, user_id, contact_consent
        FROM transporter_profiles
        WHERE id = :transporter_id
        """,
        transporter_id=transporter_id,
    )
    if not profiles:
        raise HTTPException(status_code=404, detail="Transporter not found")
    transporter_user_id = int(profiles[0]["user_id"])
    is_transporter = transporter_user_id == current_user.id
    if not is_transporter and not profiles[0]["contact_consent"]:
        raise HTTPException(status_code=404, detail="Transporter not found")
    if is_transporter:
        if request.requester_id is None:
            raise HTTPException(status_code=400, detail="Choose a transport conversation")
        requester_id = request.requester_id
        if not rows(
            """
            SELECT id FROM transporter_messages
            WHERE transporter_id = :transporter_id AND requester_id = :requester_id
            LIMIT 1
            """,
            transporter_id=transporter_id,
            requester_id=requester_id,
        ):
            raise HTTPException(status_code=404, detail="Transport conversation not found")
    else:
        if request.requester_id is not None:
            raise HTTPException(status_code=403, detail="You can only send messages as yourself")
        requester_id = current_user.id
    with engine.begin() as connection:
        message_id = connection.execute(
            text(
                """
                INSERT INTO transporter_messages
                    (transporter_id, requester_id, sender_id, body)
                VALUES (:transporter_id, :requester_id, :sender_id, :body)
                RETURNING id
                """
            ),
            {
                "transporter_id": transporter_id,
                "requester_id": requester_id,
                "sender_id": current_user.id,
                "body": request.body,
            },
        ).scalar()
    return {"id": message_id, "ok": True}


@app.post("/api/farms/apply")
def apply_for_farm(
    request: FarmApplication,
    current_user: AuthenticatedUser = Depends(require_role("farmer")),
):
    if not _marketplace_options()["farm_applications_enabled"]:
        raise HTTPException(
            status_code=503,
            detail="New farm applications are temporarily closed",
        )
    if request.county.strip() not in _marketplace_options()["counties"]:
        raise HTTPException(status_code=400, detail="Select a supported county")
    phone = rows(
        "SELECT phone_verified FROM users WHERE id = :user_id",
        user_id=current_user.id,
    )
    if not phone or not phone[0]["phone_verified"]:
        raise HTTPException(status_code=403, detail="Verify your phone before registering a farm")
    with engine.begin() as connection:
        existing = connection.execute(
            text("SELECT id FROM farms WHERE owner_id = :owner_id"),
            {"owner_id": current_user.id},
        ).first()
        if existing:
            raise HTTPException(status_code=409, detail="This farmer already has an assigned farm")
        farm_id = connection.execute(
            text(
                """
                INSERT INTO farms
                    (owner_id, name, county, size_acres, farming_methods, status, verification_level)
                VALUES
                    (:owner_id, :name, :county, :size_acres, :farming_methods, 'pending', 'unverified')
                RETURNING id
                """
            ),
            {
                "owner_id": current_user.id,
                "name": request.name.strip(),
                "county": request.county.strip(),
                "size_acres": request.size_acres,
                "farming_methods": request.farming_methods.strip(),
            },
        ).scalar()
    return {"id": farm_id, "ok": True, "status": "pending"}


@app.get("/api/farms/{farm_id}/products")
def farm_products(
    farm_id: int,
    current_user: AuthenticatedUser = Depends(require_role("farmer")),
):
    _owned_verified_farm(farm_id, current_user)
    return rows(
        """
        SELECT id, farm_id, name, description, category, variety, grade, unit,
               price_kes, stock, harvest_date, image_url, preorder_enabled,
               season_tier, trace_code
        FROM products
        WHERE farm_id = :farm_id
        ORDER BY name
        """,
        farm_id=farm_id,
    )


@app.post("/api/farms/{farm_id}/products")
def create_product(
    farm_id: int,
    product: ProductRequest,
    current_user: AuthenticatedUser = Depends(require_role("farmer")),
):
    _owned_verified_farm(farm_id, current_user)
    with engine.begin() as connection:
        _provisional_listing_limit(farm_id, connection)
        product_id = connection.execute(
            text(
                """
                INSERT INTO products
                    (farm_id, name, description, category, variety, grade, unit, price_kes, stock, harvest_date, image_url,
                     preorder_enabled, season_tier, trace_code)
                VALUES
                    (:farm_id, :name, :description, :category, :variety, :grade, :unit, :price_kes, :stock, :harvest_date, :image_url,
                     :preorder_enabled, :season_tier, :trace_code)
                RETURNING id
                """
            ),
            {
                "farm_id": farm_id,
                **product.model_dump(),
                "trace_code": uuid.uuid4().hex,
            },
        ).scalar()
        if product.preorder_enabled and product.harvest_date:
            offer = connection.execute(
                text(
                    """
                    SELECT p.name, f.county
                    FROM products AS p JOIN farms AS f ON f.id = p.farm_id
                    WHERE p.id = :product_id
                    """
                ),
                {"product_id": product_id},
            ).first()
            if offer:
                matching_buyers = connection.execute(
                    text(
                        """
                        SELECT DISTINCT d.buyer_id
                        FROM buyer_crop_demands AS d
                        JOIN products AS p
                          ON lower(trim(p.name)) = lower(trim(d.crop_name))
                        JOIN farms AS f ON f.id = p.farm_id
                        WHERE p.id = :product_id AND d.active = TRUE
                          AND lower(trim(d.county)) = lower(trim(f.county))
                          AND lower(trim(d.unit)) = lower(trim(p.unit))
                          AND d.min_quantity <= p.stock - (
                              SELECT COALESCE(SUM(c.quantity), 0)
                              FROM offtake_contracts AS c
                              WHERE c.product_id = p.id
                                AND (c.status = 'confirmed'
                                     OR (c.status = 'proposed'
                                         AND c.expires_at > CURRENT_TIMESTAMP))
                          )
                          AND (d.max_price_kes IS NULL OR p.price_kes <= d.max_price_kes)
                          AND p.harvest_date >= CURRENT_DATE
                          AND (d.harvest_from IS NULL OR p.harvest_date >= d.harvest_from)
                          AND (d.harvest_to IS NULL OR p.harvest_date <= d.harvest_to)
                          AND f.status = 'verified' AND f.admin_suspended = FALSE
                          AND p.admin_suspended = FALSE
                        """
                    ),
                    {"product_id": product_id},
                ).fetchall()
                for buyer in matching_buyers:
                    connection.execute(
                        text(
                            """
                            INSERT INTO notifications (user_id, category, title, body)
                            VALUES (:user_id, 'offtake', 'A harvest matches your demand',
                                    :body)
                            """
                        ),
                        {
                            "user_id": buyer.buyer_id,
                            "body": (
                                f"A future {offer.name} harvest in {offer.county} "
                                "matches one of your active crop demands."
                            ),
                        },
                    )
    return {"id": product_id, "ok": True}


@app.put("/api/farms/{farm_id}/products/{product_id}")
def update_product(
    farm_id: int,
    product_id: int,
    product: ProductRequest,
    background_tasks: BackgroundTasks,
    current_user: AuthenticatedUser = Depends(require_role("farmer")),
):
    _owned_verified_farm(farm_id, current_user)
    with engine.begin() as connection:
        previous = connection.execute(
            text(
                """
                SELECT name, unit, harvest_date, price_kes, stock FROM products
                WHERE id = :product_id AND farm_id = :farm_id
                """
                + (" FOR UPDATE" if engine.dialect.name == "postgresql" else "")
            ),
            {"product_id": product_id, "farm_id": farm_id},
        ).first()
        if previous is None:
            raise HTTPException(status_code=404, detail="Farm product not found")
        committed_quantity = connection.execute(
            text(
                """
                SELECT COALESCE(SUM(quantity), 0)
                FROM offtake_contracts
                WHERE product_id = :product_id
                  AND (status = 'confirmed'
                       OR (status = 'proposed'
                           AND expires_at > CURRENT_TIMESTAMP))
                """
            ),
            {"product_id": product_id},
        ).scalar_one()
        if product.stock < float(committed_quantity):
            raise HTTPException(
                status_code=409,
                detail="Listing quantity cannot be lower than its active offtake commitments",
            )
        previous_harvest_date = (
            str(previous.harvest_date)[:10] if previous.harvest_date else None
        )
        current_harvest_date = (
            product.harvest_date.isoformat() if product.harvest_date else None
        )
        if committed_quantity and (
            product.name.strip().casefold() != str(previous.name).strip().casefold()
            or product.unit.strip().casefold() != str(previous.unit).strip().casefold()
            or current_harvest_date != previous_harvest_date
        ):
            raise HTTPException(
                status_code=409,
                detail="Crop, unit and harvest date cannot change while an offtake agreement is active",
            )
        if float(previous.stock) <= 0 and product.stock > 0:
            _provisional_listing_limit(farm_id, connection)
        result = connection.execute(
            text(
                """
                UPDATE products
                SET name = :name, category = :category, variety = :variety,
                    description = :description, grade = :grade, unit = :unit, price_kes = :price_kes,
                    stock = :stock, harvest_date = :harvest_date, image_url = :image_url,
                    preorder_enabled = :preorder_enabled, season_tier = :season_tier
                WHERE id = :product_id AND farm_id = :farm_id
                """
            ),
            {
                "farm_id": farm_id,
                "product_id": product_id,
                **product.model_dump(),
            },
        )
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail="Farm product not found")
        triggered_alerts = []
        if float(previous.price_kes) != product.price_kes:
            triggered_alerts = connection.execute(
                text(
                    """
                    SELECT buyer_id, target_price_kes
                    FROM price_alerts
                    WHERE product_id = :product_id AND notified_at IS NULL
                      AND target_price_kes >= :price_kes
                    """
                ),
                {"product_id": product_id, "price_kes": product.price_kes},
            ).fetchall()
            if triggered_alerts:
                connection.execute(
                    text(
                        """
                        UPDATE price_alerts SET notified_at = CURRENT_TIMESTAMP
                        WHERE product_id = :product_id AND notified_at IS NULL
                          AND target_price_kes >= :price_kes
                        """
                    ),
                    {"product_id": product_id, "price_kes": product.price_kes},
                )
    if triggered_alerts:
        for alert in triggered_alerts:
            _notify_user(
                int(alert.buyer_id),
                "price",
                f"Price alert: {product.name}",
                (
                    f"{product.name} is now KES "
                    f"{product.price_kes} per {product.unit}, at or below your "
                    f"target of KES {alert.target_price_kes}."
                ),
                background_tasks,
            )
    if float(previous.price_kes) != product.price_kes:
        _notify_user(
            current_user.id,
            "price",
            f"Price updated: {product.name}",
            (
                f"Your listing price changed from KES {previous.price_kes} to "
                f"KES {product.price_kes} per {product.unit}."
            ),
            background_tasks,
        )
    return {"id": product_id, "ok": True}


class CropDemandRequest(BaseModel):
    crop_name: str = Field(min_length=2, max_length=100)
    county: str = Field(min_length=2, max_length=80)
    min_quantity: float = Field(gt=0, le=1_000_000_000)
    unit: str = Field(min_length=1, max_length=20)
    variety: str = Field(default="", max_length=100)
    request_type: Literal["bulk", "preorder"] = "preorder"
    recurrence: Literal["one_off", "weekly", "monthly"] = "one_off"
    needed_by: date | None = None
    delivery_location: str = Field(default="", max_length=200)
    delivery_method: Literal["pickup", "delivery"] = "delivery"
    quality_notes: str = Field(default="", max_length=1000)
    buyer_name: str = Field(default="", max_length=120)
    business_name: str = Field(default="", max_length=160)
    buyer_phone: str = Field(default="", max_length=30)
    buyer_email: str = Field(default="", max_length=254)
    farm_id: int | None = Field(default=None, gt=0)
    harvest_from: date | None = None
    harvest_to: date | None = None
    max_price_kes: float | None = Field(default=None, gt=0, le=1_000_000_000)

    @field_validator("crop_name", "county", "unit")
    @classmethod
    def normalize_demand_text(cls, value: str) -> str:
        return value.strip()

    @field_validator(
        "variety",
        "delivery_location",
        "quality_notes",
        "buyer_name",
        "business_name",
        "buyer_phone",
        "buyer_email",
    )
    @classmethod
    def normalize_optional_demand_text(cls, value: str) -> str:
        return value.strip()

    @model_validator(mode="after")
    def validate_harvest_window(self):
        if self.harvest_from and self.harvest_to and self.harvest_to < self.harvest_from:
            raise ValueError("Harvest end date must be on or after the start date")
        if self.needed_by and self.needed_by < date.today():
            raise ValueError("Needed-by date must be today or later")
        if self.buyer_email and not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", self.buyer_email):
            raise ValueError("Enter a valid buyer email address")
        return self


@app.get("/api/offtake/demands")
def get_offtake_demands(
    current_user: AuthenticatedUser = Depends(require_role("buyer", "farmer")),
):
    if current_user.role == "buyer":
        return rows(
            """
            SELECT id, crop_name, county, min_quantity, unit, harvest_from,
                   harvest_to, max_price_kes, active, created_at
            FROM buyer_crop_demands
            WHERE buyer_id = :user_id AND active = TRUE
            ORDER BY created_at DESC, id DESC
            """,
            user_id=current_user.id,
        )
    return rows(
        """
        SELECT DISTINCT d.id AS demand_id, d.crop_name, d.county, d.min_quantity,
               d.unit, d.harvest_from, d.harvest_to, d.max_price_kes,
               buyer.name AS buyer_name, p.id AS product_id, p.name AS product_name,
               p.harvest_date, p.stock, p.grade, p.price_kes, f.name AS farm_name
        FROM buyer_crop_demands AS d
        JOIN users AS buyer ON buyer.id = d.buyer_id
        JOIN products AS p ON lower(trim(p.name)) = lower(trim(d.crop_name))
        JOIN farms AS f ON f.id = p.farm_id
        WHERE f.owner_id = :user_id AND d.active = TRUE
          AND lower(trim(d.county)) = lower(trim(f.county))
          AND lower(trim(d.unit)) = lower(trim(p.unit))
          AND d.min_quantity <= p.stock - (
              SELECT COALESCE(SUM(c.quantity), 0)
              FROM offtake_contracts AS c
              WHERE c.product_id = p.id
                AND (c.status = 'confirmed'
                     OR (c.status = 'proposed'
                         AND c.expires_at > CURRENT_TIMESTAMP))
          )
          AND (d.max_price_kes IS NULL OR p.price_kes <= d.max_price_kes)
          AND p.preorder_enabled = TRUE AND p.harvest_date >= CURRENT_DATE
          AND (d.harvest_from IS NULL OR p.harvest_date >= d.harvest_from)
          AND (d.harvest_to IS NULL OR p.harvest_date <= d.harvest_to)
          AND f.status = 'verified' AND f.admin_suspended = FALSE
          AND p.admin_suspended = FALSE
        ORDER BY p.harvest_date, d.id
        """,
        user_id=current_user.id,
    )


@app.post("/api/offtake/demands")
def create_offtake_demand(
    request: CropDemandRequest,
    current_user: AuthenticatedUser = Depends(require_role("buyer")),
):
    counties = _marketplace_options()["counties"]
    if not any(str(county).casefold() == request.county.casefold() for county in counties):
        raise HTTPException(status_code=400, detail="Choose a county from the marketplace list")
    with engine.begin() as connection:
        demand_id = connection.execute(
            text(
                """
                INSERT INTO buyer_crop_demands
                    (buyer_id, crop_name, county, min_quantity, unit,
                     harvest_from, harvest_to, max_price_kes)
                VALUES
                    (:buyer_id, :crop_name, :county, :min_quantity, :unit,
                     :harvest_from, :harvest_to, :max_price_kes)
                RETURNING id
                """
            ),
            {
                "buyer_id": current_user.id,
                "crop_name": request.crop_name,
                "county": request.county,
                "min_quantity": request.min_quantity,
                "unit": request.unit,
                "harvest_from": request.harvest_from,
                "harvest_to": request.harvest_to,
                "max_price_kes": request.max_price_kes,
            },
        ).scalar_one()
        matching_farmers = connection.execute(
            text(
                """
                SELECT DISTINCT f.owner_id
                FROM products AS p
                JOIN farms AS f ON f.id = p.farm_id
                WHERE lower(trim(p.name)) = lower(trim(:crop_name))
                  AND lower(trim(f.county)) = lower(trim(:county))
                  AND lower(trim(p.unit)) = lower(trim(:unit))
                  AND p.stock - (
                      SELECT COALESCE(SUM(c.quantity), 0)
                      FROM offtake_contracts AS c
                      WHERE c.product_id = p.id
                        AND (c.status = 'confirmed'
                             OR (c.status = 'proposed'
                                 AND c.expires_at > CURRENT_TIMESTAMP))
                  ) >= :min_quantity
                  AND (:max_price_kes IS NULL OR p.price_kes <= :max_price_kes)
                  AND p.preorder_enabled = TRUE AND p.harvest_date >= CURRENT_DATE
                  AND (:harvest_from IS NULL OR p.harvest_date >= :harvest_from)
                  AND (:harvest_to IS NULL OR p.harvest_date <= :harvest_to)
                  AND f.status = 'verified' AND f.admin_suspended = FALSE
                  AND p.admin_suspended = FALSE
                """
            ),
            {
                "crop_name": request.crop_name,
                "county": request.county,
                "unit": request.unit,
                "min_quantity": request.min_quantity,
                "max_price_kes": request.max_price_kes,
                "harvest_from": request.harvest_from,
                "harvest_to": request.harvest_to,
            },
        ).fetchall()
        for farmer in matching_farmers:
            if farmer.owner_id is None:
                continue
            connection.execute(
                text(
                    """
                    INSERT INTO notifications (user_id, category, title, body)
                    VALUES (:user_id, 'offtake', 'Buyer demand matches your harvest',
                            :body)
                    """
                ),
                {
                    "user_id": farmer.owner_id,
                    "body": (
                        f"A buyer is looking for {request.min_quantity:g} "
                        f"{request.unit} of {request.crop_name} in {request.county}."
                    ),
                },
            )
    return {"id": demand_id, "ok": True}


@app.delete("/api/offtake/demands/{demand_id}")
def deactivate_offtake_demand(
    demand_id: int,
    current_user: AuthenticatedUser = Depends(require_role("buyer")),
):
    with engine.begin() as connection:
        result = connection.execute(
            text(
                """
                UPDATE buyer_crop_demands SET active = FALSE
                WHERE id = :demand_id AND buyer_id = :buyer_id
                """
            ),
            {"demand_id": demand_id, "buyer_id": current_user.id},
        )
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail="Buyer demand not found")
        connection.execute(
            text(
                """
                UPDATE offtake_quotes SET status = 'cancelled',
                       updated_at = CURRENT_TIMESTAMP
                WHERE demand_id = :demand_id AND status = 'quoted'
                """
            ),
            {"demand_id": demand_id},
        )
    return {"ok": True}


def _offtake_request_summary_sql() -> str:
    return """
        SELECT d.id, d.buyer_id, d.crop_name, d.variety, d.county,
               d.min_quantity, d.unit, d.request_type, d.recurrence,
               d.needed_by, d.harvest_from, d.harvest_to, d.max_price_kes,
               d.delivery_location, d.delivery_method, d.quality_notes,
               d.buyer_name, d.business_name, d.buyer_phone, d.buyer_email,
               d.farm_id, target_farm.name AS target_farm_name,
               d.active, d.created_at,
               COALESCE((SELECT SUM(q.quantity) FROM offtake_quotes AS q
                         WHERE q.demand_id = d.id
                           AND q.status IN ('accepted', 'fulfilled')), 0)
                   AS accepted_quantity,
               COALESCE((SELECT SUM(q.quantity) FROM offtake_quotes AS q
                         JOIN orders AS o ON o.id = q.order_id
                         WHERE q.demand_id = d.id
                           AND o.status IN ('paid', 'delivered')), 0)
                   AS paid_quantity,
               COALESCE((SELECT SUM(q.quantity) FROM offtake_quotes AS q
                         WHERE q.demand_id = d.id AND q.status = 'fulfilled'), 0)
                   AS fulfilled_quantity,
               (SELECT COUNT(*) FROM offtake_quotes AS q
                WHERE q.demand_id = d.id AND q.status = 'quoted'
                  AND q.expires_at > CURRENT_TIMESTAMP) AS open_quote_count,
               CASE
                 WHEN d.active = FALSE THEN 'cancelled'
                 WHEN COALESCE((SELECT SUM(q.quantity) FROM offtake_quotes AS q
                                WHERE q.demand_id = d.id
                                  AND q.status = 'fulfilled'), 0) >= d.min_quantity
                   THEN 'fulfilled'
                 WHEN COALESCE((SELECT SUM(q.quantity) FROM offtake_quotes AS q
                                JOIN orders AS o ON o.id = q.order_id
                                WHERE q.demand_id = d.id
                                  AND o.status IN ('paid', 'delivered')), 0) > 0
                   THEN 'paid'
                 WHEN COALESCE((SELECT SUM(q.quantity) FROM offtake_quotes AS q
                                WHERE q.demand_id = d.id
                                  AND q.status IN ('accepted', 'fulfilled')), 0) > 0
                   THEN 'accepted'
                 WHEN EXISTS (SELECT 1 FROM offtake_quotes AS q
                              WHERE q.demand_id = d.id AND q.status = 'quoted'
                                AND q.expires_at > CURRENT_TIMESTAMP)
                   THEN 'quoted'
                 ELSE 'submitted'
               END AS status
        FROM buyer_crop_demands AS d
        LEFT JOIN farms AS target_farm ON target_farm.id = d.farm_id
    """


@app.get("/api/offtake/requests")
def get_offtake_requests(
    current_user: AuthenticatedUser = Depends(require_role("buyer", "farmer")),
):
    with engine.begin() as connection:
        connection.execute(
            text(
                """
                UPDATE offtake_quotes SET status = 'expired',
                       updated_at = CURRENT_TIMESTAMP
                WHERE status = 'quoted' AND expires_at <= CURRENT_TIMESTAMP
                """
            )
        )
    if current_user.role == "buyer":
        return rows(
            _offtake_request_summary_sql()
            + """
            WHERE d.buyer_id = :user_id
            ORDER BY d.created_at DESC, d.id DESC
            """,
            user_id=current_user.id,
        )
    return rows(
        _offtake_request_summary_sql()
        + """
        JOIN farms AS matching_farm
          ON matching_farm.status = 'verified'
         AND matching_farm.admin_suspended = FALSE
         AND matching_farm.owner_id = :user_id
         AND (d.farm_id = matching_farm.id OR
              (d.farm_id IS NULL
               AND lower(trim(d.county)) = lower(trim(matching_farm.county))))
        WHERE d.active = TRUE
          AND (d.farm_id = matching_farm.id OR EXISTS (
              SELECT 1 FROM products AS matching_product
              WHERE matching_product.farm_id = matching_farm.id
                AND lower(trim(matching_product.name)) = lower(trim(d.crop_name))
                AND (d.variety = ''
                     OR lower(trim(matching_product.variety)) = lower(trim(d.variety)))
                AND lower(trim(matching_product.unit)) = lower(trim(d.unit))
                AND matching_product.admin_suspended = FALSE
          ))
        ORDER BY d.created_at DESC, d.id DESC
        """,
        user_id=current_user.id,
    )


@app.post("/api/offtake/requests")
def create_offtake_request(
    request: CropDemandRequest,
    background_tasks: BackgroundTasks,
    current_user: AuthenticatedUser = Depends(require_role("buyer")),
):
    counties = _marketplace_options()["counties"]
    if not any(str(county).casefold() == request.county.casefold() for county in counties):
        raise HTTPException(status_code=400, detail="Choose a county from the marketplace list")
    if request.farm_id is not None:
        target = rows(
            """
            SELECT id FROM farms
            WHERE id = :farm_id AND status = 'verified'
              AND admin_suspended = FALSE
            """,
            farm_id=request.farm_id,
        )
        if not target:
            raise HTTPException(status_code=404, detail="Selected verified farm not found")
    with engine.begin() as connection:
        demand_id = connection.execute(
            text(
                """
                INSERT INTO buyer_crop_demands
                    (buyer_id, crop_name, variety, county, min_quantity, unit,
                     harvest_from, harvest_to, max_price_kes, request_type,
                     recurrence, needed_by, delivery_location, delivery_method,
                     quality_notes, buyer_name, business_name, buyer_phone,
                     buyer_email, farm_id)
                VALUES
                    (:buyer_id, :crop_name, :variety, :county, :quantity, :unit,
                     :harvest_from, :needed_by, :target_price, :request_type,
                     :recurrence, :needed_by, :delivery_location, :delivery_method,
                     :quality_notes, :buyer_name, :business_name, :buyer_phone,
                     :buyer_email, :farm_id)
                RETURNING id
                """
            ),
            {
                "buyer_id": current_user.id,
                "crop_name": request.crop_name,
                "variety": request.variety,
                "county": request.county,
                "quantity": request.min_quantity,
                "unit": request.unit,
                "harvest_from": request.needed_by if request.request_type == "preorder" else None,
                "needed_by": request.needed_by,
                "target_price": request.max_price_kes,
                "request_type": request.request_type,
                "recurrence": request.recurrence,
                "delivery_location": request.delivery_location or request.county,
                "delivery_method": request.delivery_method,
                "quality_notes": request.quality_notes,
                "buyer_name": request.buyer_name or current_user.name,
                "business_name": request.business_name,
                "buyer_phone": request.buyer_phone,
                "buyer_email": request.buyer_email,
                "farm_id": request.farm_id,
            },
        ).scalar_one()
        matching_farmers = connection.execute(
            text(
                """
                SELECT DISTINCT farmer.id, farmer.phone
                FROM farms AS farm
                JOIN users AS farmer ON farmer.id = farm.owner_id
                LEFT JOIN products AS product ON product.farm_id = farm.id
                WHERE farm.status = 'verified' AND farm.admin_suspended = FALSE
                  AND farmer.role = 'farmer' AND farmer.account_status = 'active'
                  AND (
                    (CAST(:farm_id AS INTEGER) IS NOT NULL AND farm.id = :farm_id)
                    OR (CAST(:farm_id AS INTEGER) IS NULL
                        AND lower(trim(farm.county)) = lower(trim(:county))
                        AND lower(trim(product.name)) = lower(trim(:crop_name))
                        AND (:variety = ''
                             OR lower(trim(product.variety)) = lower(trim(:variety)))
                        AND lower(trim(product.unit)) = lower(trim(:unit))
                        AND product.admin_suspended = FALSE)
                  )
                """
            ),
            {
                "farm_id": request.farm_id,
                "county": request.county,
                "crop_name": request.crop_name,
                "variety": request.variety,
                "unit": request.unit,
            },
        ).fetchall()
        for farmer in matching_farmers:
            connection.execute(
                text(
                    """
                    INSERT INTO notifications (user_id, category, title, body)
                    VALUES (:user_id, 'offtake', 'New bulk produce request', :body)
                    """
                ),
                {
                    "user_id": farmer.id,
                    "body": (
                        f"{request.min_quantity:g} {request.unit} of "
                        f"{request.crop_name} is requested in {request.county}. "
                        "Open Harvest Matching to send a quote."
                    ),
                },
            )
    if settings.africastalking_username and settings.africastalking_api_key:
        for farmer in matching_farmers:
            background_tasks.add_task(
                _send_farmer_message_sms,
                str(farmer.phone),
                f"New Mkulima Connect request: {request.min_quantity:g} "
                f"{request.unit} {request.crop_name} in {request.county}. "
                "Sign in to review and quote.",
            )
    return {"id": demand_id, "ok": True}


def _offtake_quote_summary_sql() -> str:
    return """
        SELECT q.id, q.demand_id, q.farmer_id, q.farm_id, q.product_id,
               q.quantity, q.unit, q.unit_price_kes, q.quality_notes,
               q.delivery_location, q.status AS quote_status, q.order_id,
               q.supersedes_quote_id, q.expires_at, q.created_at,
               d.crop_name, d.variety, d.request_type, d.recurrence,
               d.min_quantity AS requested_quantity, d.unit AS requested_unit,
               d.county, d.needed_by, d.delivery_method, d.buyer_name,
               d.business_name, d.buyer_phone, d.buyer_email,
               buyer.name AS account_buyer_name, farmer.name AS farmer_name,
               farm.name AS farm_name, product.name AS product_name,
               product.harvest_date, product.grade,
               order_record.status AS order_status,
               (SELECT payment.status FROM payments AS payment
                WHERE payment.order_id = q.order_id
                ORDER BY payment.id DESC LIMIT 1) AS payment_status,
               CASE
                 WHEN q.status = 'accepted' AND order_record.status = 'paid'
                   THEN 'paid'
                 ELSE q.status
               END AS status
        FROM offtake_quotes AS q
        JOIN buyer_crop_demands AS d ON d.id = q.demand_id
        JOIN users AS buyer ON buyer.id = d.buyer_id
        JOIN users AS farmer ON farmer.id = q.farmer_id
        JOIN farms AS farm ON farm.id = q.farm_id
        LEFT JOIN products AS product ON product.id = q.product_id
        LEFT JOIN orders AS order_record ON order_record.id = q.order_id
    """


@app.get("/api/offtake/quotes")
def get_offtake_quotes(
    current_user: AuthenticatedUser = Depends(require_role("buyer", "farmer")),
):
    with engine.begin() as connection:
        connection.execute(
            text(
                """
                UPDATE offtake_quotes SET status = 'expired',
                       updated_at = CURRENT_TIMESTAMP
                WHERE status = 'quoted' AND expires_at <= CURRENT_TIMESTAMP
                """
            )
        )
    participant_column = "buyer_id" if current_user.role == "buyer" else "farmer_id"
    participant_table = "d" if current_user.role == "buyer" else "q"
    return rows(
        _offtake_quote_summary_sql()
        + f"""
        WHERE {participant_table}.{participant_column} = :user_id
        ORDER BY q.created_at DESC, q.id DESC
        """,
        user_id=current_user.id,
    )


class OfftakeQuoteRequest(BaseModel):
    farm_id: int = Field(gt=0)
    product_id: int = Field(gt=0)
    quantity: float = Field(gt=0, le=1_000_000_000)
    unit_price_kes: float = Field(gt=0, le=1_000_000_000)
    quality_notes: str = Field(default="", max_length=1000)
    delivery_location: str = Field(min_length=2, max_length=200)
    supersedes_quote_id: int | None = Field(default=None, gt=0)

    @field_validator("quality_notes", "delivery_location")
    @classmethod
    def normalize_quote_text(cls, value: str) -> str:
        return value.strip()


@app.post("/api/offtake/requests/{demand_id}/quotes")
def create_offtake_quote(
    demand_id: int,
    request: OfftakeQuoteRequest,
    background_tasks: BackgroundTasks,
    current_user: AuthenticatedUser = Depends(require_role("farmer")),
):
    expiry = datetime.now(timezone.utc) + timedelta(days=7)
    if engine.dialect.name == "sqlite":
        expiry = expiry.strftime("%Y-%m-%d %H:%M:%S")
    with engine.begin() as connection:
        connection.execute(
            text(
                """
                UPDATE offtake_quotes SET status = 'expired',
                       updated_at = CURRENT_TIMESTAMP
                WHERE status = 'quoted' AND expires_at <= CURRENT_TIMESTAMP
                """
            )
        )
        demand = connection.execute(
            text(
                """
                SELECT d.*, buyer.phone AS account_phone
                FROM buyer_crop_demands AS d
                JOIN users AS buyer ON buyer.id = d.buyer_id
                WHERE d.id = :demand_id AND d.active = TRUE
                """
            ),
            {"demand_id": demand_id},
        ).first()
        if demand is None:
            raise HTTPException(status_code=404, detail="Active buyer request not found")
        if request.quantity > float(demand.min_quantity):
            raise HTTPException(
                status_code=400,
                detail="A farm quote cannot exceed the buyer's total requested quantity",
            )
        farm = connection.execute(
            text(
                """
                SELECT id, county FROM farms
                WHERE id = :farm_id AND owner_id = :farmer_id
                  AND status = 'verified' AND admin_suspended = FALSE
                """
            ),
            {"farm_id": request.farm_id, "farmer_id": current_user.id},
        ).first()
        if farm is None:
            raise HTTPException(status_code=404, detail="Select one of your verified farms")
        if demand.farm_id is not None and demand.farm_id != farm.id:
            raise HTTPException(status_code=403, detail="This request was sent to a different farm")
        if demand.farm_id is None and str(farm.county).casefold() != str(demand.county).casefold():
            raise HTTPException(status_code=400, detail="Your farm is outside the requested county")
        product = connection.execute(
            text(
                """
                SELECT p.id, p.farm_id, p.name, p.variety, p.unit, p.stock,
                       p.preorder_enabled, p.harvest_date, p.admin_suspended
                FROM products AS p
                WHERE p.id = :product_id
                """
            ),
            {"product_id": request.product_id},
        ).first()
        if (
            product is None
            or product.farm_id != farm.id
            or product.admin_suspended
            or str(product.name).strip().casefold() != str(demand.crop_name).strip().casefold()
            or str(product.unit).strip().casefold() != str(demand.unit).strip().casefold()
            or (
                demand.variety
                and str(product.variety).strip().casefold()
                != str(demand.variety).strip().casefold()
            )
        ):
            raise HTTPException(status_code=400, detail="Choose an active matching product from this farm")
        if float(product.stock) < request.quantity:
            raise HTTPException(status_code=409, detail="Your listed stock is below the quantity in this quote")
        if demand.request_type == "preorder":
            harvest_day = date.fromisoformat(str(product.harvest_date)[:10]) if product.harvest_date else None
            needed_day = date.fromisoformat(str(demand.needed_by)[:10]) if demand.needed_by else None
            if (
                not product.preorder_enabled
                or harvest_day is None
                or harvest_day < date.today()
                or (needed_day is not None and harvest_day > needed_day)
            ):
                raise HTTPException(status_code=400, detail="Pre-orders require a future harvest available by the requested date")
        if request.supersedes_quote_id is not None:
            previous = connection.execute(
                text(
                    """
                    SELECT id, demand_id, farmer_id, status
                    FROM offtake_quotes
                    WHERE id = :quote_id AND expires_at > CURRENT_TIMESTAMP
                    """
                ),
                {"quote_id": request.supersedes_quote_id},
            ).first()
            if (
                previous is None
                or previous.demand_id != demand_id
                or previous.farmer_id != current_user.id
                or previous.status != "quoted"
            ):
                raise HTTPException(status_code=409, detail="Only your active quote can be countered")
            connection.execute(
                text(
                    """
                    UPDATE offtake_quotes SET status = 'countered',
                           updated_at = CURRENT_TIMESTAMP
                    WHERE id = :quote_id
                    """
                ),
                {"quote_id": request.supersedes_quote_id},
            )
        quote_id = connection.execute(
            text(
                """
                INSERT INTO offtake_quotes
                    (demand_id, farmer_id, farm_id, product_id, quantity, unit,
                     unit_price_kes, quality_notes, delivery_location,
                     supersedes_quote_id, expires_at)
                VALUES
                    (:demand_id, :farmer_id, :farm_id, :product_id, :quantity, :unit,
                     :unit_price_kes, :quality_notes, :delivery_location,
                     :supersedes_quote_id, :expires_at)
                RETURNING id
                """
            ),
            {
                "demand_id": demand_id,
                "farmer_id": current_user.id,
                "farm_id": farm.id,
                "product_id": product.id,
                "quantity": request.quantity,
                "unit": product.unit,
                "unit_price_kes": request.unit_price_kes,
                "quality_notes": request.quality_notes,
                "delivery_location": request.delivery_location,
                "supersedes_quote_id": request.supersedes_quote_id,
                "expires_at": expiry,
            },
        ).scalar_one()
        connection.execute(
            text(
                """
                INSERT INTO notifications (user_id, category, title, body)
                VALUES (:user_id, 'offtake', 'Farmer sent a bulk quote', :body)
                """
            ),
            {
                "user_id": demand.buyer_id,
                "body": (
                    f"{request.quantity:g} {product.unit} of {demand.crop_name} "
                    f"from {farm.id} was quoted at KES {request.unit_price_kes:g} "
                    "per unit. Review it in Harvest Matching."
                ),
            },
        )
        buyer_phone = str(demand.buyer_phone or demand.account_phone or "")
    if (
        buyer_phone
        and settings.africastalking_username
        and settings.africastalking_api_key
    ):
        background_tasks.add_task(
            _send_farmer_message_sms,
            buyer_phone,
            f"Mkulima Connect: a farmer quoted {demand.crop_name} at "
            f"KES {request.unit_price_kes:g} per {product.unit}. Sign in to review.",
        )
    return {"id": quote_id, "ok": True}


@app.post("/api/offtake/quotes/{quote_id}/{action}")
def respond_to_offtake_quote(
    quote_id: int,
    action: Literal["accept", "decline", "withdraw", "fulfill", "cancel"],
    current_user: AuthenticatedUser = Depends(require_role("buyer", "farmer")),
):
    with engine.begin() as connection:
        connection.execute(
            text(
                """
                UPDATE offtake_quotes SET status = 'expired',
                       updated_at = CURRENT_TIMESTAMP
                WHERE status = 'quoted' AND expires_at <= CURRENT_TIMESTAMP
                """
            )
        )
        quote = connection.execute(
            text(
                """
                SELECT q.id, q.demand_id, q.farmer_id, q.farm_id, q.product_id,
                       q.quantity, q.unit, q.unit_price_kes, q.status, q.order_id,
                       d.buyer_id, d.min_quantity, d.active,
                       p.stock, p.admin_suspended, f.status AS farm_status,
                       f.admin_suspended AS farm_suspended
                FROM offtake_quotes AS q
                JOIN buyer_crop_demands AS d ON d.id = q.demand_id
                JOIN products AS p ON p.id = q.product_id
                JOIN farms AS f ON f.id = q.farm_id
                WHERE q.id = :quote_id
                """
            ),
            {"quote_id": quote_id},
        ).first()
        if quote is None:
            raise HTTPException(status_code=404, detail="Offtake quote not found")
        if action in ("accept", "decline", "fulfill", "cancel"):
            if current_user.role != "buyer" or current_user.id != quote.buyer_id:
                raise HTTPException(status_code=403, detail="Only the buyer can respond to this quote")
        elif current_user.role != "farmer" or current_user.id != quote.farmer_id:
            raise HTTPException(status_code=403, detail="Only the quoting farmer can withdraw this quote")

        if action == "accept":
            if quote.status != "quoted" or not quote.active:
                raise HTTPException(status_code=409, detail="This quote is no longer available")
            accepted = connection.execute(
                text(
                    """
                    SELECT COALESCE(SUM(quantity), 0)
                    FROM offtake_quotes
                    WHERE demand_id = :demand_id AND status IN ('accepted', 'fulfilled')
                    """
                ),
                {"demand_id": quote.demand_id},
            ).scalar_one()
            if float(accepted) + float(quote.quantity) > float(quote.min_quantity):
                raise HTTPException(
                    status_code=409,
                    detail="Other farms have already quoted enough to cover the request",
                )
            if (
                quote.farm_status != "verified"
                or quote.farm_suspended
                or quote.admin_suspended
                or float(quote.stock) < float(quote.quantity)
            ):
                raise HTTPException(status_code=409, detail="The quoted harvest is no longer available")
            total = float(quote.quantity) * float(quote.unit_price_kes)
            order_id = connection.execute(
                text(
                    "INSERT INTO orders (buyer_id, total_kes) "
                    "VALUES (:buyer_id, :total) RETURNING id"
                ),
                {"buyer_id": quote.buyer_id, "total": total},
            ).scalar_one()
            connection.execute(
                text(
                    """
                    INSERT INTO order_items (order_id, product_id, qty, price_kes)
                    VALUES (:order_id, :product_id, :quantity, :unit_price)
                    """
                ),
                {
                    "order_id": order_id,
                    "product_id": quote.product_id,
                    "quantity": quote.quantity,
                    "unit_price": quote.unit_price_kes,
                },
            )
            connection.execute(
                text(
                    "UPDATE products SET stock = stock - :quantity WHERE id = :product_id"
                ),
                {"quantity": quote.quantity, "product_id": quote.product_id},
            )
            connection.execute(
                text(
                    """
                    UPDATE offtake_quotes SET status = 'accepted', order_id = :order_id,
                           updated_at = CURRENT_TIMESTAMP
                    WHERE id = :quote_id
                    """
                ),
                {"order_id": order_id, "quote_id": quote_id},
            )
            connection.execute(
                text(
                    """
                    INSERT INTO notifications (user_id, category, title, body)
                    VALUES (:user_id, 'offtake', 'Bulk quote accepted',
                            'Your quote was accepted. Ask the buyer to complete M-Pesa payment.')
                    """
                ),
                {"user_id": quote.farmer_id},
            )
        elif action == "decline":
            if quote.status != "quoted":
                raise HTTPException(status_code=409, detail="Only an active quote can be declined")
            connection.execute(
                text(
                    """
                    UPDATE offtake_quotes SET status = 'declined',
                           updated_at = CURRENT_TIMESTAMP WHERE id = :quote_id
                    """
                ),
                {"quote_id": quote_id},
            )
            order_id = None
        elif action == "withdraw":
            if quote.status != "quoted":
                raise HTTPException(status_code=409, detail="Only an active quote can be withdrawn")
            connection.execute(
                text(
                    """
                    UPDATE offtake_quotes SET status = 'cancelled',
                           updated_at = CURRENT_TIMESTAMP WHERE id = :quote_id
                    """
                ),
                {"quote_id": quote_id},
            )
            order_id = None
        elif action == "fulfill":
            if quote.status != "accepted" or quote.order_id is None:
                raise HTTPException(status_code=409, detail="The quote must be accepted before delivery")
            order = connection.execute(
                text("SELECT status FROM orders WHERE id = :order_id"),
                {"order_id": quote.order_id},
            ).first()
            if order is None or order.status != "paid":
                raise HTTPException(status_code=409, detail="M-Pesa payment must be confirmed before fulfillment")
            connection.execute(
                text("UPDATE orders SET status = 'delivered' WHERE id = :order_id"),
                {"order_id": quote.order_id},
            )
            connection.execute(
                text(
                    "UPDATE order_items SET fulfillment_status = 'delivered' "
                    "WHERE order_id = :order_id"
                ),
                {"order_id": quote.order_id},
            )
            connection.execute(
                text(
                    """
                    UPDATE offtake_quotes SET status = 'fulfilled',
                           updated_at = CURRENT_TIMESTAMP WHERE id = :quote_id
                    """
                ),
                {"quote_id": quote_id},
            )
            order_id = quote.order_id
        else:
            if quote.status != "accepted" or quote.order_id is None:
                raise HTTPException(status_code=409, detail="Only an unpaid accepted quote can be cancelled")
            payment = connection.execute(
                text(
                    """
                    SELECT status FROM payments
                    WHERE order_id = :order_id
                    ORDER BY id DESC LIMIT 1
                    """
                ),
                {"order_id": quote.order_id},
            ).first()
            order = connection.execute(
                text("SELECT status FROM orders WHERE id = :order_id"),
                {"order_id": quote.order_id},
            ).first()
            if (
                order is None
                or order.status != "pending"
                or (payment is not None and payment.status == "initiated")
            ):
                raise HTTPException(
                    status_code=409,
                    detail="This order cannot be cancelled while payment is pending or confirmed",
                )
            connection.execute(
                text(
                    "UPDATE products SET stock = stock + :quantity WHERE id = :product_id"
                ),
                {"quantity": quote.quantity, "product_id": quote.product_id},
            )
            connection.execute(
                text("UPDATE orders SET status = 'cancelled' WHERE id = :order_id"),
                {"order_id": quote.order_id},
            )
            connection.execute(
                text(
                    """
                    UPDATE offtake_quotes SET status = 'cancelled',
                           updated_at = CURRENT_TIMESTAMP WHERE id = :quote_id
                    """
                ),
                {"quote_id": quote_id},
            )
            order_id = quote.order_id
    return {"ok": True, "order_id": order_id, "status": action}


@app.get("/api/offtake/matches")
def get_offtake_matches(
    current_user: AuthenticatedUser = Depends(require_role("buyer", "farmer")),
):
    if current_user.role == "buyer":
        return rows(
            """
            SELECT d.id AS demand_id, d.crop_name, d.min_quantity,
                   d.unit AS demand_unit, d.county, d.harvest_from, d.harvest_to,
                   d.max_price_kes, p.id AS product_id, p.name AS product_name,
                   p.variety, p.grade, p.unit,
                   p.stock - (
                       SELECT COALESCE(SUM(c.quantity), 0)
                       FROM offtake_contracts AS c
                       WHERE c.product_id = p.id
                         AND (c.status = 'confirmed'
                              OR (c.status = 'proposed'
                                  AND c.expires_at > CURRENT_TIMESTAMP))
                   ) AS stock,
                   p.price_kes,
                   p.harvest_date, f.id AS farm_id, f.name AS farm_name,
                   f.owner_id AS farmer_id, farmer.name AS farmer_name,
                   p.image_url,
                   (SELECT MIN(p2.price_kes) FROM products AS p2
                    JOIN farms AS f2 ON f2.id = p2.farm_id
                    WHERE lower(trim(p2.name)) = lower(trim(p.name))
                      AND lower(trim(p2.unit)) = lower(trim(p.unit))
                      AND lower(trim(f2.county)) = lower(trim(f.county))
                      AND p2.stock > 0 AND p2.admin_suspended = FALSE
                      AND f2.status = 'verified' AND f2.admin_suspended = FALSE
                   ) AS price_range_min_kes,
                   (SELECT MAX(p2.price_kes) FROM products AS p2
                    JOIN farms AS f2 ON f2.id = p2.farm_id
                    WHERE lower(trim(p2.name)) = lower(trim(p.name))
                      AND lower(trim(p2.unit)) = lower(trim(p.unit))
                      AND lower(trim(f2.county)) = lower(trim(f.county))
                      AND p2.stock > 0 AND p2.admin_suspended = FALSE
                      AND f2.status = 'verified' AND f2.admin_suspended = FALSE
                   ) AS price_range_max_kes
            FROM buyer_crop_demands AS d
            JOIN products AS p ON lower(trim(p.name)) = lower(trim(d.crop_name))
            JOIN farms AS f ON f.id = p.farm_id
            JOIN users AS farmer ON farmer.id = f.owner_id
            WHERE d.buyer_id = :user_id AND d.active = TRUE
              AND lower(trim(d.county)) = lower(trim(f.county))
              AND lower(trim(d.unit)) = lower(trim(p.unit))
              AND d.min_quantity <= p.stock - (
                  SELECT COALESCE(SUM(c.quantity), 0)
                  FROM offtake_contracts AS c
                  WHERE c.product_id = p.id
                    AND (c.status = 'confirmed'
                         OR (c.status = 'proposed'
                             AND c.expires_at > CURRENT_TIMESTAMP))
              )
              AND (d.max_price_kes IS NULL OR p.price_kes <= d.max_price_kes)
              AND p.preorder_enabled = TRUE AND p.harvest_date >= CURRENT_DATE
              AND (d.harvest_from IS NULL OR p.harvest_date >= d.harvest_from)
              AND (d.harvest_to IS NULL OR p.harvest_date <= d.harvest_to)
              AND f.status = 'verified' AND f.admin_suspended = FALSE
              AND farmer.role = 'farmer' AND farmer.account_status = 'active'
              AND p.admin_suspended = FALSE
              AND NOT EXISTS (
                  SELECT 1 FROM offtake_contracts AS c
                  WHERE c.demand_id = d.id AND c.product_id = p.id
                    AND c.buyer_id = d.buyer_id
                    AND c.status IN ('proposed', 'confirmed')
              )
            ORDER BY p.harvest_date, p.price_kes
            """,
            user_id=current_user.id,
        )
    return rows(
        """
        SELECT DISTINCT d.id AS demand_id, d.crop_name, d.min_quantity,
               d.unit AS demand_unit, d.county, d.harvest_from, d.harvest_to,
               d.max_price_kes, p.id AS product_id, p.name AS product_name,
               p.variety, p.grade, p.unit,
               p.stock - (
                   SELECT COALESCE(SUM(c.quantity), 0)
                   FROM offtake_contracts AS c
                   WHERE c.product_id = p.id
                     AND (c.status = 'confirmed'
                          OR (c.status = 'proposed'
                              AND c.expires_at > CURRENT_TIMESTAMP))
               ) AS stock,
               p.price_kes, p.harvest_date,
               f.id AS farm_id, f.name AS farm_name, f.owner_id AS farmer_id,
               buyer.name AS buyer_name, p.image_url,
               NULL AS price_range_min_kes, NULL AS price_range_max_kes
        FROM buyer_crop_demands AS d
        JOIN products AS p ON lower(trim(p.name)) = lower(trim(d.crop_name))
        JOIN farms AS f ON f.id = p.farm_id
        JOIN users AS buyer ON buyer.id = d.buyer_id
        WHERE f.owner_id = :user_id AND d.active = TRUE
          AND lower(trim(d.county)) = lower(trim(f.county))
          AND lower(trim(d.unit)) = lower(trim(p.unit))
          AND d.min_quantity <= p.stock - (
              SELECT COALESCE(SUM(c.quantity), 0)
              FROM offtake_contracts AS c
              WHERE c.product_id = p.id
                AND (c.status = 'confirmed'
                     OR (c.status = 'proposed'
                         AND c.expires_at > CURRENT_TIMESTAMP))
          )
          AND (d.max_price_kes IS NULL OR p.price_kes <= d.max_price_kes)
          AND p.preorder_enabled = TRUE AND p.harvest_date >= CURRENT_DATE
          AND (d.harvest_from IS NULL OR p.harvest_date >= d.harvest_from)
          AND (d.harvest_to IS NULL OR p.harvest_date <= d.harvest_to)
          AND f.status = 'verified' AND f.admin_suspended = FALSE
          AND p.admin_suspended = FALSE
        ORDER BY p.harvest_date, p.price_kes
        """,
        user_id=current_user.id,
    )


def _expire_offtake_proposals(connection) -> None:
    connection.execute(
        text(
            """
            UPDATE offtake_contracts SET status = 'expired',
                   updated_at = CURRENT_TIMESTAMP
            WHERE status = 'proposed' AND expires_at <= CURRENT_TIMESTAMP
            """
        )
    )


def _offtake_contract_summary() -> str:
    return """
        SELECT c.id, c.demand_id, c.product_id, c.buyer_id,
               buyer.name AS buyer_name, c.farmer_id, farmer.name AS farmer_name,
               p.name AS product_name, f.name AS farm_name, f.county,
               c.quantity, c.unit, c.unit_price_kes, c.grade,
               c.harvest_date, c.delivery_location, c.status, c.expires_at,
               c.created_at, c.updated_at
        FROM offtake_contracts AS c
        JOIN users AS buyer ON buyer.id = c.buyer_id
        JOIN users AS farmer ON farmer.id = c.farmer_id
        JOIN products AS p ON p.id = c.product_id
        JOIN farms AS f ON f.id = p.farm_id
    """


@app.get("/api/offtake/contracts")
def get_offtake_contracts(
    current_user: AuthenticatedUser = Depends(require_role("buyer", "farmer")),
):
    with engine.begin() as connection:
        _expire_offtake_proposals(connection)
    participant_column = "buyer_id" if current_user.role == "buyer" else "farmer_id"
    return rows(
        _offtake_contract_summary()
        + f"""
        WHERE c.{participant_column} = :user_id
        ORDER BY c.updated_at DESC, c.id DESC
        """,
        user_id=current_user.id,
    )


class OfftakeProposalRequest(BaseModel):
    demand_id: int = Field(gt=0)
    product_id: int = Field(gt=0)
    quantity: float = Field(gt=0, le=1_000_000_000)
    unit_price_kes: float = Field(gt=0, le=1_000_000_000)
    delivery_location: str = Field(min_length=2, max_length=200)

    @field_validator("delivery_location")
    @classmethod
    def normalize_delivery_location(cls, value: str) -> str:
        return value.strip()


@app.post("/api/offtake/contracts")
def propose_offtake_contract(
    request: OfftakeProposalRequest,
    current_user: AuthenticatedUser = Depends(require_role("buyer")),
):
    expiry = datetime.now(timezone.utc) + timedelta(days=7)
    if engine.dialect.name == "sqlite":
        expiry = expiry.strftime("%Y-%m-%d %H:%M:%S")
    with engine.begin() as connection:
        _expire_offtake_proposals(connection)
        demand = connection.execute(
            text(
                """
                SELECT id, crop_name, county, min_quantity, unit, harvest_from,
                       harvest_to, max_price_kes
                FROM buyer_crop_demands
                WHERE id = :demand_id AND buyer_id = :buyer_id AND active = TRUE
                """
            ),
            {"demand_id": request.demand_id, "buyer_id": current_user.id},
        ).first()
        if demand is None:
            raise HTTPException(status_code=404, detail="Active buyer demand not found")
        product = connection.execute(
            text(
                """
                SELECT p.id, p.name, p.unit, p.grade, p.stock, p.price_kes,
                       p.harvest_date, p.preorder_enabled, f.county,
                       f.owner_id AS farmer_id, f.status, f.admin_suspended
                FROM products AS p JOIN farms AS f ON f.id = p.farm_id
                WHERE p.id = :product_id AND p.admin_suspended = FALSE
                """
                + (" FOR UPDATE OF p" if engine.dialect.name == "postgresql" else "")
            ),
            {"product_id": request.product_id},
        ).first()
        if (
            product is None
            or product.status != "verified"
            or product.admin_suspended
        ):
            raise HTTPException(status_code=404, detail="Verified harvest offer not found")
        harvest_date = date.fromisoformat(str(product.harvest_date)[:10]) if product.harvest_date else None
        if (
            not product.preorder_enabled
            or harvest_date is None
            or harvest_date <= date.today()
        ):
            raise HTTPException(status_code=400, detail="Offtake agreements require an active future pre-order listing")
        if (
            str(product.name).strip().casefold() != str(demand.crop_name).strip().casefold()
            or str(product.unit).strip().casefold() != str(demand.unit).strip().casefold()
            or str(product.county).strip().casefold() != str(demand.county).strip().casefold()
            or float(demand.min_quantity) > request.quantity
            or (
                demand.harvest_from
                and harvest_date < date.fromisoformat(str(demand.harvest_from)[:10])
            )
            or (
                demand.harvest_to
                and harvest_date > date.fromisoformat(str(demand.harvest_to)[:10])
            )
            or (
                demand.max_price_kes is not None
                and request.unit_price_kes > float(demand.max_price_kes)
            )
        ):
            raise HTTPException(status_code=400, detail="Offer does not match your buyer demand")
        if product.farmer_id == current_user.id:
            raise HTTPException(status_code=403, detail="You cannot contract your own harvest")
        reserved = connection.execute(
            text(
                """
                SELECT COALESCE(SUM(quantity), 0)
                FROM offtake_contracts
                WHERE product_id = :product_id AND status IN ('proposed', 'confirmed')
                """
            ),
            {"product_id": request.product_id},
        ).scalar_one()
        if request.quantity + float(reserved) > float(product.stock):
            raise HTTPException(status_code=409, detail="The uncommitted harvest quantity is too small")
        duplicate = connection.execute(
            text(
                """
                SELECT id FROM offtake_contracts
                WHERE demand_id = :demand_id AND product_id = :product_id
                  AND buyer_id = :buyer_id AND status IN ('proposed', 'confirmed')
                LIMIT 1
                """
            ),
            {
                "demand_id": request.demand_id,
                "product_id": request.product_id,
                "buyer_id": current_user.id,
            },
        ).first()
        if duplicate:
            raise HTTPException(status_code=409, detail="A live agreement already exists for this match")
        contract_id = connection.execute(
            text(
                """
                INSERT INTO offtake_contracts
                    (demand_id, product_id, buyer_id, farmer_id, quantity, unit,
                     unit_price_kes, grade, harvest_date, delivery_location, expires_at)
                VALUES
                    (:demand_id, :product_id, :buyer_id, :farmer_id, :quantity, :unit,
                     :unit_price_kes, :grade, :harvest_date, :delivery_location, :expires_at)
                RETURNING id
                """
            ),
            {
                "demand_id": request.demand_id,
                "product_id": request.product_id,
                "buyer_id": current_user.id,
                "farmer_id": product.farmer_id,
                "quantity": request.quantity,
                "unit": product.unit,
                "unit_price_kes": request.unit_price_kes,
                "grade": product.grade,
                "harvest_date": harvest_date,
                "delivery_location": request.delivery_location,
                "expires_at": expiry,
            },
        ).scalar_one()
        connection.execute(
            text(
                """
                INSERT INTO notifications (user_id, category, title, body)
                VALUES (:user_id, 'offtake', 'Pre-harvest purchase proposal',
                        :body)
                """
            ),
            {
                "user_id": product.farmer_id,
                "body": (
                    f"A buyer proposed to purchase {request.quantity:g} "
                    f"{product.unit} of {product.name} for KES "
                    f"{request.unit_price_kes:g} per unit."
                ),
            },
        )
    return {"id": contract_id, "ok": True}


@app.post("/api/offtake/contracts/{contract_id}/{action}")
def respond_to_offtake_contract(
    contract_id: int,
    action: Literal["accept", "decline", "cancel", "confirm_delivery"],
    current_user: AuthenticatedUser = Depends(require_role("buyer", "farmer")),
):
    with engine.begin() as connection:
        _expire_offtake_proposals(connection)
        contract = connection.execute(
            text(
                """
                SELECT c.id, c.product_id, c.buyer_id, c.farmer_id, c.quantity,
                       c.status, p.name AS crop_name
                        FROM offtake_contracts AS c
                        JOIN products AS p ON p.id = c.product_id
                        WHERE c.id = :contract_id
                """
            ),
            {"contract_id": contract_id},
        ).first()
        if contract is None:
            raise HTTPException(status_code=404, detail="Offtake proposal not found")
        if action in ("accept", "decline"):
            if current_user.role != "farmer" or current_user.id != contract.farmer_id:
                raise HTTPException(status_code=403, detail="Only the listed farmer can respond to this proposal")
            if contract.status != "proposed":
                raise HTTPException(status_code=409, detail="This proposal is no longer awaiting a response")
            if action == "accept":
                stock = connection.execute(
                    text(
                        "SELECT stock FROM products WHERE id = :product_id"
                        + (" FOR UPDATE" if engine.dialect.name == "postgresql" else "")
                    ),
                    {"product_id": contract.product_id},
                ).scalar_one()
                committed = connection.execute(
                    text(
                        """
                        SELECT COALESCE(SUM(quantity), 0)
                        FROM offtake_contracts
                        WHERE product_id = :product_id
                          AND status IN ('proposed', 'confirmed')
                        """
                    ),
                    {"product_id": contract.product_id},
                ).scalar_one()
                if float(committed) > float(stock):
                    raise HTTPException(status_code=409, detail="Harvest availability changed; review other commitments first")
                new_status = "confirmed"
            else:
                new_status = "declined"
        elif action == "cancel":
            if current_user.role != "buyer" or current_user.id != contract.buyer_id:
                raise HTTPException(status_code=403, detail="Only the proposing buyer can cancel")
            if contract.status != "proposed":
                raise HTTPException(status_code=409, detail="Only a pending proposal can be cancelled")
            new_status = "cancelled"
        else:
            if current_user.role != "buyer" or current_user.id != contract.buyer_id:
                raise HTTPException(status_code=403, detail="Only the buyer can confirm delivery")
            if contract.status != "confirmed":
                raise HTTPException(status_code=409, detail="Only a confirmed agreement can be completed")
            updated_stock = connection.execute(
                text(
                    """
                    UPDATE products SET stock = stock - :quantity
                    WHERE id = :product_id AND stock >= :quantity
                    """
                ),
                {
                    "quantity": contract.quantity,
                    "product_id": contract.product_id,
                },
            )
            if updated_stock.rowcount == 0:
                raise HTTPException(status_code=409, detail="The listing stock changed; contact the farmer before confirming delivery")
            new_status = "fulfilled"
        connection.execute(
            text(
                """
                UPDATE offtake_contracts
                SET status = :status, updated_at = CURRENT_TIMESTAMP
                WHERE id = :contract_id
                """
            ),
            {"status": new_status, "contract_id": contract_id},
        )
        recipient_id = (
            int(contract.buyer_id)
            if current_user.role == "farmer"
            else int(contract.farmer_id)
        )
        connection.execute(
            text(
                """
                INSERT INTO notifications (user_id, category, title, body)
                VALUES (:user_id, 'offtake', :title, :body)
                """
            ),
            {
                "user_id": recipient_id,
                "title": f"Offtake agreement {new_status}",
                "body": f"The {contract.crop_name} agreement #{contract_id} is now {new_status}.",
            },
        )
    return {"ok": True, "status": new_status}


FARM_AGGREGATE = (
    "group_concat(p.name, ', ')"
    if engine.dialect.name == "sqlite"
    else "string_agg(DISTINCT p.name, ', ')"
)

FARM_SQL = f"""
SELECT f.id, f.name, f.county, f.size_acres, f.farming_methods,
       f.verification_level,
       coalesce(
           (SELECT ROUND(AVG((r.quality_rating + r.delivery_speed_rating) / 2.0), 1)
            FROM reviews AS r WHERE r.farm_id = f.id),
           f.rating
       ) AS rating,
       (SELECT COUNT(*) FROM reviews AS r WHERE r.farm_id = f.id) AS rating_count,
       f.verified_at,
       coalesce({FARM_AGGREGATE}, '') AS crops
FROM farms AS f
LEFT JOIN products AS p ON p.farm_id = f.id
WHERE f.status = :status AND (:county = '' OR f.county = :county)
  AND (:include_suspended = TRUE OR f.admin_suspended = FALSE)
GROUP BY f.id
ORDER BY f.name
"""

@app.get("/api/marketplace/options")
def marketplace_options():
    return _marketplace_options()


@app.get("/api/farms")
def farms(county: str = ""):
    _require_marketplace_enabled()
    return rows(
        FARM_SQL,
        status="verified",
        county=county,
        include_suspended=False,
    )


@app.get("/api/admin/farms/pending")
def pending(current_user: AuthenticatedUser = Depends(require_role("admin"))):
    return rows(
        FARM_SQL,
        status="pending",
        county="",
        include_suspended=True,
    )


@app.post("/api/farms/{farm_id}/verify")
def verify_farm(
    farm_id: int,
    approve: bool = True,
    current_user: AuthenticatedUser = Depends(require_role("admin")),
):
    with engine.begin() as connection:
        if approve:
            farm = connection.execute(
                text(
                    """
                    SELECT f.owner_id, f.status, f.verification_level,
                           f.farm_boundary, f.verification_video_path,
                           f.verification_submitted_at, u.phone_verified
                    FROM farms AS f
                    LEFT JOIN users AS u ON u.id = f.owner_id
                    WHERE f.id = :farm_id
                    """
                ),
                {"farm_id": farm_id},
            ).first()
            if farm is None or farm.owner_id is None:
                raise HTTPException(
                    status_code=409,
                    detail="Assign a registered farmer before approving this farm",
                )
            if (
                not farm.phone_verified
                or not farm.farm_boundary
                or not farm.verification_video_path
                or not farm.verification_submitted_at
            ):
                raise HTTPException(
                    status_code=409,
                    detail="A verified phone, GPS farm boundary, and verification video are required",
                )
            if farm.status == "verified" and farm.verification_level == "full":
                raise HTTPException(status_code=409, detail="Farm is already fully verified")
            action = (
                "farm_upgraded"
                if farm.status == "verified" and farm.verification_level == "provisional"
                else "farm_approved"
            )
        else:
            action = "farm_rejected"
        result = connection.execute(
            text(
                """
                UPDATE farms
                SET status = :status,
                    verification_level = :verification_level,
                    verified_at = CURRENT_TIMESTAMP
                WHERE id = :farm_id
                """
            ),
            {
                "status": "verified" if approve else "rejected",
                "verification_level": "full" if approve else "unverified",
                "farm_id": farm_id,
            },
        )
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail="Farm not found")
        _record_admin_action(
            connection,
            current_user.id,
            action,
            "farm",
            farm_id,
        )
    return {"ok": True}


@app.get("/api/admin/farmers")
def admin_farmers(current_user: AuthenticatedUser = Depends(require_role("admin"))):
    return rows(
        """
        SELECT id, name, email FROM users
        WHERE role = 'farmer' AND account_status = 'active'
        ORDER BY name
        """
    )


def _record_admin_action(
    connection,
    admin_id: int,
    action: str,
    entity_type: str,
    entity_id: int | None,
    details: dict[str, object] | None = None,
) -> None:
    connection.execute(
        text(
            """
            INSERT INTO admin_audit_logs
                (admin_id, action, entity_type, entity_id, details)
            VALUES
                (:admin_id, :action, :entity_type, :entity_id, :details)
            """
        ),
        {
            "admin_id": admin_id,
            "action": action,
            "entity_type": entity_type,
            "entity_id": entity_id,
            "details": json.dumps(details or {}, sort_keys=True),
        },
    )


@app.get("/api/admin/overview")
def admin_overview(current_user: AuthenticatedUser = Depends(require_role("admin"))):
    return {
        "users": rows(
            """
            SELECT COUNT(*) AS total,
                   COALESCE(SUM(CASE WHEN account_status = 'suspended' THEN 1 ELSE 0 END), 0)
                       AS suspended,
                   COALESCE(SUM(CASE WHEN role = 'buyer' THEN 1 ELSE 0 END), 0) AS buyers,
                   COALESCE(SUM(CASE WHEN role = 'farmer' THEN 1 ELSE 0 END), 0) AS farmers,
                   COALESCE(SUM(CASE WHEN role = 'admin' THEN 1 ELSE 0 END), 0) AS admins
            FROM users
            """
        )[0],
        "transporters": rows(
            "SELECT COUNT(*) AS total FROM transporter_profiles"
        )[0],
        "farms": rows(
            """
            SELECT COUNT(*) AS total,
                   COALESCE(SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END), 0) AS pending,
                   COALESCE(SUM(CASE WHEN status = 'verified' THEN 1 ELSE 0 END), 0) AS verified,
                   COALESCE(SUM(CASE WHEN admin_suspended = TRUE THEN 1 ELSE 0 END), 0)
                       AS suspended
            FROM farms
            """
        )[0],
        "products": rows(
            """
            SELECT COUNT(*) AS total,
                   COALESCE(SUM(CASE WHEN admin_suspended = FALSE THEN 1 ELSE 0 END), 0)
                       AS active,
                   COALESCE(SUM(CASE WHEN admin_suspended = TRUE THEN 1 ELSE 0 END), 0)
                       AS suspended
            FROM products
            """
        )[0],
        "orders": rows(
            """
            SELECT COUNT(*) AS total,
                   COALESCE(SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END), 0) AS paid,
                   COALESCE(SUM(total_kes), 0) AS value_kes
            FROM orders
            """
        )[0],
        "payments": rows(
            """
            SELECT COUNT(*) AS total,
                   COALESCE(SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END), 0)
                       AS successful,
                   COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0)
                       AS failed,
                   COALESCE(SUM(CASE WHEN status = 'success' THEN amount ELSE 0 END), 0)
                       AS successful_kes
            FROM payments
            """
        )[0],
    }


@app.get("/api/admin/settings")
def admin_marketplace_settings(
    current_user: AuthenticatedUser = Depends(require_role("admin")),
):
    return _marketplace_options()


class MarketplaceSettingsRequest(BaseModel):
    categories: list[str] = Field(min_length=1, max_length=100)
    counties: list[str] = Field(min_length=1, max_length=100)
    marketplace_enabled: bool
    farm_applications_enabled: bool

    @field_validator("categories", "counties")
    @classmethod
    def normalize_options(cls, values: list[str]) -> list[str]:
        normalized = [value.strip() for value in values]
        if any(not value or len(value) > 80 for value in normalized):
            raise ValueError("Each option must be between 1 and 80 characters")
        if len({value.casefold() for value in normalized}) != len(normalized):
            raise ValueError("Options must be unique")
        return normalized


@app.put("/api/admin/settings")
def update_marketplace_settings(
    request: MarketplaceSettingsRequest,
    current_user: AuthenticatedUser = Depends(require_role("admin")),
):
    settings_to_save = {
        "categories": json.dumps(request.categories),
        "counties": json.dumps(request.counties),
        "marketplace_enabled": str(request.marketplace_enabled).lower(),
        "farm_applications_enabled": str(request.farm_applications_enabled).lower(),
    }
    with engine.begin() as connection:
        used_categories = connection.execute(
            text("SELECT DISTINCT category FROM products")
        ).scalars().all()
        removed_categories = sorted(set(used_categories) - set(request.categories))
        if removed_categories:
            raise HTTPException(
                status_code=409,
                detail=(
                    "Move products out of these categories before removing them: "
                    + ", ".join(removed_categories)
                ),
            )
        used_counties = connection.execute(
            text("SELECT DISTINCT county FROM farms WHERE status = 'verified'")
        ).scalars().all()
        removed_counties = sorted(set(used_counties) - set(request.counties))
        if removed_counties:
            raise HTTPException(
                status_code=409,
                detail=(
                    "Verified farms still use these counties: "
                    + ", ".join(removed_counties)
                ),
            )
        for key, value in settings_to_save.items():
            connection.execute(
                text(
                    """
                    INSERT INTO marketplace_settings (setting_key, setting_value)
                    VALUES (:setting_key, :setting_value)
                    ON CONFLICT (setting_key) DO UPDATE
                    SET setting_value = excluded.setting_value
                    """
                ),
                {"setting_key": key, "setting_value": value},
            )
        _record_admin_action(
            connection,
            current_user.id,
            "marketplace_settings_updated",
            "marketplace",
            None,
            {
                "categories": request.categories,
                "counties": request.counties,
                "marketplace_enabled": request.marketplace_enabled,
                "farm_applications_enabled": request.farm_applications_enabled,
            },
        )
    return _marketplace_options()


@app.get("/api/admin/users")
def admin_users(current_user: AuthenticatedUser = Depends(require_role("admin"))):
    return rows(
        """
        SELECT id, name, email, phone, role, account_status, created_at
        FROM users
        ORDER BY created_at DESC, id DESC
        LIMIT 500
        """
    )


class AdminAccountStatusRequest(BaseModel):
    status: Literal["active", "suspended", "pending", "disabled"]


@app.patch("/api/admin/users/{user_id}/status")
def update_admin_user_status(
    user_id: int,
    request: AdminAccountStatusRequest,
    current_user: AuthenticatedUser = Depends(require_role("admin")),
):
    if user_id == current_user.id:
        raise HTTPException(
            status_code=409,
            detail="You cannot change your own account status",
        )
    with engine.begin() as connection:
        target = connection.execute(
            text("SELECT role, account_status FROM users WHERE id = :user_id"),
            {"user_id": user_id},
        ).first()
        if target is None:
            raise HTTPException(status_code=404, detail="User account not found")
        if (
            target.role == "admin"
            and target.account_status == "active"
            and request.status != "active"
        ):
            active_admin_count = connection.execute(
                text(
                    """
                    SELECT COUNT(*) FROM users
                    WHERE role = 'admin' AND account_status = 'active'
                    """
                )
            ).scalar_one()
            if active_admin_count <= 1:
                raise HTTPException(
                    status_code=409,
                    detail="The last active administrator cannot be suspended",
                )
        connection.execute(
            text(
                "UPDATE users SET account_status = :status WHERE id = :user_id"
            ),
            {"status": request.status, "user_id": user_id},
        )
        if target.role == "farmer" and request.status != "active":
            affected_farms = connection.execute(
                text("SELECT id FROM farms WHERE owner_id = :user_id"),
                {"user_id": user_id},
            ).scalars().all()
            connection.execute(
                text(
                    "UPDATE farms SET admin_suspended = TRUE WHERE owner_id = :user_id"
                ),
                {"user_id": user_id},
            )
            for farm_id in affected_farms:
                _record_admin_action(
                    connection,
                    current_user.id,
                    "farm_suspended_with_owner",
                    "farm",
                    int(farm_id),
                    {"owner_id": user_id},
                )
            group_ids = connection.execute(
                text("SELECT id FROM farmer_groups WHERE created_by = :user_id"),
                {"user_id": user_id},
            ).scalars().all()
            connection.execute(
                text(
                    "UPDATE farmer_groups SET admin_suspended = TRUE "
                    "WHERE created_by = :user_id"
                ),
                {"user_id": user_id},
            )
            for group_id in group_ids:
                _record_admin_action(
                    connection,
                    current_user.id,
                    "group_suspended_with_owner",
                    "group",
                    int(group_id),
                    {"owner_id": user_id},
                )
        if request.status != "active":
            affected_transporters = connection.execute(
                text(
                    "SELECT id FROM transporter_profiles WHERE user_id = :user_id AND available = TRUE"
                ),
                {"user_id": user_id},
            ).scalars().all()
            connection.execute(
                text(
                    "UPDATE transporter_profiles SET available = FALSE "
                    "WHERE user_id = :user_id"
                ),
                {"user_id": user_id},
            )
            for transporter_id in affected_transporters:
                _record_admin_action(
                    connection,
                    current_user.id,
                    "transporter_unpublished_with_owner",
                    "transporter",
                    int(transporter_id),
                    {"owner_id": user_id},
                )
        _record_admin_action(
            connection,
            current_user.id,
            f"user_{request.status}",
            "user",
            user_id,
            {"previous_status": target.account_status},
        )
    return {"ok": True, "status": request.status}


@app.get("/api/admin/orders")
def admin_orders(current_user: AuthenticatedUser = Depends(require_role("admin"))):
    orders = rows(
        """
        SELECT o.id, o.total_kes, o.status, o.created_at, buyer.name AS buyer,
               COUNT(oi.id) AS item_count
        FROM orders AS o
        LEFT JOIN users AS buyer ON buyer.id = o.buyer_id
        LEFT JOIN order_items AS oi ON oi.order_id = o.id
        GROUP BY o.id, o.total_kes, o.status, o.created_at, buyer.name
        ORDER BY o.id DESC
        LIMIT 200
        """
    )
    items = rows(
        """
        SELECT oi.order_id, p.name AS product, oi.qty AS quantity, p.unit
        FROM order_items AS oi
        LEFT JOIN products AS p ON p.id = oi.product_id
        JOIN (
            SELECT id FROM orders ORDER BY id DESC LIMIT 200
        ) AS recent_orders ON recent_orders.id = oi.order_id
        ORDER BY oi.order_id DESC, oi.id
        """
    )
    goods_by_order: dict[int, list[dict[str, object]]] = {}
    for item in items:
        goods_by_order.setdefault(int(item["order_id"]), []).append(
            {
                "product": item["product"] or "Removed product",
                "quantity": item["quantity"],
                "unit": item["unit"] or "",
            }
        )
    for order in orders:
        order["goods"] = goods_by_order.get(int(order["id"]), [])
    return orders


@app.get("/api/admin/payments")
def admin_payments(current_user: AuthenticatedUser = Depends(require_role("admin"))):
    return rows(
        """
        SELECT p.id, p.order_id, p.amount, p.status, p.mpesa_receipt, p.created_at,
               buyer.name AS buyer
        FROM payments AS p
        LEFT JOIN orders AS o ON o.id = p.order_id
        LEFT JOIN users AS buyer ON buyer.id = o.buyer_id
        ORDER BY p.id DESC
        LIMIT 200
        """
    )


@app.get("/api/admin/products")
def admin_products(current_user: AuthenticatedUser = Depends(require_role("admin"))):
    return rows(
        """
        SELECT p.id, p.name, p.category, p.variety, p.price_kes, p.stock, p.unit,
               p.admin_suspended, f.id AS farm_id, f.name AS farm, f.county
        FROM products AS p
        LEFT JOIN farms AS f ON f.id = p.farm_id
        ORDER BY p.id DESC
        LIMIT 500
        """
    )


class AdminProductStatusRequest(BaseModel):
    suspended: bool


@app.patch("/api/admin/products/{product_id}/status")
def update_admin_product_status(
    product_id: int,
    request: AdminProductStatusRequest,
    current_user: AuthenticatedUser = Depends(require_role("admin")),
):
    with engine.begin() as connection:
        result = connection.execute(
            text(
                """
                UPDATE products SET admin_suspended = :suspended
                WHERE id = :product_id
                """
            ),
            {"product_id": product_id, "suspended": request.suspended},
        )
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail="Product not found")
        _record_admin_action(
            connection,
            current_user.id,
            "product_suspended" if request.suspended else "product_reactivated",
            "product",
            product_id,
        )
    return {"ok": True, "suspended": request.suspended}


@app.get("/api/admin/transporters")
def admin_transporters(current_user: AuthenticatedUser = Depends(require_role("admin"))):
    return rows(
        """
        SELECT p.id, p.user_id, p.display_name, p.contact_phone, p.vehicle_type,
               p.capacity_kg, p.service_counties, p.details, p.available,
               p.contact_consent, u.name AS owner_name, u.email AS owner_email
        FROM transporter_profiles AS p
        JOIN users AS u ON u.id = p.user_id
        ORDER BY p.updated_at DESC, p.id DESC
        LIMIT 500
        """
    )


class AdminTransporterStatusRequest(BaseModel):
    available: bool


@app.patch("/api/admin/transporters/{transporter_id}/status")
def update_admin_transporter_status(
    transporter_id: int,
    request: AdminTransporterStatusRequest,
    current_user: AuthenticatedUser = Depends(require_role("admin")),
):
    with engine.begin() as connection:
        result = connection.execute(
            text(
                """
                UPDATE transporter_profiles SET available = :available
                WHERE id = :transporter_id
                  AND (:available = FALSE OR contact_consent = TRUE)
                """
            ),
            {
                "transporter_id": transporter_id,
                "available": request.available,
            },
        )
        if result.rowcount == 0:
            exists = connection.execute(
                text("SELECT id FROM transporter_profiles WHERE id = :transporter_id"),
                {"transporter_id": transporter_id},
            ).first()
            if exists is None:
                raise HTTPException(status_code=404, detail="Transporter not found")
            raise HTTPException(
                status_code=409,
                detail="Transporter must consent to public contact before being listed",
            )
        _record_admin_action(
            connection,
            current_user.id,
            "transporter_published" if request.available else "transporter_unpublished",
            "transporter",
            transporter_id,
        )
    return {"ok": True, "available": request.available}


@app.get("/api/admin/audit-logs")
def admin_audit_logs(
    current_user: AuthenticatedUser = Depends(require_role("admin")),
):
    return rows(
        """
        SELECT l.id, l.admin_id, u.name AS admin_name, l.action, l.entity_type,
               l.entity_id, l.details, l.created_at
        FROM admin_audit_logs AS l
        JOIN users AS u ON u.id = l.admin_id
        ORDER BY l.id DESC
        LIMIT 500
        """
    )


class ContentReportRequest(BaseModel):
    target_type: Literal["product", "user", "group"]
    target_id: int = Field(gt=0)
    reason: str = Field(min_length=8, max_length=1000)

    @field_validator("reason")
    @classmethod
    def clean_report_reason(cls, value: str) -> str:
        value = value.strip()
        if len(value) < 8:
            raise ValueError("Provide at least 8 characters explaining the report")
        return value


@app.post("/api/reports")
def create_content_report(
    request: ContentReportRequest,
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    table_by_type = {
        "product": "products",
        "user": "users",
        "group": "farmer_groups",
    }
    if request.target_type == "user" and request.target_id == current_user.id:
        raise HTTPException(status_code=400, detail="You cannot report your own account")
    table_name = table_by_type[request.target_type]
    target = rows(
        f"SELECT id FROM {table_name} WHERE id = :target_id",
        target_id=request.target_id,
    )
    if not target:
        raise HTTPException(status_code=404, detail="Reported item not found")
    with engine.begin() as connection:
        connection.execute(
            text(
                """
                INSERT INTO content_reports
                    (reporter_id, target_type, target_id, reason)
                VALUES
                    (:reporter_id, :target_type, :target_id, :reason)
                """
            ),
            {
                "reporter_id": current_user.id,
                "target_type": request.target_type,
                "target_id": request.target_id,
                "reason": request.reason,
            },
        )
    return {"ok": True}


@app.get("/api/admin/reports")
def admin_reports(current_user: AuthenticatedUser = Depends(require_role("admin"))):
    return rows(
        """
        SELECT r.id, r.reporter_id, reporter.name AS reporter_name,
               r.target_type, r.target_id, r.reason, r.status, r.admin_note,
               r.created_at, r.updated_at
        FROM content_reports AS r
        JOIN users AS reporter ON reporter.id = r.reporter_id
        ORDER BY CASE r.status WHEN 'open' THEN 0 ELSE 1 END, r.id DESC
        LIMIT 500
        """
    )


class ContentReportReviewRequest(BaseModel):
    status: Literal["reviewed", "actioned", "dismissed"]
    admin_note: str = Field(default="", max_length=1000)


@app.patch("/api/admin/reports/{report_id}")
def review_content_report(
    report_id: int,
    request: ContentReportReviewRequest,
    current_user: AuthenticatedUser = Depends(require_role("admin")),
):
    with engine.begin() as connection:
        report = connection.execute(
            text(
                """
                SELECT target_type, target_id, status FROM content_reports
                WHERE id = :report_id
                """
            ),
            {"report_id": report_id},
        ).first()
        if report is None:
            raise HTTPException(status_code=404, detail="Report not found")

        if request.status == "actioned":
            if report.target_type == "product":
                affected = connection.execute(
                    text(
                        "UPDATE products SET admin_suspended = TRUE WHERE id = :target_id"
                    ),
                    {"target_id": report.target_id},
                ).rowcount
                entity = "product"
            elif report.target_type == "group":
                affected = connection.execute(
                    text(
                        "UPDATE farmer_groups SET admin_suspended = TRUE "
                        "WHERE id = :target_id"
                    ),
                    {"target_id": report.target_id},
                ).rowcount
                entity = "group"
            else:
                target = connection.execute(
                    text(
                        "SELECT role, account_status FROM users WHERE id = :target_id"
                    ),
                    {"target_id": report.target_id},
                ).first()
                if target is None:
                    affected = 0
                    entity = "user"
                else:
                    if target.role == "admin":
                        active_admin_count = connection.execute(
                            text(
                                """
                                SELECT COUNT(*) FROM users
                                WHERE role = 'admin' AND account_status = 'active'
                                """
                            )
                        ).scalar_one()
                        if report.target_id == current_user.id or active_admin_count <= 1:
                            raise HTTPException(
                                status_code=409,
                                detail="This report cannot be used to suspend the last active administrator",
                            )
                    connection.execute(
                        text(
                            "UPDATE users SET account_status = 'suspended' "
                            "WHERE id = :target_id"
                        ),
                        {"target_id": report.target_id},
                    )
                    if target.role == "farmer":
                        farm_ids = connection.execute(
                            text("SELECT id FROM farms WHERE owner_id = :target_id"),
                            {"target_id": report.target_id},
                        ).scalars().all()
                        connection.execute(
                            text(
                                "UPDATE farms SET admin_suspended = TRUE "
                                "WHERE owner_id = :target_id"
                            ),
                            {"target_id": report.target_id},
                        )
                        for farm_id in farm_ids:
                            _record_admin_action(
                                connection,
                                current_user.id,
                                "farm_suspended_with_owner",
                                "farm",
                                int(farm_id),
                                {"owner_id": int(report.target_id), "report_id": report_id},
                            )
                        group_ids = connection.execute(
                            text(
                                "SELECT id FROM farmer_groups WHERE created_by = :target_id"
                            ),
                            {"target_id": report.target_id},
                        ).scalars().all()
                        connection.execute(
                            text(
                                "UPDATE farmer_groups SET admin_suspended = TRUE "
                                "WHERE created_by = :target_id"
                            ),
                            {"target_id": report.target_id},
                        )
                        for group_id in group_ids:
                            _record_admin_action(
                                connection,
                                current_user.id,
                                "group_suspended_with_owner",
                                "group",
                                int(group_id),
                                {"owner_id": int(report.target_id), "report_id": report_id},
                            )
                    affected = 1
                    entity = "user"
            if not affected:
                raise HTTPException(
                    status_code=404,
                    detail="Reported item no longer exists",
                )
            _record_admin_action(
                connection,
                current_user.id,
                f"{entity}_suspended_from_report",
                entity,
                int(report.target_id),
                {"report_id": report_id},
            )

        connection.execute(
            text(
                """
                UPDATE content_reports
                SET status = :status, admin_note = :admin_note,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = :report_id
                """
            ),
            {
                "status": request.status,
                "admin_note": request.admin_note.strip(),
                "report_id": report_id,
            },
        )
        _record_admin_action(
            connection,
            current_user.id,
            f"report_{request.status}",
            "report",
            report_id,
            {
                "target_type": report.target_type,
                "target_id": int(report.target_id),
                "previous_status": report.status,
            },
        )
    return {"ok": True, "status": request.status}


@app.get("/api/admin/farms")
def admin_farms(current_user: AuthenticatedUser = Depends(require_role("admin"))):
    farms = rows(
        """
        SELECT farms.id, farms.name, farms.county, farms.size_acres,
               farms.farming_methods, farms.status, farms.owner_id,
               farms.admin_suspended, farms.verification_level,
               farms.farm_boundary, farms.verification_video_latitude,
               farms.verification_video_longitude,
               farms.verification_video_accuracy_m,
               farms.verification_video_recorded_at,
               farms.verification_submitted_at,
               owner.phone_verified,
               (SELECT COUNT(DISTINCT oi.order_id)
                FROM order_items AS oi
                JOIN products AS p ON p.id = oi.product_id
                WHERE p.farm_id = farms.id AND oi.fulfillment_status = 'delivered')
                   AS successful_deliveries
        FROM farms
        LEFT JOIN users AS owner ON owner.id = farms.owner_id
        ORDER BY farms.status, farms.name
        """
    )
    return [
        {
            **farm,
            "phone_verified": (
                bool(farm["phone_verified"])
                if farm["phone_verified"] is not None
                else None
            ),
        }
        for farm in farms
    ]


@app.get("/api/admin/farms/{farm_id}/verification-video")
def admin_farm_verification_video(
    farm_id: int,
    current_user: AuthenticatedUser = Depends(require_role("admin")),
):
    farm = rows(
        "SELECT verification_video_path FROM farms WHERE id = :farm_id",
        farm_id=farm_id,
    )
    if not farm or not farm[0]["verification_video_path"]:
        raise HTTPException(status_code=404, detail="Farm verification video not found")
    filename = str(farm[0]["verification_video_path"])
    if not re.fullmatch(r"[a-f0-9]{32}\.(?:mp4|mov|webm)", filename):
        raise HTTPException(status_code=500, detail="Stored verification video path is invalid")
    video_path = private_farm_video_dir / filename
    if not video_path.is_file():
        raise HTTPException(status_code=404, detail="Stored farm verification video is unavailable")
    media_type = {
        ".mp4": "video/mp4",
        ".mov": "video/quicktime",
        ".webm": "video/webm",
    }[video_path.suffix]
    return FileResponse(
        video_path,
        media_type=media_type,
        filename=filename,
        content_disposition_type="inline",
    )


class AdminFarmStatusRequest(BaseModel):
    suspended: bool


@app.patch("/api/admin/farms/{farm_id}/status")
def update_admin_farm_status(
    farm_id: int,
    request: AdminFarmStatusRequest,
    current_user: AuthenticatedUser = Depends(require_role("admin")),
):
    with engine.begin() as connection:
        result = connection.execute(
            text(
                """
                UPDATE farms SET admin_suspended = :suspended
                WHERE id = :farm_id
                RETURNING admin_suspended
                """
            ),
            {"suspended": request.suspended, "farm_id": farm_id},
        ).first()
        if result is None:
            raise HTTPException(status_code=404, detail="Farm not found")
        _record_admin_action(
            connection,
            current_user.id,
            "farm_suspended" if request.suspended else "farm_reactivated",
            "farm",
            farm_id,
        )
    return {"ok": True, "suspended": bool(result.admin_suspended)}


class FarmOwnerRequest(BaseModel):
    owner_id: int


@app.patch("/api/admin/farms/{farm_id}/owner")
def assign_farm_owner(
    farm_id: int,
    request: FarmOwnerRequest,
    current_user: AuthenticatedUser = Depends(require_role("admin")),
):
    with engine.begin() as connection:
        farmer_exists = connection.execute(
            text(
                """
                SELECT id FROM users
                WHERE id = :owner_id AND role = 'farmer' AND account_status = 'active'
                """
            ),
            {"owner_id": request.owner_id},
        ).scalar()
        if farmer_exists is None:
            raise HTTPException(status_code=404, detail="Farmer account not found")
        result = connection.execute(
            text("UPDATE farms SET owner_id = :owner_id WHERE id = :farm_id"),
            {"owner_id": request.owner_id, "farm_id": farm_id},
        )
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail="Farm not found")
        _record_admin_action(
            connection,
            current_user.id,
            "farm_owner_assigned",
            "farm",
            farm_id,
            {"owner_id": request.owner_id},
        )
    return {"ok": True}


class Item(BaseModel):
    product_id: int
    qty: float = Field(gt=0)


class OrderRequest(BaseModel):
    items: list[Item]


@app.post("/api/orders")
def create_order(
    request: OrderRequest,
    background_tasks: BackgroundTasks,
    buyer: AuthenticatedUser = Depends(require_role("buyer")),
):
    _require_marketplace_enabled()
    if not request.items:
        raise HTTPException(status_code=400, detail="Cart is empty")

    with engine.begin() as connection:
        order_id = connection.execute(
            text("INSERT INTO orders (buyer_id) VALUES (:buyer_id) RETURNING id"),
            {"buyer_id": buyer.id},
        ).scalar()
        total = 0.0

        for item in request.items:
            price = connection.execute(
                text(
                    f"""
                    SELECT p.price_kes, p.preorder_enabled, p.harvest_date, p.stock
                    FROM products AS p
                    JOIN farms AS f ON f.id = p.farm_id
                    WHERE p.id = :product_id
                      AND p.stock - (
                          SELECT COALESCE(SUM(c.quantity), 0)
                          FROM offtake_contracts AS c
                          WHERE c.product_id = p.id
                            AND (c.status = 'confirmed'
                                 OR (c.status = 'proposed'
                                     AND c.expires_at > CURRENT_TIMESTAMP))
                      ) >= :quantity
                      AND f.status = 'verified' AND f.admin_suspended = FALSE
                      AND p.admin_suspended = FALSE
                    {"FOR UPDATE OF p" if engine.dialect.name == "postgresql" else ""}
                    """
                ),
                {"product_id": item.product_id, "quantity": item.qty},
            ).first()
            if price is None:
                raise HTTPException(
                    status_code=400,
                    detail=f"Product {item.product_id} unavailable",
                )
            unit_price = float(price.price_kes)
            if item.qty >= 50:
                unit_price *= 0.90
            elif item.qty >= 10:
                unit_price *= 0.95
            if price.preorder_enabled and not price.harvest_date:
                raise HTTPException(
                    status_code=400,
                    detail=f"Pre-order product {item.product_id} needs an expected harvest date",
                )
            connection.execute(
                text(
                    "INSERT INTO order_items "
                    "(order_id, product_id, qty, price_kes) "
                    "VALUES (:order_id, :product_id, :quantity, :price)"
                ),
                {
                    "order_id": order_id,
                    "product_id": item.product_id,
                    "quantity": item.qty,
                    "price": unit_price,
                },
            )
            total += unit_price * item.qty
            connection.execute(
                text("UPDATE products SET stock = stock - :quantity WHERE id = :product_id"),
                {"quantity": item.qty, "product_id": item.product_id},
            )

        connection.execute(
            text("UPDATE orders SET total_kes = :total WHERE id = :order_id"),
            {"total": total, "order_id": order_id},
        )

    recipients = rows(
        """
        SELECT DISTINCT users.id, users.email
        FROM order_items
        JOIN products ON products.id = order_items.product_id
        JOIN farms ON farms.id = products.farm_id
        LEFT JOIN users ON users.id = farms.owner_id
        WHERE order_items.order_id = :order_id AND users.email IS NOT NULL
        """,
        order_id=order_id,
    )
    body = (
        f"Order #{order_id} has been placed for KES {total:.2f}. "
        "Sign in to Mkulima Connect to review the order and delivery details."
    )
    _notify_user(
        buyer.id,
        "order",
        f"Order #{order_id} placed",
        body,
        background_tasks,
    )
    for recipient in recipients:
        _notify_user(
            int(recipient["id"]),
            "order",
            f"New order #{order_id}",
            body,
            background_tasks,
        )
    return {"order_id": order_id, "total_kes": total}


@app.get("/api/orders")
def buyer_orders(
    current_user: AuthenticatedUser = Depends(require_role("buyer")),
):
    return rows(
        """
        SELECT o.id AS order_id, o.total_kes, o.status AS order_status,
               o.created_at, oi.id AS order_item_id, oi.qty, oi.price_kes,
               oi.fulfillment_status,
               (SELECT payment.status FROM payments AS payment
                WHERE payment.order_id = o.id
                ORDER BY payment.id DESC LIMIT 1) AS payment_status,
               (SELECT payment.mpesa_receipt FROM payments AS payment
                WHERE payment.order_id = o.id
                ORDER BY payment.id DESC LIMIT 1) AS mpesa_receipt,
               ROUND((rv.quality_rating + rv.delivery_speed_rating) / 2.0, 1)
                   AS review_rating,
               p.id AS product_id, p.name AS product, p.variety,
               p.unit, p.harvest_date, p.preorder_enabled, p.season_tier,
               f.id AS farm_id, f.name AS farm,
               f.county, f.delivery_days
        FROM orders AS o
        JOIN order_items AS oi ON oi.order_id = o.id
        JOIN products AS p ON p.id = oi.product_id
        JOIN farms AS f ON f.id = p.farm_id
        LEFT JOIN reviews AS rv ON rv.order_item_id = oi.id
        WHERE o.buyer_id = :buyer_id
        ORDER BY o.id DESC, oi.id
        """,
        buyer_id=current_user.id,
    )


@app.get("/api/farmer/orders")
def farmer_orders(
    farm_id: int,
    current_user: AuthenticatedUser = Depends(require_role("farmer")),
):
    _owned_verified_farm(farm_id, current_user)
    return rows(
        """
        SELECT oi.id AS order_item_id, oi.qty, oi.price_kes,
               oi.fulfillment_status, o.id AS order_id, o.status AS order_status,
               o.created_at, p.name AS product, p.unit, f.name AS farm,
               f.county
        FROM order_items AS oi
        JOIN orders AS o ON o.id = oi.order_id
        JOIN products AS p ON p.id = oi.product_id
        JOIN farms AS f ON f.id = p.farm_id
        WHERE f.id = :farm_id
        ORDER BY o.id DESC, oi.id
        """,
        farm_id=farm_id,
    )


class MessageRequest(BaseModel):
    buyer_id: int | None = None
    farm_id: int
    body: str = Field(min_length=1, max_length=1000)

    @field_validator("body")
    @classmethod
    def validate_body(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Message cannot be blank")
        return value


@app.get("/api/messages")
def conversation_messages(
    farm_id: int,
    buyer_id: int | None = None,
    current_user: AuthenticatedUser = Depends(require_role("buyer", "farmer")),
):
    farm = rows(
        "SELECT id, owner_id, status FROM farms WHERE id = :farm_id",
        farm_id=farm_id,
    )
    if not farm:
        raise HTTPException(status_code=404, detail="Farm not found")
    if current_user.role == "buyer":
        if farm[0]["status"] != "verified":
            raise HTTPException(status_code=404, detail="Farm not found")
        buyer_id = current_user.id
    else:
        _owned_verified_farm(farm_id, current_user)
        if buyer_id is None:
            return rows(
                """
                SELECT messages.id, messages.buyer_id, messages.farm_id,
                       messages.sender_role, messages.body, messages.created_at
                FROM messages
                WHERE messages.farm_id = :farm_id
                ORDER BY messages.id
                """,
                farm_id=farm_id,
            )
        if not rows(
            "SELECT id FROM users WHERE id = :buyer_id AND role = 'buyer'",
            buyer_id=buyer_id,
        ):
            raise HTTPException(status_code=404, detail="Buyer not found")
    return rows(
        """
        SELECT id, buyer_id, farm_id, sender_role, body, created_at
        FROM messages
        WHERE farm_id = :farm_id AND buyer_id = :buyer_id
        ORDER BY id
        """,
        farm_id=farm_id,
        buyer_id=buyer_id,
    )


@app.post("/api/messages")
def send_message(
    request: MessageRequest,
    current_user: AuthenticatedUser = Depends(require_role("buyer", "farmer")),
):
    sender_role = current_user.role
    buyer_id = current_user.id if sender_role == "buyer" else request.buyer_id
    if buyer_id is None:
        raise HTTPException(status_code=400, detail="Choose a buyer conversation")
    with engine.begin() as connection:
        farm_exists = connection.execute(
            text(
                "SELECT id FROM farms WHERE id = :farm_id AND status = 'verified' "
                + ("AND owner_id = :owner_id" if sender_role == "farmer" else "")
            ),
            {"farm_id": request.farm_id, "owner_id": current_user.id},
        ).scalar()
        if farm_exists is None:
            raise HTTPException(status_code=404, detail="Farm not found")
        buyer_exists = connection.execute(
            text("SELECT id FROM users WHERE id = :buyer_id AND role = 'buyer'"),
            {"buyer_id": buyer_id},
        ).scalar()
        if buyer_exists is None:
            raise HTTPException(status_code=404, detail="Buyer not found")
        if sender_role == "farmer":
            buyer_has_conversation = connection.execute(
                text(
                    """
                    SELECT 1
                    FROM messages
                    WHERE buyer_id = :buyer_id AND farm_id = :farm_id
                    UNION
                    SELECT 1
                    FROM orders
                    JOIN order_items ON order_items.order_id = orders.id
                    JOIN products ON products.id = order_items.product_id
                    WHERE orders.buyer_id = :buyer_id AND products.farm_id = :farm_id
                    LIMIT 1
                    """
                ),
                {"buyer_id": buyer_id, "farm_id": request.farm_id},
            ).first()
            if buyer_has_conversation is None:
                raise HTTPException(
                    status_code=403,
                    detail="A farmer can only reply to a buyer who has contacted or ordered from this farm",
                )
        message_id = connection.execute(
            text(
                """
                INSERT INTO messages (buyer_id, farm_id, sender_role, body)
                VALUES (:buyer_id, :farm_id, :sender_role, :body)
                RETURNING id
                """
            ),
            {
                "buyer_id": buyer_id,
                "farm_id": request.farm_id,
                "sender_role": sender_role,
                "body": request.body,
            },
        ).scalar()
    return {"id": message_id, "ok": True}


class ConversationRequest(BaseModel):
    product_id: int = Field(gt=0)


class ConversationMessageRequest(BaseModel):
    body: str = Field(min_length=1, max_length=1000)

    @field_validator("body")
    @classmethod
    def normalize_body(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Message cannot be blank")
        return value


def _archive_inactive_conversations() -> None:
    expiry_cutoff = (datetime.now(timezone.utc) - timedelta(days=90)).strftime(
        "%Y-%m-%d %H:%M:%S"
    )
    with engine.begin() as connection:
        connection.execute(
            text(
                """
                UPDATE conversations SET status = 'archived'
                WHERE status = 'active' AND updated_at < :expiry_cutoff
                """
            ),
            {"expiry_cutoff": expiry_cutoff},
        )


def _conversation_summary_query() -> str:
    return """
        SELECT c.id, c.product_id, p.name AS product_name, p.unit,
               p.price_kes, f.id AS farm_id, f.name AS farm_name, f.county,
               c.buyer_id, buyer.name AS buyer_name,
               c.farmer_id, farmer.name AS farmer_name,
               c.status, c.created_at, c.updated_at,
               EXISTS (
                   SELECT 1 FROM conversation_blocks AS cb
                   WHERE cb.conversation_id = c.id AND cb.user_id = :current_user_id
               ) AS blocked_by_me
        FROM conversations AS c
        JOIN products AS p ON p.id = c.product_id
        JOIN farms AS f ON f.id = p.farm_id
        JOIN users AS buyer ON buyer.id = c.buyer_id
        JOIN users AS farmer ON farmer.id = c.farmer_id
    """


@app.get("/api/conversations")
def list_conversations(
    current_user: AuthenticatedUser = Depends(require_role("buyer", "farmer")),
):
    _archive_inactive_conversations()
    participant_column = "buyer_id" if current_user.role == "buyer" else "farmer_id"
    return rows(
        _conversation_summary_query()
        + f"""
        WHERE c.{participant_column} = :user_id
        ORDER BY c.updated_at DESC, c.id DESC
        """,
        user_id=current_user.id,
        current_user_id=current_user.id,
    )


@app.post("/api/conversations")
def create_conversation(
    request: ConversationRequest,
    current_user: AuthenticatedUser = Depends(require_role("buyer")),
):
    with engine.begin() as connection:
        listing = connection.execute(
            text(
                """
                SELECT p.id, farmer.id AS farmer_id
                FROM products AS p
                JOIN farms AS f ON f.id = p.farm_id
                LEFT JOIN users AS farmer
                    ON farmer.id = f.owner_id
                   AND farmer.role = 'farmer'
                   AND farmer.account_status = 'active'
                WHERE p.id = :product_id
                  AND p.admin_suspended = FALSE
                  AND f.status = 'verified'
                  AND f.admin_suspended = FALSE
                """
            ),
            {"product_id": request.product_id},
        ).first()
        if listing is None:
            raise HTTPException(status_code=404, detail="Listing not found")
        if listing.farmer_id is None:
            raise HTTPException(
                status_code=409,
                detail="This farm does not have an active farmer account connected for messaging yet.",
            )
        farmer_id = int(listing.farmer_id)
        if farmer_id == current_user.id:
            raise HTTPException(status_code=403, detail="You cannot message your own listing")
        existing_conversation = connection.execute(
            text(
                """
                SELECT c.id FROM conversations AS c
                JOIN conversation_blocks AS cb ON cb.conversation_id = c.id
                WHERE c.product_id = :product_id AND c.buyer_id = :buyer_id
                LIMIT 1
                """
            ),
            {"product_id": request.product_id, "buyer_id": current_user.id},
        ).first()
        if existing_conversation is not None:
            raise HTTPException(
                status_code=403,
                detail="Messaging is blocked for this conversation",
            )
        connection.execute(
            text(
                """
                INSERT INTO conversations (product_id, buyer_id, farmer_id)
                VALUES (:product_id, :buyer_id, :farmer_id)
                ON CONFLICT (product_id, buyer_id) DO UPDATE SET
                    status = 'active', updated_at = CURRENT_TIMESTAMP
                """
            ),
            {
                "product_id": request.product_id,
                "buyer_id": current_user.id,
                "farmer_id": farmer_id,
            },
        )
        conversation_id = connection.execute(
            text(
                """
                SELECT id FROM conversations
                WHERE product_id = :product_id AND buyer_id = :buyer_id
                """
            ),
            {"product_id": request.product_id, "buyer_id": current_user.id},
        ).scalar_one()
    return rows(
        _conversation_summary_query() + "WHERE c.id = :conversation_id",
        conversation_id=conversation_id,
        current_user_id=current_user.id,
    )[0]


def _require_conversation_participant(
    connection, conversation_id: int, user_id: int
):
    conversation = connection.execute(
        text(
            """
            SELECT id, buyer_id, farmer_id, status FROM conversations
            WHERE id = :conversation_id
              AND (buyer_id = :user_id OR farmer_id = :user_id)
            """
        ),
        {"conversation_id": conversation_id, "user_id": user_id},
    ).first()
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return conversation


@app.post("/api/conversations/{conversation_id}/archive")
def archive_conversation(
    conversation_id: int,
    current_user: AuthenticatedUser = Depends(require_role("buyer", "farmer")),
):
    with engine.begin() as connection:
        _require_conversation_participant(connection, conversation_id, current_user.id)
        connection.execute(
            text(
                """
                UPDATE conversations SET status = 'archived'
                WHERE id = :conversation_id
                """
            ),
            {"conversation_id": conversation_id},
        )
    return {"ok": True}


@app.post("/api/conversations/{conversation_id}/block")
def block_conversation(
    conversation_id: int,
    current_user: AuthenticatedUser = Depends(require_role("buyer", "farmer")),
):
    with engine.begin() as connection:
        _require_conversation_participant(connection, conversation_id, current_user.id)
        connection.execute(
            text(
                """
                INSERT INTO conversation_blocks (conversation_id, user_id)
                VALUES (:conversation_id, :user_id)
                ON CONFLICT (conversation_id, user_id) DO NOTHING
                """
            ),
            {"conversation_id": conversation_id, "user_id": current_user.id},
        )
    return {"ok": True}


@app.delete("/api/conversations/{conversation_id}/block")
def unblock_conversation(
    conversation_id: int,
    current_user: AuthenticatedUser = Depends(require_role("buyer", "farmer")),
):
    with engine.begin() as connection:
        _require_conversation_participant(connection, conversation_id, current_user.id)
        connection.execute(
            text(
                """
                DELETE FROM conversation_blocks
                WHERE conversation_id = :conversation_id AND user_id = :user_id
                """
            ),
            {"conversation_id": conversation_id, "user_id": current_user.id},
        )
    return {"ok": True}


class ConversationReportRequest(BaseModel):
    reason: str = Field(min_length=8, max_length=1000)

    @field_validator("reason")
    @classmethod
    def normalize_report_reason(cls, value: str) -> str:
        value = value.strip()
        if len(value) < 8:
            raise ValueError("Provide at least 8 characters explaining the report")
        return value


@app.post("/api/conversations/{conversation_id}/reports")
def report_conversation(
    conversation_id: int,
    request: ConversationReportRequest,
    current_user: AuthenticatedUser = Depends(require_role("buyer", "farmer")),
):
    with engine.begin() as connection:
        _require_conversation_participant(connection, conversation_id, current_user.id)
        report_id = connection.execute(
            text(
                """
                INSERT INTO conversation_reports
                    (conversation_id, reporter_id, reason)
                VALUES (:conversation_id, :reporter_id, :reason)
                RETURNING id
                """
            ),
            {
                "conversation_id": conversation_id,
                "reporter_id": current_user.id,
                "reason": request.reason,
            },
        ).scalar_one()
    return {"id": report_id, "ok": True}


@app.get("/api/admin/conversation-reports")
def admin_conversation_reports(
    current_user: AuthenticatedUser = Depends(require_role("admin")),
):
    return rows(
        """
        SELECT r.id, r.conversation_id, r.reporter_id,
               reporter.name AS reporter_name, c.buyer_id, buyer.name AS buyer_name,
               c.farmer_id, farmer.name AS farmer_name, p.name AS product_name,
               f.name AS farm_name, r.reason, r.status, r.admin_note,
               r.created_at, r.updated_at
        FROM conversation_reports AS r
        JOIN conversations AS c ON c.id = r.conversation_id
        JOIN users AS reporter ON reporter.id = r.reporter_id
        JOIN users AS buyer ON buyer.id = c.buyer_id
        JOIN users AS farmer ON farmer.id = c.farmer_id
        JOIN products AS p ON p.id = c.product_id
        JOIN farms AS f ON f.id = p.farm_id
        ORDER BY CASE r.status WHEN 'open' THEN 0 ELSE 1 END, r.id DESC
        LIMIT 500
        """
    )


@app.get("/api/admin/conversation-reports/{report_id}/messages")
def admin_conversation_report_messages(
    report_id: int,
    current_user: AuthenticatedUser = Depends(require_role("admin")),
):
    report = rows(
        """
        SELECT conversation_id FROM conversation_reports WHERE id = :report_id
        """,
        report_id=report_id,
    )
    if not report:
        raise HTTPException(status_code=404, detail="Message report not found")
    return rows(
        """
        SELECT id, sender_role, sender_name, body, sent_via, created_at
        FROM (
            SELECT * FROM (
                SELECT m.id, m.sender_role, u.name AS sender_name, m.body,
                       m.sent_via, m.created_at, 0 AS message_order
                FROM conversation_messages AS m
                JOIN users AS u ON u.id = m.sender_id
                WHERE m.conversation_id = :conversation_id
                UNION ALL
                SELECT -b.id AS id, 'assistant' AS sender_role,
                       'Mkulima Assistant' AS sender_name, b.body,
                       'bot' AS sent_via, b.created_at, 1 AS message_order
                FROM conversation_bot_messages AS b
                WHERE b.conversation_id = :conversation_id
            ) AS transcript
            ORDER BY created_at DESC, message_order DESC, id DESC
            LIMIT 500
        ) AS recent_transcript
        ORDER BY created_at, message_order, id
        """,
        conversation_id=report[0]["conversation_id"],
    )


class ConversationReportReviewRequest(BaseModel):
    status: Literal["reviewed", "actioned", "dismissed"]
    admin_note: str = Field(default="", max_length=1000)


@app.patch("/api/admin/conversation-reports/{report_id}")
def review_conversation_report(
    report_id: int,
    request: ConversationReportReviewRequest,
    current_user: AuthenticatedUser = Depends(require_role("admin")),
):
    with engine.begin() as connection:
        report = connection.execute(
            text(
                """
                SELECT conversation_id FROM conversation_reports WHERE id = :report_id
                """
            ),
            {"report_id": report_id},
        ).first()
        if report is None:
            raise HTTPException(status_code=404, detail="Message report not found")
        connection.execute(
            text(
                """
                UPDATE conversation_reports
                SET status = :status, admin_note = :admin_note,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = :report_id
                """
            ),
            {
                "report_id": report_id,
                "status": request.status,
                "admin_note": request.admin_note.strip(),
            },
        )
        if request.status == "actioned":
            connection.execute(
                text(
                    """
                    UPDATE conversations SET status = 'archived'
                    WHERE id = :conversation_id
                    """
                ),
                {"conversation_id": report.conversation_id},
            )
    return {"ok": True, "status": request.status}


@app.get("/api/conversations/{conversation_id}/messages")
def list_conversation_messages(
    conversation_id: int,
    current_user: AuthenticatedUser = Depends(require_role("buyer", "farmer")),
):
    _archive_inactive_conversations()
    with engine.connect() as connection:
        _require_conversation_participant(connection, conversation_id, current_user.id)
    return rows(
        """
        SELECT id, conversation_id, sender_id, sender_name, sender_role,
               body, sent_via, created_at
        FROM (
            SELECT m.id, m.conversation_id, m.sender_id, u.name AS sender_name,
                   m.sender_role, m.body, m.sent_via, m.created_at,
                   0 AS message_order
            FROM conversation_messages AS m
            JOIN users AS u ON u.id = m.sender_id
            WHERE m.conversation_id = :conversation_id
            UNION ALL
            SELECT -b.id AS id, b.conversation_id, NULL AS sender_id,
                   'Mkulima Assistant' AS sender_name, 'assistant' AS sender_role,
                   b.body, 'bot' AS sent_via, b.created_at, 1 AS message_order
            FROM conversation_bot_messages AS b
            WHERE b.conversation_id = :conversation_id
        ) AS thread_messages
        ORDER BY created_at, message_order, id
        """,
        conversation_id=conversation_id,
    )


def _buyer_chatbot_reply(message: str, listing) -> str:
    question_match = re.search(r"(?im)^question:\s*([^\r\n]+)", message)
    question = question_match.group(1) if question_match else message
    query = question.casefold()
    answer = ""

    if any(
        term in query
        for term in (
            "negotiate",
            "lower the price",
            "discount",
            "bargain",
            "bulk offer",
            "wholesale",
        )
    ):
        answer = "The farmer will respond here about your price request or offer."
    elif any(
        term in query
        for term in ("available", "availability", "in stock", "quantity", "stock")
    ):
        answer = (
            f"The listing currently shows {listing.stock} {listing.unit} available. "
            "Please wait for the farmer to confirm current availability."
        )
    elif any(term in query for term in ("price", "cost", "how much", "kes")):
        answer = (
            f"The current listing price is KES {listing.price_kes} per "
            f"{listing.unit}. The farmer will confirm the final price."
        )
    elif any(term in query for term in ("grade", "quality", "size", "class")):
        answer = (
            f"The listing grade is {listing.grade}. The farmer can confirm "
            "specific quality or sizing requirements."
        )
    elif any(term in query for term in ("harvest", "ready", "picked")):
        if listing.harvest_date:
            answer = (
                f"The listing's expected harvest date is {listing.harvest_date}. "
                "The farmer can confirm timing."
            )
        else:
            answer = "This listing does not include an expected harvest date."
    elif any(term in query for term in ("deliver", "delivery", "location", "transport")):
        if listing.delivery_days is None:
            answer = (
                f"The farm is in {listing.county}, but no delivery estimate is listed. "
                "Please confirm delivery coverage and cost with the farmer."
            )
        else:
            answer = (
                f"The farm is in {listing.county}. Its listed delivery estimate is "
                f"{listing.delivery_days} day(s); please confirm delivery coverage "
                "and cost with the farmer."
            )
    elif any(term in query for term in ("preorder", "pre-order", "future harvest")):
        answer = (
            "This listing is enabled for pre-orders."
            if listing.preorder_enabled
            else "This listing is not currently marked for pre-orders."
        )

    acknowledgement = (
        f"Thanks for your enquiry about {listing.product_name}. "
        "Iâ€™m Mkulima Connectâ€™s automated assistant, not the farmer. "
        "Your message has been sent to the farmer."
    )
    if answer:
        acknowledgement += f" {answer}"
    return acknowledgement


def _conversation_message_timestamp() -> str:
    return datetime.now(timezone.utc).isoformat(sep=" ")


@app.post("/api/conversations/{conversation_id}/messages")
def send_conversation_message(
    conversation_id: int,
    request: ConversationMessageRequest,
    current_user: AuthenticatedUser = Depends(require_role("buyer", "farmer")),
):
    _archive_inactive_conversations()
    with engine.begin() as connection:
        conversation = connection.execute(
            text(
                """
                SELECT c.buyer_id, c.farmer_id, c.status, p.name AS product_name,
                       p.unit, p.price_kes, p.stock, p.grade, p.harvest_date,
                       p.preorder_enabled, f.county, f.delivery_days,
                       buyer.name AS buyer_name, farmer.name AS farmer_name,
                       farmer.phone AS farmer_phone
                FROM conversations AS c
                JOIN products AS p ON p.id = c.product_id
                JOIN farms AS f ON f.id = p.farm_id
                JOIN users AS buyer ON buyer.id = c.buyer_id
                JOIN users AS farmer ON farmer.id = c.farmer_id
                WHERE c.id = :conversation_id
                  AND (c.buyer_id = :user_id OR c.farmer_id = :user_id)
                """
            ),
            {"conversation_id": conversation_id, "user_id": current_user.id},
        ).first()
        if conversation is None:
            raise HTTPException(status_code=404, detail="Conversation not found")
        if conversation.status != "active":
            raise HTTPException(status_code=409, detail="This conversation is archived")
        blocked = connection.execute(
            text(
                """
                SELECT 1 FROM conversation_blocks
                WHERE conversation_id = :conversation_id
                LIMIT 1
                """
            ),
            {"conversation_id": conversation_id},
        ).first()
        if blocked:
            raise HTTPException(status_code=403, detail="Messaging is blocked for this conversation")
        sender_role = "buyer" if current_user.id == conversation.buyer_id else "farmer"
        recipient_id = (
            int(conversation.farmer_id)
            if sender_role == "buyer"
            else int(conversation.buyer_id)
        )
        connection.execute(
            text(
                """
                INSERT INTO conversation_messages
                    (conversation_id, sender_id, sender_role, body, created_at)
                VALUES (:conversation_id, :sender_id, :sender_role, :body, :created_at)
                """
            ),
            {
                "conversation_id": conversation_id,
                "sender_id": current_user.id,
                "sender_role": sender_role,
                "body": request.body,
                "created_at": _conversation_message_timestamp(),
            },
        )
        if sender_role == "buyer":
            chatbot_reply = _buyer_chatbot_reply(request.body, conversation)
            connection.execute(
                text(
                    """
                    INSERT INTO conversation_bot_messages
                        (conversation_id, body, created_at)
                    VALUES (:conversation_id, :body, :created_at)
                    """
                ),
                {
                    "conversation_id": conversation_id,
                    "body": chatbot_reply,
                    "created_at": _conversation_message_timestamp(),
                },
            )
        connection.execute(
            text(
                """
                UPDATE conversations SET updated_at = CURRENT_TIMESTAMP
                WHERE id = :conversation_id
                """
            ),
            {"conversation_id": conversation_id},
        )
        connection.execute(
            text(
                """
                INSERT INTO notifications (user_id, category, title, body)
                VALUES (:user_id, 'message', 'New marketplace message', :body)
                """
            ),
            {
                "user_id": recipient_id,
                "body": (
                    f"New message about {conversation.product_name} from "
                    f"{conversation.buyer_name if sender_role == 'buyer' else conversation.farmer_name}."
                ),
            },
        )
        farmer_phone = str(conversation.farmer_phone)
        product_name = str(conversation.product_name)

    sms_notification = None
    if sender_role == "buyer":
        quantity = re.search(r"(?im)^quantity:\s*([^\r\n]+)", request.body)
        quantity_text = (
            f" for {quantity.group(1).strip()[:80]} of {product_name}"
            if quantity
            else f" about {product_name}"
        )
        sms_notification = _send_farmer_message_sms(
            farmer_phone,
            f"New buyer enquiry{quantity_text}. Please open Mkulima Connect to reply.",
        )
        if sms_notification != "sent":
            logger.info(
                "Farmer SMS notification for conversation %s: %s",
                conversation_id,
                sms_notification,
            )
    return {"ok": True, "sms_notification": sms_notification}


@app.get("/api/farms/{farm_id}/reviews")
def farm_reviews(farm_id: int):
    if not rows("SELECT id FROM farms WHERE id = :farm_id", farm_id=farm_id):
        raise HTTPException(status_code=404, detail="Farm not found")
    return {
        "reviews": rows(
            """
            SELECT r.id, r.order_item_id, r.quality_rating,
                   r.delivery_speed_rating, r.comment, r.created_at,
                   u.name AS buyer
            FROM reviews AS r
            JOIN users AS u ON u.id = r.buyer_id
            WHERE r.farm_id = :farm_id
            ORDER BY r.id DESC
            LIMIT 50
            """,
            farm_id=farm_id,
        ),
        **rows(
            """
            SELECT ROUND(AVG((quality_rating + delivery_speed_rating) / 2.0), 1)
                       AS average_rating,
                   COUNT(*) AS review_count
            FROM reviews
            WHERE farm_id = :farm_id
            """,
            farm_id=farm_id,
        )[0],
    }


class ReviewRequest(BaseModel):
    buyer_id: int = 1
    quality_rating: int = Field(ge=1, le=5)
    delivery_speed_rating: int = Field(ge=1, le=5)
    comment: str = Field(default="", max_length=1000)

    @field_validator("comment")
    @classmethod
    def clean_comment(cls, value: str) -> str:
        return value.strip()


@app.post("/api/order-items/{order_item_id}/review")
def create_review(
    order_item_id: int,
    request: ReviewRequest,
    buyer: AuthenticatedUser = Depends(require_role("buyer")),
):
    with engine.begin() as connection:
        item = connection.execute(
            text(
                """
                SELECT oi.id, oi.fulfillment_status, p.farm_id
                FROM order_items AS oi
                JOIN orders AS o ON o.id = oi.order_id
                JOIN products AS p ON p.id = oi.product_id
                WHERE oi.id = :order_item_id AND o.buyer_id = :buyer_id
                """
            ),
            {"order_item_id": order_item_id, "buyer_id": buyer.id},
        ).first()
        if item is None or item.fulfillment_status != "delivered":
            raise HTTPException(
                status_code=409,
                detail="Only delivered items from your orders can be reviewed",
            )
        existing = connection.execute(
            text("SELECT id FROM reviews WHERE order_item_id = :order_item_id"),
            {"order_item_id": order_item_id},
        ).scalar()
        if existing is not None:
            raise HTTPException(status_code=409, detail="This order item is already reviewed")
        if engine.dialect.name == "sqlite":
            legacy_rating = connection.execute(
                text("PRAGMA table_info(reviews)")
            ).mappings().all()
            has_legacy_rating = any(column["name"] == "rating" for column in legacy_rating)
        else:
            has_legacy_rating = False
        if has_legacy_rating:
            review_id = connection.execute(
                text(
                    """
                    INSERT INTO reviews
                        (order_item_id, buyer_id, farm_id, rating, quality_rating,
                         delivery_speed_rating, comment)
                    VALUES (:order_item_id, :buyer_id, :farm_id, :rating,
                            :quality_rating, :delivery_speed_rating, :comment)
                    RETURNING id
                    """
                ),
                {
                    "order_item_id": order_item_id,
                    "buyer_id": buyer.id,
                    "farm_id": item.farm_id,
                    "rating": round(
                        (request.quality_rating + request.delivery_speed_rating) / 2
                    ),
                    "quality_rating": request.quality_rating,
                    "delivery_speed_rating": request.delivery_speed_rating,
                    "comment": request.comment,
                },
            ).scalar()
        else:
            review_id = connection.execute(
                text(
                    """
                    INSERT INTO reviews
                        (order_item_id, buyer_id, farm_id, quality_rating,
                         delivery_speed_rating, comment)
                    VALUES (:order_item_id, :buyer_id, :farm_id, :quality_rating,
                            :delivery_speed_rating, :comment)
                    RETURNING id
                    """
                ),
                {
                    "order_item_id": order_item_id,
                    "buyer_id": buyer.id,
                    "farm_id": item.farm_id,
                    "quality_rating": request.quality_rating,
                    "delivery_speed_rating": request.delivery_speed_rating,
                    "comment": request.comment,
                },
            ).scalar()
    return {"id": review_id, "ok": True}


class FulfillmentRequest(BaseModel):
    status: Literal["processing", "ready", "shipped", "delivered", "cancelled"]


@app.patch("/api/farmer/orders/{order_item_id}")
def update_fulfillment(
    order_item_id: int,
    farm_id: int,
    request: FulfillmentRequest,
    background_tasks: BackgroundTasks,
    farmer: AuthenticatedUser = Depends(require_role("farmer")),
):
    _owned_verified_farm(farm_id, farmer)
    allowed_previous = {
        "processing": ("pending",),
        "ready": ("processing",),
        "shipped": ("ready",),
        "delivered": ("shipped",),
        "cancelled": ("pending", "processing", "ready"),
    }
    placeholders = ", ".join(
        f":previous_{index}"
        for index, _ in enumerate(allowed_previous[request.status])
    )
    params: dict[str, object] = {
        "status": request.status,
        "order_item_id": order_item_id,
        "farm_id": farm_id,
    }
    params.update(
        {
            f"previous_{index}": value
            for index, value in enumerate(allowed_previous[request.status])
        }
    )
    with engine.begin() as connection:
        if request.status == "processing":
            future_harvest = connection.execute(
                text(
                    """
                    SELECT products.preorder_enabled
                    FROM order_items
                    JOIN products ON products.id = order_items.product_id
                    WHERE order_items.id = :order_item_id
                      AND products.farm_id = :farm_id
                      AND products.preorder_enabled = :preorder_enabled
                      AND products.harvest_date > :today
                    """
                ),
                {
                    "order_item_id": order_item_id,
                    "farm_id": farm_id,
                    "preorder_enabled": True,
                    "today": date.today().isoformat(),
                },
            ).first()
            if future_harvest is not None:
                raise HTTPException(
                    status_code=409,
                    detail="A pre-order can be prepared after its expected harvest date",
                )
        result = connection.execute(
            text(
                f"""
                UPDATE order_items
                SET fulfillment_status = :status
                WHERE id = :order_item_id
                  AND fulfillment_status IN ({placeholders})
                  AND EXISTS (
                      SELECT 1
                      FROM products
                      WHERE products.id = order_items.product_id
                        AND products.farm_id = :farm_id
                  )
                RETURNING product_id, qty
                """
            ),
            params,
        )
        updated_item = result.first()
        if updated_item is None:
            raise HTTPException(
                status_code=409,
                detail="Order item not found for this farm or status transition is not allowed",
            )
        if request.status == "cancelled":
            connection.execute(
                text("UPDATE products SET stock = stock + :quantity WHERE id = :product_id"),
                {
                    "quantity": updated_item.qty,
                    "product_id": updated_item.product_id,
                },
            )
        notification = connection.execute(
            text(
                """
                SELECT o.id AS order_id, buyer.id AS buyer_id,
                       buyer.email AS buyer_email, owner.id AS farmer_id,
                       owner.email AS farmer_email
                FROM order_items AS oi
                JOIN orders AS o ON o.id = oi.order_id
                JOIN products AS p ON p.id = oi.product_id
                JOIN farms AS f ON f.id = p.farm_id
                JOIN users AS buyer ON buyer.id = o.buyer_id
                LEFT JOIN users AS owner ON owner.id = f.owner_id
                WHERE oi.id = :order_item_id
                """
            ),
            {"order_item_id": order_item_id},
        ).first()
    if notification is not None:
        message = (
            f"Order #{notification.order_id} is now marked {request.status}. "
            "Sign in to Mkulima Connect to view the latest details."
        )
        _notify_user(
            int(notification.buyer_id),
            "order",
            f"Order #{notification.order_id} update",
            message,
            background_tasks,
        )
        if notification.farmer_id:
            _notify_user(
                int(notification.farmer_id),
                "order",
                f"Order #{notification.order_id} update",
                message,
                background_tasks,
            )
    return {"ok": True, "status": request.status}


class StkRequest(BaseModel):
    order_id: int
    phone: str
    amount: float | None = None

    @field_validator("phone")
    @classmethod
    def normalize_phone(cls, value: str) -> str:
        normalized = re.sub(r"[\s()-]", "", value)
        if normalized.startswith("+"):
            normalized = normalized[1:]
        if normalized.startswith("0"):
            normalized = "254" + normalized[1:]
        if not re.fullmatch(r"254[17]\d{8}", normalized):
            raise ValueError("Enter a valid Kenyan M-Pesa number, such as 254712345678.")
        return normalized


async def daraja_token() -> str:
    api_root = (
        "https://api.safaricom.co.ke"
        if settings.daraja_environment == "production"
        else "https://sandbox.safaricom.co.ke"
    )
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.get(
                f"{api_root}/oauth/v1/generate?grant_type=client_credentials",
                auth=(settings.daraja_key, settings.daraja_secret),
            )
            response.raise_for_status()
            token = response.json().get("access_token")
    except (httpx.HTTPError, ValueError, AttributeError) as error:
        logger.exception("Could not obtain an M-Pesa Daraja access token.")
        raise HTTPException(
            status_code=502,
            detail="Could not connect to M-Pesa. Please try again.",
        ) from error
    if not isinstance(token, str) or not token:
        logger.error("Daraja OAuth response did not contain an access token.")
        raise HTTPException(
            status_code=502,
            detail="M-Pesa did not authorize the payment request.",
        )
    return token


@app.post("/api/payments/mpesa/stk")
async def stk_push(
    request: StkRequest,
    buyer: AuthenticatedUser = Depends(require_role("buyer")),
):
    order = rows(
        "SELECT total_kes, status FROM orders "
        "WHERE id = :order_id AND buyer_id = :buyer_id",
        order_id=request.order_id,
        buyer_id=buyer.id,
    )
    if not order:
        raise HTTPException(status_code=404, detail="Order not found for this buyer")
    if order[0]["status"] != "pending":
        raise HTTPException(
            status_code=409,
            detail="Only pending orders can be paid.",
        )
    if not all(
        (
            settings.daraja_key,
            settings.daraja_secret,
            settings.shortcode,
            settings.passkey,
            settings.daraja_callback_secret,
        )
    ):
        raise HTTPException(status_code=503, detail="M-Pesa credentials are not configured")
    callback = urlsplit(settings.callback_url)
    if (
        callback.scheme != "https"
        or not callback.hostname
        or callback.hostname in {"example.com", "your-public-url"}
        or callback.path.rstrip("/") != "/api/payments/mpesa/callback"
        or callback.fragment
    ):
        raise HTTPException(
            status_code=503,
            detail=(
                "Configure CALLBACK_URL as a public HTTPS callback endpoint and "
                "DARAJA_CALLBACK_SECRET before enabling M-Pesa."
            ),
        )
    callback_query = dict(parse_qsl(callback.query, keep_blank_values=True))
    callback_query["token"] = settings.daraja_callback_secret
    callback_url = urlunsplit(
        (
            callback.scheme,
            callback.netloc,
            callback.path,
            urlencode(callback_query),
            "",
        )
    )
    amount = int(
        Decimal(str(order[0]["total_kes"])).quantize(
            Decimal("1"), rounding=ROUND_HALF_UP
        )
    )
    if amount < 1:
        raise HTTPException(
            status_code=400,
            detail="M-Pesa payments must be at least KES 1.",
        )
    existing_payment = rows(
        """
        SELECT checkout_request_id FROM payments
        WHERE order_id = :order_id AND status IN ('initiated', 'success')
        ORDER BY id DESC LIMIT 1
        """,
        order_id=request.order_id,
    )
    if existing_payment:
        raise HTTPException(
            status_code=409,
            detail="A payment request is already in progress for this order.",
        )
    api_root = (
        "https://api.safaricom.co.ke"
        if settings.daraja_environment == "production"
        else "https://sandbox.safaricom.co.ke"
    )
    timestamp = datetime.now(ZoneInfo("Africa/Nairobi")).strftime("%Y%m%d%H%M%S")
    password = base64.b64encode(
        f"{settings.shortcode}{settings.passkey}{timestamp}".encode()
    ).decode()
    body = {
        "BusinessShortCode": settings.shortcode,
        "Password": password,
        "Timestamp": timestamp,
        "TransactionType": "CustomerPayBillOnline",
        "Amount": int(amount),
        "PartyA": request.phone,
        "PartyB": settings.shortcode,
        "PhoneNumber": request.phone,
        "CallBackURL": callback_url,
        "AccountReference": f"ORDER{request.order_id}",
        "TransactionDesc": "Mkulima",
    }
    token = await daraja_token()
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            response = await client.post(
                f"{api_root}/mpesa/stkpush/v1/processrequest",
                json=body,
                headers={"Authorization": f"Bearer {token}"},
            )
            response.raise_for_status()
            result = response.json()
    except (httpx.HTTPError, ValueError, AttributeError) as error:
        logger.exception("Daraja rejected or failed to start an STK payment.")
        raise HTTPException(
            status_code=502,
            detail="Could not start the M-Pesa payment. Please try again.",
        ) from error
    if not isinstance(result, dict):
        logger.error("Daraja returned an invalid STK response.")
        raise HTTPException(status_code=502, detail="M-Pesa returned an invalid response.")

    checkout_request_id = result.get("CheckoutRequestID")
    if (
        not isinstance(checkout_request_id, str)
        or not checkout_request_id
        or str(result.get("ResponseCode", "")) != "0"
    ):
        provider_message = result.get("CustomerMessage") or result.get("errorMessage")
        raise HTTPException(
            status_code=502,
            detail=str(provider_message or "M-Pesa did not accept the payment request."),
        )

    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO payments "
                "(order_id, checkout_request_id, amount, phone) "
                "VALUES (:order_id, :checkout_request_id, :amount, :phone)"
            ),
            {
                "order_id": request.order_id,
                "checkout_request_id": checkout_request_id,
                "amount": amount,
                "phone": request.phone,
            },
        )
    return {**result, "Amount": amount}


@app.get("/api/payments/mpesa/orders/{order_id}")
def mpesa_payment_status(
    order_id: int,
    buyer: AuthenticatedUser = Depends(require_role("buyer")),
):
    order = rows(
        "SELECT id FROM orders WHERE id = :order_id AND buyer_id = :buyer_id",
        order_id=order_id,
        buyer_id=buyer.id,
    )
    if not order:
        raise HTTPException(status_code=404, detail="Order not found for this buyer")
    payments = rows(
        """
        SELECT status, amount, mpesa_receipt
        FROM payments WHERE order_id = :order_id
        ORDER BY id DESC LIMIT 1
        """,
        order_id=order_id,
    )
    if not payments:
        return {"status": "not_started", "amount": None, "mpesa_receipt": None}
    return {
        "status": str(payments[0]["status"]),
        "amount": payments[0]["amount"],
        "mpesa_receipt": payments[0]["mpesa_receipt"],
    }


@app.post("/api/payments/mpesa/callback")
async def callback(request: Request, background_tasks: BackgroundTasks):
    callback_secret = settings.daraja_callback_secret
    supplied_secret = request.query_params.get("token", "")
    if not callback_secret or not secrets.compare_digest(
        supplied_secret, callback_secret
    ):
        raise HTTPException(status_code=403, detail="Invalid payment callback token")
    try:
        payload = await request.json()
    except ValueError:
        payload = {}
    callback_body = payload.get("Body") if isinstance(payload, dict) else None
    callback_data = (
        callback_body.get("stkCallback")
        if isinstance(callback_body, dict)
        else None
    )
    if not isinstance(callback_data, dict):
        logger.warning("Received a malformed Daraja STK callback.")
        return {"ResultCode": 0, "ResultDesc": "Accepted"}
    checkout_request_id = callback_data.get("CheckoutRequestID")
    result_code = callback_data.get("ResultCode")
    if not isinstance(checkout_request_id, str) or not checkout_request_id:
        logger.warning("Received a Daraja callback without a checkout request ID.")
        return {"ResultCode": 0, "ResultDesc": "Accepted"}

    metadata = callback_data.get("CallbackMetadata", {})
    items = metadata.get("Item", []) if isinstance(metadata, dict) else []
    if not isinstance(items, list):
        items = []
    callback_values = {
        item.get("Name"): item.get("Value")
        for item in items
        if isinstance(item, dict) and isinstance(item.get("Name"), str)
    }
    succeeded = type(result_code) is int and result_code == 0
    receipt = callback_values.get("MpesaReceiptNumber")
    callback_amount = callback_values.get("Amount")

    with engine.begin() as connection:
        payment = connection.execute(
            text(
                """
                SELECT id, order_id, amount, status FROM payments
                WHERE checkout_request_id = :checkout_request_id
                """
            ),
            {"checkout_request_id": checkout_request_id},
        ).first()
        if payment is None:
            logger.warning("Received a callback for an unknown Daraja checkout request.")
            order_email = None
        elif payment.status != "initiated":
            order_email = None
        elif succeeded and (
            not isinstance(receipt, str)
            or not receipt
            or type(callback_amount) not in (int, float)
            or not math.isfinite(callback_amount)
            or callback_amount != int(payment.amount)
        ):
            logger.error(
                "Daraja callback amount or receipt did not match checkout request %s.",
                checkout_request_id,
            )
            order_email = None
        else:
            update = connection.execute(
                text(
                    """
                    UPDATE payments SET status = :status, mpesa_receipt = :receipt
                    WHERE id = :payment_id AND status = 'initiated'
                    """
                ),
                {
                    "status": "success" if succeeded else "failed",
                    "receipt": receipt,
                    "payment_id": payment.id,
                },
            )
            if update.rowcount != 1:
                order_email = None
            elif succeeded:
                connection.execute(
                    text("UPDATE orders SET status = 'paid' WHERE id = :order_id"),
                    {"order_id": payment.order_id},
                )
                order_email = connection.execute(
                    text(
                        """
                        SELECT o.id AS order_id, u.id AS buyer_id,
                               u.email AS buyer_email
                        FROM orders AS o
                        JOIN users AS u ON u.id = o.buyer_id
                        WHERE o.id = :order_id
                        """
                    ),
                    {"order_id": payment.order_id},
                ).first()
            else:
                order_email = None
    if succeeded and order_email is not None:
        body = f"Payment for order #{order_email.order_id} was confirmed."
        _notify_user(
            int(order_email.buyer_id),
            "order",
            f"Payment confirmed for order #{order_email.order_id}",
            body,
            background_tasks,
        )
    return {"ResultCode": 0, "ResultDesc": "Accepted"}
