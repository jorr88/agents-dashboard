"""
OpenClaw Agents Dashboard - Backend v3
FastAPI + SQLite + Multi-user auth + Monthly cost tracking.
"""
import asyncio
import json
import os
import subprocess
import sys
import time
from collections import deque
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Depends, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.staticfiles import StaticFiles
from jose import JWTError, jwt
from pydantic import BaseModel
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

from database import (
    init_db, authenticate_user, get_user, list_users, create_user, delete_user,
    change_user_password, get_agent_override, get_all_overrides, set_agent_override,
    save_chat_message, get_chat_history, save_cost_snapshot, get_cost_history,
)

app = FastAPI(title="OpenClaw Dashboard API v3")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Rate limiting
limiter = Limiter(key_func=get_remote_address, default_limits=["60/minute"])
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# ── Config
STATE_DIR = Path(os.environ.get("OPENCLAW_STATE_DIR", "/home/node/.openclaw"))
DATA_DIR = Path(os.environ.get("DATA_DIR", "/app/data"))
SECRET_KEY = os.environ.get("DASHBOARD_SECRET")
if not SECRET_KEY:
    print("FATAL: DASHBOARD_SECRET environment variable is required", file=sys.stderr)
    sys.exit(1)
ALGORITHM = "HS256"
TOKEN_EXPIRE_HOURS = 24

security = HTTPBearer()

# ── Database init
init_db()

