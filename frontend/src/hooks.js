import { useState, useEffect, useCallback } from 'react'

// Auth token management
const TOKEN_KEY = 'dashboard_token'
const USER_KEY = 'dashboard_user'

export function getToken() {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token)
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(USER_KEY)
}

export function setUserInfo(user) {
  if (user) localStorage.setItem(USER_KEY, JSON.stringify(user))
}

export function getUserInfo() {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY) || 'null')
  } catch { return null }
}

export function isAuthenticated() {
  return !!getToken()
}

// Session expired handler (called when 401 detected)
let onSessionExpired = null
export function setSessionExpiredHandler(fn) {
  onSessionExpired = fn
}

// Use relative URLs — works via Vite proxy (dev) and nginx proxy (docker/prod)
const WS_URL = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`
const API_BASE = '/api'

export function useWebSocket() {
  const [agents, setAgents] = useState([])
  const [connected, setConnected] = useState(false)
  const [alerts, setAlerts] = useState([])

  useEffect(() => {
    const token = getToken()
    if (!token) return

    let ws
    let reconnectTimer

    const connect = () => {
      ws = new WebSocket(`${WS_URL}?token=${encodeURIComponent(token)}`)

      ws.onopen = () => {
        setConnected(true)
        if (reconnectTimer) clearTimeout(reconnectTimer)
      }
      ws.onclose = (e) => {
        setConnected(false)
        if (e.code === 4001) {
          // Auth failure — session expired
          clearToken()
          if (onSessionExpired) onSessionExpired()
          return
        }
        reconnectTimer = setTimeout(connect, 5000)
      }
      ws.onerror = () => setConnected(false)

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data)
          if (msg.type === 'agents_update') {
            setAgents(msg.data.agents || [])
          } else if (msg.type === 'alert') {
            setAlerts(prev => [...prev, msg])
          }
        } catch (e) {
          // ignore malformed messages
        }
      }
    }

    connect()

    return () => {
      if (ws) ws.close()
      if (reconnectTimer) clearTimeout(reconnectTimer)
    }
  }, [])

  return { agents, connected, setAgents, alerts }
}

export function useApi() {
  const get = useCallback(async (path) => {
    const headers = {}
    const token = getToken()
    if (token) headers['Authorization'] = `Bearer ${token}`
    const res = await fetch(`${API_BASE}${path}`, { headers })
    if (res.status === 401) {
      clearToken()
      if (onSessionExpired) onSessionExpired()
      throw new Error('SESSION_EXPIRED')
    }
    if (!res.ok) throw new Error(`API ${res.status}`)
    return res.json()
  }, [])

  const post = useCallback(async (path, body) => {
    const headers = { 'Content-Type': 'application/json' }
    const token = getToken()
    if (token) headers['Authorization'] = `Bearer ${token}`
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })
    if (res.status === 401) {
      clearToken()
      if (onSessionExpired) onSessionExpired()
      throw new Error('SESSION_EXPIRED')
    }
    if (!res.ok) throw new Error(`API ${res.status}`)
    return res.json()
  }, [])

  const del = useCallback(async (path) => {
    const headers = {}
    const token = getToken()
    if (token) headers['Authorization'] = `Bearer ${token}`
    const res = await fetch(`${API_BASE}${path}`, { method: 'DELETE', headers })
    if (res.status === 401) {
      clearToken()
      if (onSessionExpired) onSessionExpired()
      throw new Error('SESSION_EXPIRED')
    }
    if (!res.ok) throw new Error(`API ${res.status}`)
    return res.json()
  }, [])

  return { get, post, del }
}
