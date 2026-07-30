"""
SQLite database layer for dashboard — multi-user auth, agent config, chat history.
"""
import hashlib
import hmac
import json
import os
import secrets
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

DATA_DIR = Path(os.environ.get("DATA_DIR", "/app/data"))
DATA_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = DATA_DIR / "dashboard.db"


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db():
    """Create tables and run migrations."""
    conn = _connect()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            is_admin INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            last_login TEXT
        );

        CREATE TABLE IF NOT EXISTS agent_overrides (
            agent_id TEXT NOT NULL,
            username TEXT NOT NULL,
            model TEXT,
            updated_at TEXT NOT NULL DEFAULT (datetime('now')),
            PRIMARY KEY (agent_id, username),
            FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS chat_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            agent_id TEXT NOT NULL,
            username TEXT NOT NULL,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_chat_agent ON chat_history(agent_id, created_at);

        CREATE TABLE IF NOT EXISTS cost_snapshots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            year_month TEXT NOT NULL,  -- '2026-06'
            model TEXT NOT NULL,
            total_tokens INTEGER NOT NULL DEFAULT 0,
            total_sessions INTEGER NOT NULL DEFAULT 0,
            estimated_cost_eur REAL NOT NULL DEFAULT 0.0,
            snapshot_at TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE(year_month, model)
        );
    """)
    conn.commit()

    # Create default admin user if no users exist
    count = conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]
    if count == 0:
        admin_pass = os.environ.get("DASHBOARD_PASSWORD", "admin")
        conn.execute(
            "INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, 1)",
            ("admin", hash_password(admin_pass)),
        )
        conn.commit()
        print("🔐 Created default admin user")
    conn.close()

    # Migrate legacy dashboard.json -> SQLite
    _migrate_json_to_db()


def hash_password(plain: str) -> str:
    salt = secrets.token_hex(16)
    return salt + ":" + hashlib.pbkdf2_hmac("sha256", plain.encode(), salt.encode(), 600000).hex()


def verify_password(plain: str, stored_hash: str) -> bool:
    try:
        salt, stored = stored_hash.split(":", 1)
        computed = hashlib.pbkdf2_hmac("sha256", plain.encode(), salt.encode(), 600000).hex()
        return hmac.compare_digest(computed, stored)
    except Exception:
        return False


# ── User management ──────────────────────────────────────────────

def authenticate_user(username: str, password: str) -> dict | None:
    conn = _connect()
    row = conn.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
    if row and verify_password(password, row["password_hash"]):
        conn.execute("UPDATE users SET last_login = datetime('now') WHERE username = ?", (username,))
        conn.commit()
        conn.close()
        return {"username": row["username"], "is_admin": bool(row["is_admin"])}
    conn.close()
    return None


def get_user(username: str) -> dict | None:
    conn = _connect()
    row = conn.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
    conn.close()
    if row:
        return {"username": row["username"], "is_admin": bool(row["is_admin"])}
    return None


def list_users() -> list[dict]:
    conn = _connect()
    rows = conn.execute("SELECT username, is_admin, created_at, last_login FROM users ORDER BY created_at").fetchall()
    conn.close()
    return [{"username": r["username"], "is_admin": bool(r["is_admin"]),
             "created_at": r["created_at"], "last_login": r["last_login"]} for r in rows]


def create_user(username: str, password: str, is_admin: bool = False) -> bool:
    conn = _connect()
    try:
        conn.execute(
            "INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, ?)",
            (username, hash_password(password), 1 if is_admin else 0),
        )
        conn.commit()
        conn.close()
        return True
    except sqlite3.IntegrityError:
        conn.close()
        return False  # username already exists


def delete_user(username: str) -> bool:
    conn = _connect()
    conn.execute("DELETE FROM users WHERE username = ?", (username,))
    deleted = conn.total_changes > 0
    conn.commit()
    conn.close()
    return deleted


def change_user_password(username: str, new_password: str) -> bool:
    conn = _connect()
    conn.execute(
        "UPDATE users SET password_hash = ? WHERE username = ?",
        (hash_password(new_password), username),
    )
    updated = conn.total_changes > 0
    conn.commit()
    conn.close()
    return updated


# ── Agent overrides ──────────────────────────────────────────────

def get_agent_override(agent_id: str, username: str) -> str | None:
    conn = _connect()
    row = conn.execute(
        "SELECT model FROM agent_overrides WHERE agent_id = ? AND username = ?",
        (agent_id, username),
    ).fetchone()
    conn.close()
    return row["model"] if row else None


def get_all_overrides(username: str) -> dict:
    conn = _connect()
    rows = conn.execute("SELECT agent_id, model FROM agent_overrides WHERE username = ?", (username,)).fetchall()
    conn.close()
    return {r["agent_id"]: r["model"] for r in rows}


def set_agent_override(agent_id: str, username: str, model: str):
    conn = _connect()
    conn.execute(
        """INSERT INTO agent_overrides (agent_id, username, model, updated_at)
           VALUES (?, ?, ?, datetime('now'))
           ON CONFLICT(agent_id, username) DO UPDATE SET model=excluded.model, updated_at=excluded.updated_at""",
        (agent_id, username, model),
    )
    conn.commit()
    conn.close()


# ── Chat history ─────────────────────────────────────────────────

def save_chat_message(agent_id: str, username: str, role: str, content: str):
    conn = _connect()
    conn.execute(
        "INSERT INTO chat_history (agent_id, username, role, content) VALUES (?, ?, ?, ?)",
        (agent_id, username, role, content),
    )
    # Keep only last 500 messages per agent
    conn.execute("""
        DELETE FROM chat_history WHERE id IN (
            SELECT id FROM chat_history WHERE agent_id = ? ORDER BY id DESC LIMIT -1 OFFSET 500
        )
    """, (agent_id,))
    conn.commit()
    conn.close()


def get_chat_history(agent_id: str, username: str, limit: int = 50) -> list[dict]:
    conn = _connect()
    rows = conn.execute(
        "SELECT role, content, created_at FROM chat_history WHERE agent_id = ? AND username = ? ORDER BY id DESC LIMIT ?",
        (agent_id, username, limit),
    ).fetchall()
    conn.close()
    return [{"role": r["role"], "content": r["content"], "timestamp": r["created_at"]} for r in reversed(rows)]


# ── Cost snapshots ───────────────────────────────────────────────

def save_cost_snapshot(year_month: str, model: str, total_tokens: int, total_sessions: int, estimated_cost_eur: float):
    conn = _connect()
    conn.execute(
        """INSERT INTO cost_snapshots (year_month, model, total_tokens, total_sessions, estimated_cost_eur, snapshot_at)
           VALUES (?, ?, ?, ?, ?, datetime('now'))
           ON CONFLICT(year_month, model)
           DO UPDATE SET total_tokens=excluded.total_tokens,
                         total_sessions=excluded.total_sessions,
                         estimated_cost_eur=excluded.estimated_cost_eur,
                         snapshot_at=excluded.snapshot_at""",
        (year_month, model, total_tokens, total_sessions, estimated_cost_eur),
    )
    conn.commit()
    conn.close()


def get_cost_history(model: str = None, limit: int = 12) -> list[dict]:
    conn = _connect()
    if model:
        rows = conn.execute(
            "SELECT * FROM cost_snapshots WHERE model = ? ORDER BY year_month DESC LIMIT ?",
            (model, limit),
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT * FROM cost_snapshots ORDER BY year_month DESC, model LIMIT ?",
            (limit * 20),
        ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


# ── Legacy migration ─────────────────────────────────────────────

def _migrate_json_to_db():
    """Migrate dashboard.json data to SQLite if it exists."""
    json_path = DATA_DIR / "dashboard.json"
    if not json_path.exists():
        return

    try:
        data = json.loads(json_path.read_text())
        conn = _connect()

        # Migrate agent overrides
        agents_data = data.get("agents", {})
        for agent_id, cfg in agents_data.items():
            if cfg.get("model"):
                try:
                    conn.execute(
                        """INSERT INTO agent_overrides (agent_id, username, model, updated_at)
                           VALUES (?, 'admin', ?, ?)
                           ON CONFLICT(agent_id, username) DO UPDATE SET model=excluded.model""",
                        (agent_id, cfg["model"], data.get("updated_at", datetime.now(timezone.utc).isoformat())),
                    )
                except Exception:
                    pass

        # Migrate chat history
        chat_data = data.get("chat_history", {})
        for agent_id, messages in chat_data.items():
            for msg in messages:
                try:
                    conn.execute(
                        "INSERT INTO chat_history (agent_id, username, role, content, created_at) VALUES (?, 'admin', ?, ?, ?)",
                        (agent_id, msg.get("role", "unknown"), msg.get("content", ""),
                         msg.get("timestamp", datetime.now(timezone.utc).isoformat())),
                    )
                except Exception:
                    pass

        conn.commit()
        conn.close()

        # Rename migrated file
        json_path.rename(json_path.with_suffix(".json.migrated"))
        print("📦 Migrated dashboard.json → SQLite")
    except Exception as e:
        print(f"⚠️ Migration skipped: {e}")
