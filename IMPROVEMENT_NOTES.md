# Improvement Notes — agents-dashboard audit

## Implemented (2026-07-30)

### 1. ✅ Cache de snapshot (15s TTL)
El cache existente tenía 10s de TTL. Se aumentó a 15s para mayor eficiencia.
El endpoint `/api/costs` ya usaba el caché vía `get_agents()`, así que el
rendimiento es correcto.

### 2. ✅ SQLite solo en periodic_refresh
Se movió `save_cost_snapshot()` del handler HTTP `/api/usage` a
`periodic_refresh()`. Ahora la DB solo se escribe cada 15s, no en cada request.

### 3. ✅ Logs no bloqueantes
Se reemplazó `Path.read_text()` síncrono con `asyncio.to_thread()` + `deque(maxlen=N)`.

### 4. ✅ LogViewer sin doble WebSocket
Se eliminó el segundo WebSocket y el polling 5s. Ahora usa REST `/api/agents/{id}/logs`
con `setInterval(fetchLogs, 5000)`.

### 5. ✅ React.memo en AgentCard y CostsPanel
Ambos componentes envueltos en `React.memo`. Los callbacks en App.jsx usan
`useCallback` para estabilizar las props.

### 6. ✅ Notificaciones de fallo de agente
`periodic_refresh()` detecta transiciones `running → error` y envía evento WS
tipo `alert`. El frontend muestra toast notifications.

### 7. ✅ Exportar CSV de costes
Botón "Export CSV" en CostsPanel que genera y descarga un archivo CSV con datos
de agentes y modelos.

### 8. ✅ Búsqueda y filtros
Barra de búsqueda por nombre de agente + filtro desplegable por estado
(all/running/idle/error). Se usa `useMemo` para filtrar eficientemente.

### 9. ✅ Alertas de cuota >80%
Backend envía evento WS tipo `alert` con `alert_type: "quota"` cuando el coste
mensual >80%. Frontend muestra badge rojo prominente en CostsPanel + toast.

### 10. ✅ Modo oscuro/claro
El toggle ya existía. Se añadió persistencia en `localStorage` para mantener
la preferencia entre sesiones.

## Notas adicionales

- **WebSocket `get_logs` handler:** Se mantuvo en el backend para compatibilidad
  hacia atrás, aunque el frontend ya no lo usa.
- **Compatibilidad Python 3.10+:** Se usó `asyncio.to_thread()` (disponible 3.9+)
  y `dict | None` como type hint (3.10+).
- **API existente:** No se rompió ningún endpoint. Todos los cambios son
  aditivos o internos.
- **Pricing/_load_pricing:** Se mantiene síncrono porque se ejecuta una sola
  vez al iniciar el módulo, no durante requests.
