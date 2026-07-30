// Dashboard v2.1 — multi-user + monthly costs + SQLite
import { useState, useEffect } from 'react'
import { useWebSocket, useApi, getToken, setToken, clearToken, isAuthenticated, setUserInfo, getUserInfo, setSessionExpiredHandler } from './hooks'
import { LoginPage } from './components/LoginPage'
import { AgentCard } from './components/AgentCard'
import { ChatWindow } from './components/ChatWindow'
import { LogViewer } from './components/LogViewer'
import { ChangePasswordModal } from './components/ChangePasswordModal'
import { UsersPanel } from './components/UsersPanel'
import { CostsPanel } from './components/CostsPanel'
import { Activity, Terminal, DollarSign, Users, Wifi, WifiOff, RefreshCw, Moon, Sun, LogOut, Key, UserCircle } from 'lucide-react'

export default function App() {
  const { agents, connected, setAgents } = useWebSocket()
  const { get, post } = useApi()
  const [models, setModels] = useState([])
  const [activeTab, setActiveTab] = useState('agents')
  const [selectedAgent, setSelectedAgent] = useState(null)
  const [showChat, setShowChat] = useState(false)
  const [showLogs, setShowLogs] = useState(false)
  const [showChangePassword, setShowChangePassword] = useState(false)
  const [darkMode, setDarkMode] = useState(true)
  const [lastUpdated, setLastUpdated] = useState(null)
  const [refreshing, setRefreshing] = useState(false)
  const [authenticated, setAuthenticated] = useState(isAuthenticated())
  const [loginError, setLoginError] = useState(null)
  const [currentUser, setCurrentUser] = useState(getUserInfo())
  const [isAdmin, setIsAdmin] = useState(getUserInfo()?.is_admin || false)
  const [usageData, setUsageData] = useState(null)

  // Handle session expiration from any component
  useEffect(() => {
    setSessionExpiredHandler(() => {
      setAuthenticated(false)
      setLoginError('Session expired. Please sign in again.')
      setAgents([])
    })
  }, [])

  const handleLogin = (token, user) => {
    setToken(token)
    setUserInfo(user)
    setCurrentUser(user)
    setIsAdmin(user?.is_admin || false)
    setAuthenticated(true)
    setLoginError(null)
  }

  const handleLogout = () => {
    clearToken()
    setAuthenticated(false)
    setCurrentUser(null)
    setIsAdmin(false)
    setAgents([])
  }

  useEffect(() => {
    if (authenticated) {
      get('/models').then(d => setModels(d.models || [])).catch(() => {})
      // Fetch current user info
      get('/me').then(d => {
        if (d.user) {
          setCurrentUser(d.user)
          setIsAdmin(d.user.is_admin || false)
          setUserInfo(d.user)
        }
      }).catch(() => {})
    }
  }, [authenticated])

  // Update timestamp when agents change
  useEffect(() => {
    if (agents.length > 0) {
      setLastUpdated(new Date().toLocaleTimeString())
    }
  }, [agents])

  // Apply theme
  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode)
    document.documentElement.classList.toggle('light', !darkMode)
  }, [darkMode])

  const handleModelChange = async (agentId, model) => {
    await post(`/agents/${agentId}/model`, { agentId, model })
  }

  const handleOpenChat = (agent) => {
    setSelectedAgent(agent)
    setShowChat(true)
  }

  const handleOpenLogs = (agent) => {
    setSelectedAgent(agent)
    setShowLogs(true)
  }

  const handleRefresh = async () => {
    setRefreshing(true)
    try {
      const data = await get('/agents')
      if (data?.agents) {
        setAgents(data.agents)
      }
    } catch (e) {
      console.warn('Refresh failed', e)
    }
    setRefreshing(false)
  }

  const tabs = [
    { id: 'agents', label: 'Agents', icon: Activity },
    { id: 'costs', label: 'Costs', icon: DollarSign },
  ]
  if (isAdmin) {
    tabs.push({ id: 'users', label: 'Users', icon: Users })
  }

  const runningCount = agents.filter(a => a.status === 'running').length
  const errorCount = agents.filter(a => a.status === 'error').length

  return (
    <>
      {!authenticated ? (
        <LoginPage onLogin={handleLogin} error={loginError} />
      ) : (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="border-b border-border bg-card/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center">
              <Terminal className="w-4 h-4 text-primary" />
            </div>
            <div>
              <h1 className="font-semibold text-base leading-tight">OpenClaw Dashboard</h1>
              <p className="text-[10px] text-muted-foreground leading-tight">
                {agents.length} agents · {runningCount} active
                {errorCount > 0 && ` · ${errorCount} errors`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {/* Current user badge */}
            {currentUser && (
              <span className="text-xs text-muted-foreground hidden sm:flex items-center gap-1">
                <UserCircle className="w-3.5 h-3.5" />
                {currentUser.username}
                {isAdmin && <span className="text-[10px] bg-primary/10 text-primary px-1 rounded">admin</span>}
              </span>
            )}
            {lastUpdated && (
              <span className="text-xs text-muted-foreground hidden sm:inline">
                Updated {lastUpdated}
              </span>
            )}
            <button
              onClick={handleRefresh}
              className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
              title="Refresh"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={() => setDarkMode(!darkMode)}
              className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
              title={darkMode ? 'Light mode' : 'Dark mode'}
            >
              {darkMode ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
            </button>
            <button
              onClick={() => setShowChangePassword(true)}
              className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
              title="Change password"
            >
              <Key className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={handleLogout}
              className="p-1.5 rounded-md hover:bg-red-400/10 text-muted-foreground hover:text-red-400 transition-colors"
              title="Sign out"
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
            <div className="flex items-center gap-1.5">
              <div className={`w-2 h-2 rounded-full ${connected ? 'bg-green-400 animate-pulse' : 'bg-muted-foreground'}`} />
              <span className={`text-xs ${connected ? 'text-green-400' : 'text-muted-foreground'}`}>
                {connected ? 'Live' : 'Offline'}
              </span>
            </div>
          </div>
        </div>
      </header>

      {/* Tabs */}
      <div className="max-w-7xl mx-auto px-4 pt-4">
        <div className="flex gap-1 border-b border-border">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-5 py-2.5 text-sm font-medium rounded-t-lg transition-all duration-150 border-b-2 -mb-[1px]
                ${activeTab === tab.id
                  ? 'border-primary text-primary bg-primary/5'
                  : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
                }`}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <main className="max-w-7xl mx-auto px-4 py-6">
        {activeTab === 'agents' && (
          <>
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-2xl font-bold">Agents</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  {agents.length} agents monitored · {runningCount} active
                  {errorCount > 0 && <> · <span className="text-red-400">{errorCount} with errors</span></>}
                </p>
              </div>
              <div className="flex gap-1.5">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-card border border-border rounded-md px-2.5 py-1">
                  <div className="w-2 h-2 rounded-full bg-green-400" />
                  Active
                </div>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-card border border-border rounded-md px-2.5 py-1">
                  <div className="w-2 h-2 rounded-full bg-yellow-400" />
                  Idle
                </div>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-card border border-border rounded-md px-2.5 py-1">
                  <div className="w-2 h-2 rounded-full bg-red-400" />
                  Error
                </div>
              </div>
            </div>

            {agents.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {agents.map(agent => (
                  <AgentCard
                    key={agent.id}
                    agent={agent}
                    models={models}
                    onModelChange={handleModelChange}
                    onChat={handleOpenChat}
                    onLogs={handleOpenLogs}
                  />
                ))}
              </div>
            ) : (
              <div className="text-center py-16 text-muted-foreground">
                <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-secondary/50 flex items-center justify-center">
                  <Activity className="w-8 h-8 opacity-40" />
                </div>
                <p className="text-lg font-medium">No agents found</p>
                <p className="text-sm mt-1">Waiting for data from OpenClaw...</p>
              </div>
            )}
          </>
        )}

        {activeTab === 'costs' && (
          <CostsPanel agents={agents} />
        )}

        {activeTab === 'users' && isAdmin && (
          <UsersPanel />
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-border py-3 px-4 text-center text-xs text-muted-foreground">
        OpenClaw Dashboard · v2.0 · {agents.length} agents tracked · {currentUser?.username || 'unknown'}
      </footer>

      {/* Chat Modal */}
      {showChat && selectedAgent && (
        <ChatWindow
          agent={selectedAgent}
          onClose={() => setShowChat(false)}
          apiPost={post}
          apiGet={get}
        />
      )}

      {/* Logs Modal */}
      {showLogs && selectedAgent && (
        <LogViewer
          agent={selectedAgent}
          onClose={() => setShowLogs(false)}
        />
      )}

      {/* Change Password Modal */}
      {showChangePassword && (
        <ChangePasswordModal
          onClose={() => setShowChangePassword(false)}
          apiPost={post}
        />
      )}
    </div>
      )}
    </>
  )
}