# ── JWT helpers
def create_token(username: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(hours=TOKEN_EXPIRE_HOURS)
    return jwt.encode({"sub": username, "exp": expire}, SECRET_KEY, algorithm=ALGORITHM)


def decode_token(token: str) -> dict | None:
    try:
        return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        return None


async def require_auth(credentials: HTTPAuthorizationCredentials = Depends(security)) -> dict:
    payload = decode_token(credentials.credentials)
    if not payload:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")
    return payload


def require_admin(payload: dict = Depends(require_auth)) -> dict:
    user = get_user(payload["sub"])
    if not user or not user["is_admin"]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin required")
    return payload


# ── WebSocket manager
class ConnectionManager:
    def __init__(self):
        self.connections: dict[str, list[WebSocket]] = {}

    async def connect(self, ws: WebSocket, username: str):
        await ws.accept()
        self.connections.setdefault(username, []).append(ws)

    def disconnect(self, ws: WebSocket, username: str):
        try:
            self.connections.get(username, []).remove(ws)
        except ValueError:
            pass

    async def broadcast(self, data: dict, exclude_user: str = None):
        for username, sockets in list(self.connections.items()):
            if username == exclude_user:
                continue
            dead = []
            for ws in sockets:
                try:
                    await ws.send_json(data)
                except Exception:
                    dead.append(ws)
            for ws in dead:
                self.disconnect(ws, username)

manager = ConnectionManager()


# ── Pydantic models
class LoginRequest(BaseModel):
    username: str
    password: str

class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str

class ModelChange(BaseModel):
    agentId: str
    model: str

class ChatMessage(BaseModel):
    agentId: str
    message: str

class CreateUserRequest(BaseModel):
    username: str
    password: str
    is_admin: bool = False


# ── Pricing (loaded from external JSON, fallback to built-in defaults)
USD_TO_EUR = 0.93

DEFAULT_PRICING = {
    "monthly_quota_usd": 60.0,
    "models": {
        "deepseek-v4-pro":    {"rate_per_1m": 1.5,  "requests_est": 17150},
        "deepseek-v4-flash":  {"rate_per_1m": 0.3,  "requests_est": 158150},
        "qwen3.5-plus":      {"rate_per_1m": 1.2,  "requests_est": 16300},
        "qwen3.6-plus":      {"rate_per_1m": 1.2,  "requests_est": 16300},
        "qwen3.7-max":       {"rate_per_1m": 1.5,  "requests_est": 4770},
        "kimi-k2.5":         {"rate_per_1m": 0.8,  "requests_est": 9250},
        "kimi-k2.6":         {"rate_per_1m": 0.8,  "requests_est": 5750},
        "glm-5":             {"rate_per_1m": 1.0,  "requests_est": 5750},
        "glm-5.1":           {"rate_per_1m": 1.0,  "requests_est": 4300},
        "minimax-m2.5":      {"rate_per_1m": 0.6,  "requests_est": 31800},
        "minimax-m2.7":      {"rate_per_1m": 0.6,  "requests_est": 17000},
        "mimo-v2-pro":       {"rate_per_1m": 1.0,  "requests_est": None},
        "mimo-v2.5-pro":     {"rate_per_1m": 1.0,  "requests_est": 16300},
        "mimo-v2.5":         {"rate_per_1m": 0.3,  "requests_est": 150400},
        "mimo-v2-omni":      {"rate_per_1m": 1.0,  "requests_est": None},
    },
}

def _load_pricing() -> dict:
    """Load pricing from external JSON file, falling back to built-in defaults."""
    pricing_path = DATA_DIR / "pricing.json"
    if pricing_path.exists():
        try:
            return json.loads(pricing_path.read_text())
        except Exception as e:
            print(f"⚠️  Failed to load pricing.json, using defaults: {e}")
    return DEFAULT_PRICING

_pricing = _load_pricing()
OPENCODE_GO_RATES = {m: v["rate_per_1m"] for m, v in _pricing["models"].items()}
OPENCODE_GO_REQUESTS = {m: v.get("requests_est") for m, v in _pricing["models"].items()}
OPENCODE_GO_MONTHLY_QUOTA = round(_pricing["monthly_quota_usd"] * USD_TO_EUR, 2)

def current_year_month() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m")

def normalize_model(raw: str) -> str:
    if "/" in raw:
        return raw.split("/", 1)[1]
    return raw

def estimate_cost_eur(tokens: int, model: str) -> float:
    model = normalize_model(model)
    rate = OPENCODE_GO_RATES.get(model, 0.5)
    return round((tokens / 1_000_000) * rate * USD_TO_EUR, 4)


# ── Config helpers
def load_agents_config() -> dict:
    path = STATE_DIR / "openclaw.json"
    if path.exists():
        return json.loads(path.read_text())
    return {}

def get_configured_agents() -> list[dict]:
    cfg = load_agents_config()
    return [
        {
            "id": a["id"],
            "model": a.get("model", {}).get("primary", "unknown"),
            "fallbacks": a.get("model", {}).get("fallbacks", []),
            "workspace": a.get("workspace", ""),
        }
        for a in cfg.get("agents", {}).get("list", [])
    ]

def get_available_models() -> list[dict]:
    cfg = load_agents_config()
    models = cfg.get("agents", {}).get("defaults", {}).get("models", {})
    result = []
    for key, val in models.items():
        if key.startswith("opencode-go/"):
            provider, model_name = key.split("/", 1)
            alias = val.get("alias", None)
            result.append({
                "key": key,
                "provider": provider,
                "model": model_name,
                "alias": alias,
                "label": alias or model_name,
            })
    return result

def openclaw_sessions_json(limit: int = 500) -> dict:
    cmd = ["openclaw", "sessions", "--json", "--all-agents", "--limit", str(limit)]
    env = os.environ.copy()
    env["OPENCLAW_STATE_DIR"] = str(STATE_DIR)
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=15, env=env)
        if result.returncode == 0:
            return json.loads(result.stdout)
        return {"error": result.stderr.strip(), "sessions": []}
    except Exception as e:
        return {"error": str(e), "sessions": []}


# ── Snapshot cache (avoids calling openclaw CLI on every HTTP request)
_cached_snapshot: dict | None = None
_cached_snapshot_ts: float = 0.0
SNAPSHOT_CACHE_TTL = 15  # seconds


# Track previous agent statuses for failure detection
_previous_agent_statuses: dict[str, str] = {}


