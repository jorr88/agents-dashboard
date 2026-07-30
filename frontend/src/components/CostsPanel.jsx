import { useState, useEffect } from 'react'
import { useApi } from '../hooks'
import { DollarSign, TrendingUp, Layers, ArrowUpDown, ArrowUp, ArrowDown, BarChart3, Calendar } from 'lucide-react'

function formatTokens(n) {
  if (!n) return '0'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function shortModelName(fullKey) {
  if (!fullKey) return 'unknown'
  const parts = fullKey.split('/')
  return parts.length >= 2 ? parts[parts.length - 1] : fullKey
}

function fmtEur(n) {
  if (n == null) return '€0.00'
  return `€${n.toFixed(2)}`
}

function barColor(pct) {
  if (pct > 80) return 'bg-red-500'
  if (pct > 50) return 'bg-yellow-500'
  return 'bg-green-500'
}

const SORT_FIELDS = {
  name: { label: 'Agent', key: 'id' },
  tokens: { label: 'Tokens', key: 'total_tokens' },
  sessions: { label: 'Sessions', key: 'total_sessions' },
  cost: { label: 'Cost', key: 'total_cost_eur' },
}

const currentMonthLabel = new Date().toLocaleDateString('es-ES', { month: 'long', year: 'numeric' })

export function CostsPanel({ agents }) {
  const { get } = useApi()
  const [sortField, setSortField] = useState('cost')
  const [sortDir, setSortDir] = useState('desc')
  const [modelUsage, setModelUsage] = useState(null)
  const [usageTotal, setUsageTotal] = useState(null)

  useEffect(() => {
    get('/usage').then(data => setModelUsage(data)).catch(() => {})
    get('/usage/total').then(data => setUsageTotal(data)).catch(() => {})
  }, [])

  const totalCost = agents.reduce((sum, a) => sum + (a.total_cost_eur || 0), 0)
  const totalTokens = agents.reduce((sum, a) => sum + (a.total_tokens || 0), 0)
  const totalSessions = agents.reduce((sum, a) => sum + (a.total_sessions || 0), 0)

  const sorted = [...agents].sort((a, b) => {
    const key = SORT_FIELDS[sortField]?.key || 'total_cost_eur'
    const va = a[key] || 0
    const vb = b[key] || 0
    if (sortField === 'name') {
      return sortDir === 'asc' ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va))
    }
    return sortDir === 'asc' ? va - vb : vb - va
  })

  const handleSort = (field) => {
    if (sortField === field) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDir('desc')
    }
  }

  const SortIcon = ({ field }) => {
    if (sortField !== field) return <ArrowUpDown className="w-3 h-3 opacity-40" />
    return sortDir === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />
  }

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-2xl font-bold">Costs &amp; Usage</h2>
        <div className="flex items-center gap-2 mt-1">
          <p className="text-sm text-muted-foreground">OpenCode Go — estimated API usage</p>
          <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium capitalize inline-flex items-center gap-1">
            <Calendar className="w-3 h-3" />
            {modelUsage?.year_month
              ? new Date(modelUsage.year_month + '-01').toLocaleDateString('es-ES', { month: 'long', year: 'numeric' })
              : currentMonthLabel}
          </span>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        <div className="rounded-lg border border-border bg-card p-4 hover:border-primary/30 transition-colors">
          <div className="flex items-center gap-2 text-muted-foreground text-sm mb-2">
            <DollarSign className="w-4 h-4 text-primary" />
            Total Cost (mes)
          </div>
          <div className="text-2xl font-bold text-primary">{fmtEur(modelUsage?.total_cost_eur || totalCost)}</div>
          <div className="text-xs text-muted-foreground mt-1">
            de {fmtEur(modelUsage?.quota_monthly_eur || 55.80)}
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card p-4 hover:border-primary/30 transition-colors">
          <div className="flex items-center gap-2 text-muted-foreground text-sm mb-2">
            <TrendingUp className="w-4 h-4 text-green-400" />
            Total Tokens (mes)
          </div>
          <div className="text-2xl font-bold">{formatTokens(modelUsage?.models?.reduce((s, m) => s + m.total_tokens, 0) || totalTokens)}</div>
          <div className="text-xs text-muted-foreground mt-1">
            histórico: {formatTokens(usageTotal?.models?.reduce((s, m) => s + m.total_tokens, 0) || 0)}
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card p-4 hover:border-primary/30 transition-colors">
          <div className="flex items-center gap-2 text-muted-foreground text-sm mb-2">
            <Layers className="w-4 h-4 text-blue-400" />
            Sessions (mes)
          </div>
          <div className="text-2xl font-bold">{modelUsage?.models?.reduce((s, m) => s + m.total_sessions, 0) || totalSessions}</div>
          <div className="text-xs text-muted-foreground mt-1">Conversaciones este mes</div>
        </div>

        <div className={`rounded-lg border p-4 transition-colors ${(modelUsage?.quota_pct || 0) > 80 ? 'border-red-400/40 bg-red-400/5' : 'border-border bg-card'}`}>
          <div className="flex items-center gap-2 text-muted-foreground text-sm mb-2">
            <DollarSign className={`w-4 h-4 ${(modelUsage?.quota_pct || 0) > 80 ? 'text-red-400' : 'text-yellow-400'}`} />
            Cuota restante
          </div>
          <div className={`text-2xl font-bold ${(modelUsage?.quota_pct || 0) > 80 ? 'text-red-400' : 'text-primary'}`}>
            {fmtEur(modelUsage?.quota_remaining_eur || 55.80)}
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            {(modelUsage?.quota_pct || 0).toFixed(1)}% consumido
          </div>
        </div>
      </div>

      {/* Model Usage Bars — Current Month */}
      {modelUsage && modelUsage.models && modelUsage.models.length > 0 && (
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-4">
            <BarChart3 className="w-5 h-5 text-primary" />
            <h3 className="text-lg font-semibold">OpenCode Go — Uso por modelo</h3>
            <span className="text-xs text-muted-foreground ml-auto">
              {fmtEur(modelUsage.total_cost_eur)} / {fmtEur(modelUsage.quota_monthly_eur)}
            </span>
          </div>
          <div className="space-y-3">
            {modelUsage.models.map(m => (
              <div key={m.model} className="rounded-lg border border-border bg-card p-3">
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm font-mono font-medium truncate">{m.model}</span>
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      {formatTokens(m.total_tokens)} tokens · {m.total_sessions} sesiones
                    </span>
                  </div>
                  <span className="text-sm font-mono font-bold text-primary ml-3 whitespace-nowrap">
                    {fmtEur(m.estimated_cost_eur)}
                  </span>
                </div>
                <div className="w-full h-5 bg-secondary rounded-full overflow-hidden relative">
                  <div
                    className={`h-full ${barColor(m.quota_pct)} rounded-full transition-all duration-500 flex items-center justify-end pr-2`}
                    style={{ width: `${Math.max(m.quota_pct, 1)}%`, minWidth: m.quota_pct > 0 ? '2rem' : '0' }}
                  >
                    {m.quota_pct > 8 && (
                      <span className="text-xs text-white font-medium drop-shadow">{m.quota_pct}%</span>
                    )}
                  </div>
                  {m.quota_pct <= 8 && (
                    <span className="absolute left-2 top-0 bottom-0 flex items-center text-xs font-medium text-foreground">
                      {m.quota_pct}%
                    </span>
                  )}
                </div>
                <div className="flex justify-between text-xs text-muted-foreground mt-1">
                  <span>{m.requests_est_monthly ? `${m.requests_est_monthly.toLocaleString()} req/mes est.` : ''}</span>
                  <span>Cuota: {fmtEur(m.quota_monthly_eur)}/mes</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Per-Agent Table */}
      <div className="rounded-lg border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-secondary/50 text-xs uppercase text-muted-foreground">
                <th
                  className="text-left px-4 py-3 font-medium cursor-pointer hover:text-foreground transition-colors select-none"
                  onClick={() => handleSort('name')}
                >
                  <div className="flex items-center gap-1">
                    Agent <SortIcon field="name" />
                  </div>
                </th>
                <th className="text-left px-4 py-3 font-medium">Model</th>
                <th
                  className="text-right px-4 py-3 font-medium cursor-pointer hover:text-foreground transition-colors select-none"
                  onClick={() => handleSort('tokens')}
                >
                  <div className="flex items-center justify-end gap-1">
                    Tokens <SortIcon field="tokens" />
                  </div>
                </th>
                <th
                  className="text-right px-4 py-3 font-medium cursor-pointer hover:text-foreground transition-colors select-none"
                  onClick={() => handleSort('sessions')}
                >
                  <div className="flex items-center justify-end gap-1">
                    Sessions <SortIcon field="sessions" />
                  </div>
                </th>
                <th
                  className="text-right px-4 py-3 font-medium cursor-pointer hover:text-foreground transition-colors select-none"
                  onClick={() => handleSort('cost')}
                >
                  <div className="flex items-center justify-end gap-1">
                    Cost (€) <SortIcon field="cost" />
                  </div>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {sorted.map((agent, i) => {
                const costPct = totalCost > 0 ? ((agent.total_cost_eur || 0) / totalCost * 100) : 0
                return (
                  <tr key={agent.id} className="hover:bg-secondary/20 transition-colors group">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground w-4">{i + 1}</span>
                        <span className="font-medium">{agent.id}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">
                      <span title={agent.model}>{shortModelName(agent.model)}</span>
                    </td>
                    <td className="px-4 py-3 text-sm text-right font-mono tabular-nums">
                      {formatTokens(agent.total_tokens)}
                    </td>
                    <td className="px-4 py-3 text-sm text-right tabular-nums">{agent.total_sessions}</td>
                    <td className="px-4 py-3 text-sm text-right">
                      <div className="flex items-center justify-end gap-2">
                        <div className="w-12 h-1.5 bg-secondary rounded-full overflow-hidden hidden sm:block">
                          <div
                            className="h-full bg-primary rounded-full"
                            style={{ width: `${Math.max(costPct, 2)}%` }}
                          />
                        </div>
                        <span className="font-mono tabular-nums text-primary">
                          {fmtEur(agent.total_cost_eur || 0)}
                        </span>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {sorted.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          <DollarSign className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p>No cost data available yet</p>
        </div>
      )}

      <p className="text-xs text-muted-foreground mt-4 text-center">
        Costs are rough estimates based on approximate per-model pricing. Not actual billing.
        Data shown for {currentMonthLabel} (current month).
      </p>
    </div>
  )
}
