# OpenClaw Agents Dashboard

Web dashboard para monitorizar agentes OpenClaw en tiempo real.

## Arquitectura

```
agents-dashboard/
├── backend/          # FastAPI + WebSocket
│   ├── main.py       # API server wrapping openclaw CLI
│   ├── Dockerfile
│   └── requirements.txt
├── frontend/         # React + Vite + Tailwind + shadcn/ui
│   ├── src/
│   │   ├── App.jsx
│   │   ├── hooks.js           # WebSocket + API hooks (auto-reconnect)
│   │   └── components/
│   │       ├── AgentCard.jsx   # Card individual con estado/modelo/coste
│   │       ├── ChatWindow.jsx  # Chat modal con historial
│   │       ├── LogViewer.jsx   # Logs en tiempo real (WebSocket)
│   │       └── CostsPanel.jsx  # Tabla de costes con sorting
│   ├── nginx.conf              # Proxy para prod (API + WS)
│   ├── Dockerfile              # Multi-stage build → nginx
│   └── package.json
├── data/             # JSON persistence (dashboard.json)
├── docker-compose.yml
├── dev.sh            # Dev startup script
└── README.md
```

## Arranque rápido

### Desarrollo local (recomendado)
```bash
cd agents-dashboard
./dev.sh
```
- Dashboard: **http://localhost:3002**
- Backend API directa: **http://localhost:3001**
- El frontend usa Vite proxy → backend. WebSocket incluido.

### Docker Compose
```bash
cd agents-dashboard
docker compose up -d --build
```
- Dashboard: **http://localhost:3001**
- Backend interno en puerto 8000, accesible vía nginx proxy
- Monta `~/.openclaw` (ro) y `openclaw` CLI del host

> ⚠️ Docker necesita el CLI `openclaw` en `/usr/local/bin/openclaw` y el directorio `~/.openclaw`.
> Las funciones que dependen del CLI (chat, logs) pueden fallar si `openclaw` no está disponible dentro del contenedor.
> Para desarrollo usa `dev.sh`, que funciona directamente en el host.

## Endpoints API

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/health` | Health check |
| GET | `/api/agents` | Lista todos los agentes con estado, tokens, coste |
| GET | `/api/agents/:id` | Detalle de un agente |
| GET | `/api/agents/:id/logs?lines=50` | Últimas líneas del transcript |
| GET | `/api/agents/:id/chat` | Historial del chat del dashboard |
| POST | `/api/agents/:id/chat` | Enviar mensaje al agente vía `openclaw agent` |
| POST | `/api/agents/:id/model` | Cambiar modelo del agente (persistido) |
| GET | `/api/models` | Modelos disponibles del config |
| GET | `/api/costs` | Costes agregados por agente |
| WS | `/ws` | WebSocket para actualizaciones en tiempo real |

## Funcionalidades

1. **Vista de agentes** — Cards con estado (idle/running/error), modelo, tokens, coste, diversidad de modelos
2. **Chat por agente** — Ventana modal con historial persistido, envío de mensajes vía `openclaw agent`
3. **Selector de modelo** — Dropdown con 27 modelos del config, cambio persistido en dashboard.json
4. **Logs en tiempo real** — Transcript vía WebSocket + REST, auto-refresh cada 5s
5. **Panel de costes** — Costes estimados por agente con tabla sortable (cost/tokens/sessions/name)
6. **Dark/Light mode** — Toggle en header, persistido vía CSS custom properties
7. **Auto-reconnect WebSocket** — Reconexión automática cada 5s si se cae
8. **Live updates** — Broadcast de snapshot cada 15s a todos los clientes conectados

## Persistencia

- `data/dashboard.json` — Overrides de modelo, historial de chat (escritura)
- `~/.openclaw/openclaw.json` — Config de agentes (solo lectura)
- `~/.openclaw/agents/*/sessions/` — Transcripts (solo lectura)
- Los datos de sesiones vienen del CLI `openclaw sessions --json --all-agents`

## Solución de problemas

### "No agents found"
- Verifica que `~/.openclaw/openclaw.json` existe y tiene `agents.list` configurado
- Comprueba que el backend tiene `OPENCLAW_STATE_DIR` apuntando a `~/.openclaw`

### WebSocket desconectado
- Si usas Docker, verifica que el contenedor backend está corriendo (`docker compose ps`)
- En desarrollo, comprueba que el backend arrancó en el puerto 3001

### "No logs" para un agente
- El agente debe haber tenido al menos una sesión con transcript
- Los logs se leen de `~/.openclaw/agents/<agent>/sessions/*.jsonl`

### Chat no responde
- El chat usa `openclaw agent --agent <id> --message "..."`
- Necesita el CLI `openclaw` accesible en el PATH del backend
- En Docker, requiere el bind mount del binario (`/usr/local/bin/openclaw`)