def get_snapshot_cached(username: str | None = None) -> dict:
    """Return cached agent snapshot if fresh, otherwise rebuild."""
    global _cached_snapshot, _cached_snapshot_ts
    now = time.time()
    if _cached_snapshot is not None and (now - _cached_snapshot_ts) < SNAPSHOT_CACHE_TTL:
        return _cached_snapshot

    agents = get_configured_agents()
    sessions_data = openclaw_sessions_json(limit=500)
    sessions = sessions_data.get("sessions", [])
    overrides = get_all_overrides(username) if username else {}
    snapshot = build_agent_snapshot(agents, sessions, overrides)

    _cached_snapshot = snapshot
    _cached_snapshot_ts = now
    return snapshot


# ── API: Auth
@app.post("/api/login")
@limiter.limit("5/minute")
async def login(request: Request, body: LoginRequest):
    user = authenticate_user(body.username, body.password)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    token = create_token(body.username)
    return {
        "token": token,
        "token_type": "bearer",
        "expires_in_hours": TOKEN_EXPIRE_HOURS,
        "user": user,
    }

@app.post("/api/change-password")
async def change_password(body: ChangePasswordRequest, payload: dict = Depends(require_auth)):
    username = payload["sub"]
    user = authenticate_user(username, body.current_password)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Current password is incorrect")
    if not body.new_password or len(body.new_password) < 4:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="New password must be at least 4 characters")
    change_user_password(username, body.new_password)
    return {"ok": True, "message": "Password changed successfully"}

@app.get("/api/me")
async def get_current_user(payload: dict = Depends(require_auth)):
    user = get_user(payload["sub"])
    return {"user": user}

# ── API: User management (admin only)
@app.get("/api/users")
async def api_list_users(_admin: dict = Depends(require_admin)):
    return {"users": list_users()}

@app.post("/api/users")
async def api_create_user(body: CreateUserRequest, _admin: dict = Depends(require_admin)):
    if len(body.password) < 4:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Password must be at least 4 characters")
    ok = create_user(body.username, body.password, body.is_admin)
    if not ok:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Username already exists")
    return {"ok": True, "username": body.username}

@app.delete("/api/users/{username}")
async def api_delete_user(username: str, _admin: dict = Depends(require_admin)):
    if username == "admin":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot delete admin user")
    ok = delete_user(username)
    if not ok:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return {"ok": True}

# ── Shared: build agent snapshot from sessions (dedup — used by get_agents + periodic_refresh)
def build_agent_snapshot(agents: list[dict], sessions: list[dict], overrides: dict | None = None) -> dict:
    """Build a full agent snapshot dict from configured agents + session data."""
    if overrides is None:
        overrides = {}

    agent_id_lower_map = {a["id"].lower(): a["id"] for a in agents}
    agent_stats: dict = {}
    for s in sessions:
        aid = s.get("agentId", "unknown")
        aid = agent_id_lower_map.get(aid.lower(), aid)
        if aid not in agent_stats:
            agent_stats[aid] = {"total_sessions": 0, "total_tokens": 0, "last_updated": 0,
                               "last_action": None, "models_used": {}, "latest_session": None}
        st = agent_stats[aid]
        st["total_sessions"] += 1
        tt = s.get("totalTokens") or 0
        st["total_tokens"] += tt
        m = s.get("model", "unknown")
        st["models_used"][m] = st["models_used"].get(m, 0) + 1
        ts = s.get("updatedAt", 0)
        if ts > st["last_updated"]:
            st["last_updated"] = ts
            st["last_action"] = s.get("kind", "unknown")
            st["latest_session"] = s

    now_ms = int(time.time() * 1000)
    result = []
    for agent in agents:
        aid = agent["id"]
        stats = agent_stats.get(aid, {})
        total_tokens = stats.get("total_tokens", 0)
        current_model = overrides.get(aid, agent.get("model", "unknown"))

        last_updated = stats.get("last_updated", 0)
        age_min = (now_ms - last_updated) / 60000 if last_updated else 999
        latest = stats.get("latest_session") or {}

        if latest.get("abortedLastRun"):
            status = "error"
        elif age_min < 15:
            status = "running"
        else:
            status = "idle"

        result.append({
            "id": aid,
            "status": status,
            "model": current_model,
            "fallbacks": agent.get("fallbacks", []),
            "workspace": agent.get("workspace", ""),
            "last_action": stats.get("last_action", "none"),
            "last_session_id": latest.get("sessionId", ""),
            "last_updated_ms": last_updated,
            "total_sessions": stats.get("total_sessions", 0),
            "total_tokens": total_tokens,
            "total_cost_eur": estimate_cost_eur(total_tokens, normalize_model(current_model)),
            "models_used": stats.get("models_used", {}),
        })

    return {
        "agents": result,
        "total_agents": len(result),
        "total_sessions": len(sessions),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }


