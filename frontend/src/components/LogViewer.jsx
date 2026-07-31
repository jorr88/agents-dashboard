import { useState, useEffect, useRef } from 'react'
import { X, Terminal, RefreshCw } from 'lucide-react'
import { getToken } from '../hooks'

export function LogViewer({ agent, onClose }) {
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(true)
  const bottomRef = useRef(null)

  const fetchLogs = () => {
    setLoading(true)
    const headers = {}
    const token = getToken()
    if (token) headers['Authorization'] = `Bearer ${token}`
    fetch(`/api/agents/${agent.id}/logs?lines=100`, { headers })
      .then(r => r.json())
      .then(d => {
        setLogs(d.lines || [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }

  useEffect(() => {
    fetchLogs()

    // Refresh via REST every 5s instead of a second WebSocket
    const interval = setInterval(fetchLogs, 5000)

    return () => {
      clearInterval(interval)
    }
  }, [agent.id])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-card border border-border rounded-lg w-full max-w-3xl h-[600px] flex flex-col mx-4 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <Terminal className="w-4 h-4 text-green-400" />
            <span className="font-semibold">Logs · {agent.id}</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={fetchLogs}
              className="text-muted-foreground hover:text-foreground p-1"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Logs Content */}
        <div className="flex-1 overflow-y-auto p-4 font-mono text-xs bg-black/30">
          {loading && (
            <div className="text-center text-muted-foreground py-12">
              <RefreshCw className="w-6 h-6 mx-auto mb-2 animate-spin opacity-50" />
              <p>Loading logs...</p>
            </div>
          )}

          {!loading && logs.length === 0 && (
            <div className="text-center text-muted-foreground py-12">
              <Terminal className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p>No recent logs for {agent.id}</p>
            </div>
          )}

          {logs.map((line, i) => (
            <div
              key={i}
              className={`py-0.5 ${
                line.includes('[error]') || line.includes('ERROR')
                  ? 'text-red-400'
                  : line.includes('[warning]') || line.includes('WARN')
                  ? 'text-yellow-400'
                  : line.includes('[assistant]')
                  ? 'text-blue-300'
                  : line.includes('[user]')
                  ? 'text-green-300'
                  : 'text-muted-foreground'
              }`}
            >
              <span className="opacity-50 mr-3 select-none">{String(i + 1).padStart(3, ' ')}</span>
              {line}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        {/* Footer */}
        <div className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
          {logs.length} lines · Auto-refreshes every 5s
        </div>
      </div>
    </div>
  )
}
