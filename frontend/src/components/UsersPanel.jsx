import { useState, useEffect } from 'react'
import { useApi } from '../hooks'
import { Users, UserPlus, Trash2, Shield, ShieldOff, AlertCircle, CheckCircle, X, Loader2 } from 'lucide-react'

export function UsersPanel() {
  const { get, post, del } = useApi()
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [newUser, setNewUser] = useState('')
  const [newPass, setNewPass] = useState('')
  const [newIsAdmin, setNewIsAdmin] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)

  const loadUsers = () => {
    setLoading(true)
    get('/users')
      .then(d => setUsers(d.users || []))
      .catch(() => setError('Failed to load users'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadUsers() }, [])

  const handleAdd = async (e) => {
    e.preventDefault()
    setError(null)
    setSuccess(null)
    if (!newUser.trim() || !newPass.trim()) {
      setError('Username and password are required')
      return
    }
    if (newPass.length < 4) {
      setError('Password must be at least 4 characters')
      return
    }
    try {
      await post('/users', { username: newUser.trim(), password: newPass, is_admin: newIsAdmin })
      setSuccess(`User "${newUser.trim()}" created`)
      setNewUser('')
      setNewPass('')
      setNewIsAdmin(false)
      setShowAdd(false)
      loadUsers()
    } catch (e) {
      if (e.message.includes('409')) setError('Username already exists')
      else setError(e.message || 'Failed to create user')
    }
  }

  const handleDelete = async (username) => {
    if (!window.confirm(`Delete user "${username}"? This cannot be undone.`)) return
    setError(null)
    try {
      await del(`/users/${username}`)
      setSuccess(`User "${username}" deleted`)
      loadUsers()
    } catch (e) {
      setError(e.message || 'Failed to delete user')
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold">Users</h2>
          <p className="text-sm text-muted-foreground mt-1">
            {users.length} user{users.length !== 1 ? 's' : ''} registered
          </p>
        </div>
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-md text-sm font-medium transition-colors"
        >
          <UserPlus className="w-4 h-4" />
          Add User
        </button>
      </div>

      {/* Alerts */}
      {error && (
        <div className="mb-4 p-3 rounded-lg bg-red-400/10 border border-red-400/20 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}
      {success && (
        <div className="mb-4 p-3 rounded-lg bg-green-400/10 border border-green-400/20 flex items-start gap-2">
          <CheckCircle className="w-4 h-4 text-green-400 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-green-400">{success}</p>
        </div>
      )}

      {/* Add user form */}
      {showAdd && (
        <form onSubmit={handleAdd} className="mb-6 p-4 rounded-lg border border-border bg-card">
          <h3 className="text-sm font-semibold mb-3">Create New User</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
            <input
              type="text"
              value={newUser}
              onChange={e => setNewUser(e.target.value)}
              placeholder="Username"
              className="bg-input border border-border rounded-md px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <input
              type="password"
              value={newPass}
              onChange={e => setNewPass(e.target.value)}
              placeholder="Password (min 4 chars)"
              className="bg-input border border-border rounded-md px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={newIsAdmin}
                onChange={e => setNewIsAdmin(e.target.checked)}
                className="rounded border-border"
              />
              Admin privileges
            </label>
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              className="px-4 py-1.5 bg-primary hover:bg-primary/90 text-primary-foreground rounded-md text-sm font-medium transition-colors"
            >
              Create
            </button>
            <button
              type="button"
              onClick={() => setShowAdd(false)}
              className="px-4 py-1.5 bg-secondary hover:bg-secondary/80 text-foreground rounded-md text-sm transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Users table */}
      <div className="rounded-lg border border-border overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-secondary/50 text-xs uppercase text-muted-foreground">
              <th className="text-left px-4 py-3 font-medium">Username</th>
              <th className="text-left px-4 py-3 font-medium">Role</th>
              <th className="text-left px-4 py-3 font-medium">Created</th>
              <th className="text-left px-4 py-3 font-medium">Last Login</th>
              <th className="text-right px-4 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {users.map(u => (
              <tr key={u.username} className="hover:bg-secondary/20 transition-colors">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Users className="w-4 h-4 text-muted-foreground" />
                    <span className="font-medium">{u.username}</span>
                  </div>
                </td>
                <td className="px-4 py-3">
                  {u.is_admin ? (
                    <span className="inline-flex items-center gap-1 text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                      <Shield className="w-3 h-3" /> Admin
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs bg-secondary text-muted-foreground px-2 py-0.5 rounded-full">
                      <ShieldOff className="w-3 h-3" /> User
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-xs text-muted-foreground">
                  {u.created_at ? new Date(u.created_at + 'Z').toLocaleDateString() : '-'}
                </td>
                <td className="px-4 py-3 text-xs text-muted-foreground">
                  {u.last_login ? new Date(u.last_login + 'Z').toLocaleString() : 'Never'}
                </td>
                <td className="px-4 py-3 text-right">
                  {u.username !== 'admin' && (
                    <button
                      onClick={() => handleDelete(u.username)}
                      className="p-1.5 rounded-md hover:bg-red-400/10 text-muted-foreground hover:text-red-400 transition-colors"
                      title="Delete user"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