# ── API: Agents (served from cache — refreshed by periodic_refresh every 15s)
@app.get("/api/agents")
async def get_agents(payload: dict = Depends(require_auth)):
    return get_snapshot_cached(username=payload["sub"])

@app.get("/api/agents/{agent_id}")
async def get_agent(agent_id: str, payload: dict = Depends(require_auth)):
    snapshot = await get_agents(payload)
    for a in snapshot["agents"]:
        if a["id"].lower() == agent_id.lower():
            return a
    return {"error": "Agent not found"}

async def _read_logs_async(agent_id: str, lines: int = 50) -> dict:
    """Read agent logs off the main thread to avoid blocking the event loop."""
    def _read_sync():
        agents_dir = STATE_DIR / "agents"
        agent_dir = None
        if agents_dir.exists():
            for d in agents_dir.iterdir():
                if d.is_dir() and d.name.lower() == agent_id.lower():
                    agent_dir = d
                    break
        if not agent_dir:
            return {"agent_id": agent_id, "lines": [f"No agent directory found for {agent_id}"]}

        sessions_dir = agent_dir / "sessions"
        if not sessions_dir.exists():
            return {"agent_id": agent_id, "lines": [f"No sessions directory for {agent_id}"]}

        jsonl_files = sorted(sessions_dir.glob("*.jsonl"), key=lambda p: p.stat().st_mtime, reverse=True)
        if not jsonl_files:
            return {"agent_id": agent_id, "lines": [f"No transcript files for {agent_id}"]}

        log_lines = []
        for jf in jsonl_files[:3]:
            try:
                for line in jf.read_text().splitlines():
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        obj = json.loads(line)
                        msg = obj.get("message") or obj
                        role = msg.get("role", obj.get("type", "?"))
                        content = msg.get("content", "")
                        if isinstance(content, list):
                            parts = []
                            for c in content:
                                if isinstance(c, dict):
                                    ctype = c.get("type", "")
                                    if ctype == "text":
                                        parts.append(c.get("text", ""))
                                    elif ctype == "toolCall":
                                        parts.append(f"🔧 {c.get('name','?')}({str(c.get('arguments',{}))[:80]})")
                                    elif ctype == "toolResult":
                                        parts.append(f"📋 result ({str(c.get('output',''))[:60]})")
                                    else:
                                        parts.append(json.dumps(c)[:100])
                                else:
                                    parts.append(str(c))
                            content = " ".join(parts)
                        content = str(content)
                        if content.strip():
                            log_lines.append(f"[{role}] {content[:250]}")
                    except json.JSONDecodeError:
                        log_lines.append(line[:200])
            except Exception as e:
                log_lines.append(f"[error reading {jf.name}: {e}]")

        # Use deque to efficiently get last N lines
        return {"agent_id": agent_id, "lines": list(deque(log_lines, maxlen=lines))}

    return await asyncio.to_thread(_read_sync)


@app.get("/api/agents/{agent_id}/logs")
async def agent_logs(agent_id: str, lines: int = 50, payload: dict = Depends(require_auth)):
    return await _read_logs_async(agent_id, lines)

