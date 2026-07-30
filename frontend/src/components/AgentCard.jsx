import { useState, memo } from 'react'
import { MessageSquare, Terminal, Circle, ChevronDown, Clock, Layers, AlertTriangle, Zap } from 'lucide-react'

const STATUS_COLORS = {
  running: 'text-green-400',
  idle: 'text-yellow-400',
  error: 'text-red-400',
}

const STATUS_BG = {
  running: 'bg-green-400/10 border-green-400/30',
  idle: 'bg-yellow-400/10 border-yellow-400/30',
  error: 'bg-red-400/10 border-red-400/30',
}

const STATUS_ICONS = {
  running: Zap,
  idle: Clock,
  error: AlertTriangle,
}

function timeAgo(ms) {
  if (!ms) return 'never'
  const diff = Date.now() - ms
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

function formatTokens(n) {
  if (!n) return '0'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function shortModelName(fullKey) {
  if (!fullKey) return 'unknown'
  const parts = fullKey.split('/')
  if (parts.length >= 2) {
    // Take the last part as the model name
    return parts[parts.length - 1]
  }
  return fullKey
}

export const AgentCard = memo(function AgentCard({ agent, models, onModelChange, onChat, onLogs }) {
  const [showModelSelect, setShowModelSelect] = useState(false)
  const StatusIcon = STATUS_ICONS[agent.status] || Clock

  return (
    <div className={`rounded-lg border p-4 transition-all duration-200 hover:border-primary/50 hover:shadow-lg hover:shadow-primary/5 ${STATUS_BG[agent.status] || STATUS_BG.idle}`}>
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <div className={`w-2 h-2 rounded-full flex-shrink-0 ${agent.status === 'running' ? 'animate-pulse' : ''} ${STATUS_COLORS[agent.status]} bg-current`} />
          <h3 className="font-semibold text-base truncate">{agent.id}</h3>
        </div>
        <div className={`flex items-center gap-1 text-xs font-medium uppercase tracking-wider ${STATUS_COLORS[agent.status]}`}>
          <StatusIcon className="w-3 h-3" />
          {agent.status}
        </div>
      </div>

      {/* Details */}
      <div className="space-y-2.5 text-sm">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Layers className="w-3.5 h-3.5 flex-shrink-0" />
          <span className="truncate text-xs" title={agent.model}>{shortModelName(agent.model)}</span>
          <button
            onClick={() => setShowModelSelect(!showModelSelect)}
            className="ml-auto p-0.5 rounded hover:bg-secondary text-primary hover:text-primary/80 transition-colors"
            title="Change model"
          >
            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showModelSelect ? 'rotate-180' : ''}`} />
          </button>
        </div>

        {showModelSelect && (
          <select
            value={agent.model}
            onChange={(e) => {
              onModelChange(agent.id, e.target.value)
              setShowModelSelect(false)
            }}
            className="w-full bg-input border border-border rounded px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            size={Math.min(models.length, 6)}
          >
            {models.map(m => (
              <option key={m.key} value={m.key}>{m.label}</option>
            ))}
          </select>
        )}

        <div className="flex items-center gap-2 text-muted-foreground">
          <Clock className="w-3.5 h-3.5 flex-shrink-0" />
          <span className="text-xs">{timeAgo(agent.last_updated_ms)}</span>
          <span className="text-xs opacity-70 truncate">· {agent.last_action}</span>
        </div>

        {agent.total_sessions > 0 && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <MessageSquare className="w-3.5 h-3.5 flex-shrink-0" />
            <span className="text-xs">{agent.total_sessions} sessions</span>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2 pt-1">
          <div className="bg-background/50 rounded px-2 py-1.5">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Tokens</div>
            <div className="text-sm font-mono font-medium">{formatTokens(agent.total_tokens)}</div>
          </div>
          <div className="bg-background/50 rounded px-2 py-1.5">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Cost</div>
            <div className={`text-sm font-mono font-medium ${(agent.total_cost_eur || 0) > 0 ? 'text-primary' : ''}`}>
              €{(agent.total_cost_eur || 0).toFixed(2)}
            </div>
          </div>
        </div>

        {/* Model diversity badge */}
        {agent.models_used && Object.keys(agent.models_used).length > 1 && (
          <div className="flex items-center gap-1.5">
            <div className="flex -space-x-1">
              {Object.entries(agent.models_used).slice(0, 4).map(([m, count]) => (
                <div
                  key={m}
                  className="w-4 h-4 rounded-full bg-primary/20 border border-background flex items-center justify-center"
                  title={`${shortModelName(m)}: ${count}`}
                >
                  <span className="text-[6px] text-primary font-bold">{count}</span>
                </div>
              ))}
              {Object.keys(agent.models_used).length > 4 && (
                <div className="w-4 h-4 rounded-full bg-secondary border border-background flex items-center justify-center">
                  <span className="text-[6px] text-muted-foreground">+{Object.keys(agent.models_used).length - 4}</span>
                </div>
              )}
            </div>
            <span className="text-[10px] text-muted-foreground">{Object.keys(agent.models_used).length} models used</span>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-2 mt-3 pt-3 border-t border-border/50">
        <button
          onClick={() => onChat(agent)}
          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-primary/20 hover:bg-primary/30 text-primary transition-colors"
        >
          <MessageSquare className="w-3.5 h-3.5" />
          Chat
        </button>
        <button
          onClick={() => onLogs(agent)}
          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-accent hover:bg-accent/80 text-foreground transition-colors"
        >
          <Terminal className="w-3.5 h-3.5" />
          Logs
        </button>
      </div>
    </div>
  )
})