@app.post("/api/agents/{agent_id}/model")
async def set_agent_model(agent_id: str, body: ModelChange, payload: dict = Depends(require_auth)):
    set_agent_override(agent_id, payload["sub"], body.model)
    snapshot = await get_agents(payload)
    await manager.broadcast({"type": "agents_update", "data": snapshot})
    return {"ok": True, "agent_id": agent_id, "model": body.model}

@app.get("/api/agents/{agent_id}/chat")
async def agent_chat_history(agent_id: str, payload: dict = Depends(require_auth)):
    messages = get_chat_history(agent_id, payload["sub"])
    return {"agent_id": agent_id, "messages": messages}

@app.post("/api/agents/{agent_id}/chat")
async def send_chat_message(agent_id: str, body: ChatMessage, payload: dict = Depends(require_auth)):
    username = payload["sub"]
    save_chat_message(agent_id, username, "user", body.message)

    cmd = ["openclaw", "agent", "--agent", agent_id, "--message", body.message, "--json"]
    env = os.environ.copy()
    env["OPENCLAW_STATE_DIR"] = str(STATE_DIR)

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=60, env=env)
        if result.returncode == 0:
            raw = result.stdout.strip()
            try:
                data = json.loads(raw)
                payloads = data.get("payloads", [])
                if payloads and payloads[0].get("text"):
                    reply = payloads[0]["text"]
                elif data.get("finalAssistantVisibleText"):
                    reply = data["finalAssistantVisibleText"]
                else:
                    reply = raw
            except (json.JSONDecodeError, KeyError, IndexError, TypeError):
                reply = raw
            save_chat_message(agent_id, username, "assistant", reply)
            return {"ok": True, "reply": reply, "agent_id": agent_id}
        else:
            error_msg = result.stderr.strip()
            save_chat_message(agent_id, username, "error", error_msg)
            return {"ok": False, "error": error_msg, "agent_id": agent_id}
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": "Timeout", "agent_id": agent_id}
    except Exception as e:
        return {"ok": False, "error": str(e), "agent_id": agent_id}


# ── API: Models
@app.get("/api/models")
async def get_models(_payload: dict = Depends(require_auth)):
    return {"models": get_available_models()}


# ── API: Health
@app.get("/api/health")
async def health():
    return {"status": "ok", "version": "3.0", "timestamp": datetime.now(timezone.utc).isoformat()}


# ── API: Usage (current month only) — CORRECTED
@app.get("/api/usage")
async def get_usage(payload: dict = Depends(require_auth)):
    """Per-model usage for CURRENT MONTH only, against OpenCode Go quota."""
    ym = current_year_month()
    ym_start = datetime.strptime(ym + "-01", "%Y-%m-%d").replace(tzinfo=timezone.utc)
    ym_start_ms = int(ym_start.timestamp() * 1000)

    sessions_data = openclaw_sessions_json(limit=500)
    sessions = sessions_data.get("sessions", [])

    available = get_available_models()
    opencode_go_models = {m["model"] for m in available}

    model_stats = {}
    for s in sessions:
        # Only count sessions from current month
        ts = s.get("updatedAt", 0)
        if ts < ym_start_ms:
            continue

        raw_model = s.get("model", "unknown")
        model = normalize_model(raw_model)

        if model not in opencode_go_models:
            continue

        if model not in model_stats:
            model_stats[model] = {"total_tokens": 0, "total_sessions": 0}
        model_stats[model]["total_tokens"] += s.get("totalTokens") or 0
        model_stats[model]["total_sessions"] += 1

    results = []
    for model, stats in sorted(model_stats.items(), key=lambda x: x[1]["total_tokens"], reverse=True):
        tokens = stats["total_tokens"]
        cost = estimate_cost_eur(tokens, model)
        pct = round(cost / OPENCODE_GO_MONTHLY_QUOTA * 100, 1)
        req_est = OPENCODE_GO_REQUESTS.get(model, None)
        results.append({
            "model": model,
            "total_tokens": tokens,
            "total_sessions": stats["total_sessions"],
            "estimated_cost_eur": cost,
            "quota_pct": min(pct, 100),
            "quota_monthly_eur": OPENCODE_GO_MONTHLY_QUOTA,
            "requests_est_monthly": req_est,
        })

    total_cost = round(sum(r["estimated_cost_eur"] for r in results), 4)

    return {
        "models": results,
        "total_cost_eur": total_cost,
        "quota_monthly_eur": OPENCODE_GO_MONTHLY_QUOTA,
        "quota_pct": round(total_cost / OPENCODE_GO_MONTHLY_QUOTA * 100, 1),
        "quota_remaining_eur": round(OPENCODE_GO_MONTHLY_QUOTA - total_cost, 4),
        "year_month": ym,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }

@app.get("/api/usage/total")
async def get_usage_total(payload: dict = Depends(require_auth)):
    """ALL-TIME total usage (no month filter) for reference."""
    sessions_data = openclaw_sessions_json(limit=500)
    sessions = sessions_data.get("sessions", [])
    available = get_available_models()
    opencode_go_models = {m["model"] for m in available}

    model_stats = {}
    for s in sessions:
        model = normalize_model(s.get("model", "unknown"))
        if model not in opencode_go_models:
            continue
        if model not in model_stats:
            model_stats[model] = {"total_tokens": 0, "total_sessions": 0}
        model_stats[model]["total_tokens"] += s.get("totalTokens") or 0
        model_stats[model]["total_sessions"] += 1

    results = []
    for model, stats in sorted(model_stats.items(), key=lambda x: x[1]["total_tokens"], reverse=True):
        cost = estimate_cost_eur(stats["total_tokens"], model)
        results.append({
            "model": model,
            "total_tokens": stats["total_tokens"],
            "total_sessions": stats["total_sessions"],
            "estimated_cost_eur": cost,
        })

    return {
        "models": results,
        "total_cost_eur": round(sum(r["estimated_cost_eur"] for r in results), 4),
    }

@app.get("/api/usage/history")
async def get_usage_history(payload: dict = Depends(require_auth)):
    """Monthly cost history from SQLite snapshots."""
    rows = get_cost_history(limit=12)
    # Group by year_month
    by_month = {}
    for r in rows:
        ym = r["year_month"]
        if ym not in by_month:
            by_month[ym] = {"models": [], "total_cost_eur": 0}
        by_month[ym]["models"].append({
            "model": r["model"],
            "total_tokens": r["total_tokens"],
            "estimated_cost_eur": r["estimated_cost_eur"],
        })
        by_month[ym]["total_cost_eur"] += r["estimated_cost_eur"]

    history = [{"year_month": ym, **data} for ym, data in sorted(by_month.items(), reverse=True)]
    return {"history": history}


# ── API: Costs (per-agent for current month)
@app.get("/api/costs")
async def get_costs(payload: dict = Depends(require_auth)):
    snapshot = await get_agents(payload)
    costs = []
    for a in snapshot["agents"]:
        costs.append({
            "agent_id": a["id"],
            "total_tokens": a["total_tokens"],
            "estimated_cost_eur": a["total_cost_eur"],
            "model": a["model"],
            "sessions": a["total_sessions"],
        })
    total = round(sum(c["estimated_cost_eur"] for c in costs), 4)
    return {"costs": costs, "total_cost_eur": total, "updated_at": snapshot["updated_at"]}


# ── WebSocket
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    token = websocket.query_params.get("token", "")
    # Distinguish expired vs invalid tokens for better client handling
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except jwt.ExpiredSignatureError:
        await websocket.close(code=4002, reason="Token expired")
        return
    except JWTError:
        await websocket.close(code=4001, reason="Unauthorized")
        return

    username = payload["sub"]
    await manager.connect(websocket, username)
    try:
        # Send initial snapshot
        snapshot = await get_agents(payload)
        await websocket.send_json({"type": "agents_update", "data": snapshot})

        while True:
            data = await websocket.receive_text()
            msg = json.loads(data)

            if msg.get("type") == "ping":
                await websocket.send_json({"type": "pong"})
            elif msg.get("type") == "get_logs":
                aid = msg.get("agentId", "")
                logs = await _read_logs_async(aid, msg.get("lines", 50))
                await websocket.send_json({"type": "logs", "agentId": aid, "lines": logs["lines"]})
            elif msg.get("type") == "refresh":
                snapshot = await get_agents(payload)
                await websocket.send_json({"type": "agents_update", "data": snapshot})

    except WebSocketDisconnect:
        manager.disconnect(websocket, username)
    except Exception:
        manager.disconnect(websocket, username)


# ── Periodic refresh (rebuilds cache + broadcasts to WebSocket clients)
async def periodic_refresh():
    global _cached_snapshot, _cached_snapshot_ts, _previous_agent_statuses
    while True:
        await asyncio.sleep(15)
        try:
            agents = get_configured_agents()
            sessions_data = openclaw_sessions_json(limit=500)
            sessions = sessions_data.get("sessions", [])
            snapshot = build_agent_snapshot(agents, sessions)

            # Detect agent status changes (running → error)
            for a in snapshot["agents"]:
                prev = _previous_agent_statuses.get(a["id"])
                if prev == "running" and a["status"] == "error":
                    await manager.broadcast({
                        "type": "alert",
                        "alert_type": "agent_error",
                        "agent_id": a["id"],
                        "message": f"⚠️ Agent {a['id']} has failed!",
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                    })
                _previous_agent_statuses[a["id"]] = a["status"]

            _cached_snapshot = snapshot
            _cached_snapshot_ts = time.time()
            await manager.broadcast({"type": "agents_update", "data": snapshot})

            # Save cost snapshots to DB (moved from HTTP handler)
            ym = current_year_month()
            ym_start = datetime.strptime(ym + "-01", "%Y-%m-%d").replace(tzinfo=timezone.utc)
            ym_start_ms = int(ym_start.timestamp() * 1000)
            available = get_available_models()
            opencode_go_models = {m["model"] for m in available}
            model_stats: dict = {}
            for s in sessions:
                ts = s.get("updatedAt", 0)
                if ts < ym_start_ms:
                    continue
                raw_model = s.get("model", "unknown")
                model = normalize_model(raw_model)
                if model not in opencode_go_models:
                    continue
                if model not in model_stats:
                    model_stats[model] = {"total_tokens": 0, "total_sessions": 0}
                model_stats[model]["total_tokens"] += s.get("totalTokens") or 0
                model_stats[model]["total_sessions"] += 1

            for model, stats in model_stats.items():
                cost = estimate_cost_eur(stats["total_tokens"], model)
                save_cost_snapshot(ym, model, stats["total_tokens"], stats["total_sessions"], cost)

            # Quota alert: >80% usage
            total_cost = round(sum(
                estimate_cost_eur(stats["total_tokens"], model)
                for model, stats in model_stats.items()
            ), 4)
            quota_pct = round(total_cost / OPENCODE_GO_MONTHLY_QUOTA * 100, 1)
            if quota_pct > 80:
                await manager.broadcast({
                    "type": "alert",
                    "alert_type": "quota",
                    "message": f"⚠️ Monthly cost at {quota_pct}% of quota! ({total_cost:.2f}€ / {OPENCODE_GO_MONTHLY_QUOTA}€)",
                    "quota_pct": quota_pct,
                    "total_cost_eur": total_cost,
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                })

        except Exception:
            pass


# ── Frontend static files
FRONTEND_DIR = Path(os.environ.get("FRONTEND_DIR", str(Path(__file__).parent.parent / "frontend" / "dist")))
if FRONTEND_DIR.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")


@asynccontextmanager
async def lifespan(app: FastAPI):
    task = asyncio.create_task(periodic_refresh())
    yield
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass

app.router.lifespan_context = lifespan


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", "8000"))
    uvicorn.run(app, host="0.0.0.0", port=port)
