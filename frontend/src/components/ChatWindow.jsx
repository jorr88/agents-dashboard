import { useState, useEffect, useRef } from 'react'
import { X, Send, Bot, User, Loader2 } from 'lucide-react'

export function ChatWindow({ agent, onClose, apiPost, apiGet }) {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const bottomRef = useRef(null)

  useEffect(() => {
    apiGet(`/agents/${agent.id}/chat`).then(d => {
      if (d.messages) setMessages(d.messages)
    })
  }, [agent.id])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSend = async () => {
    if (!input.trim() || sending) return
    const msg = input.trim()
    setInput('')
    setSending(true)

    // Optimistic user message
    setMessages(prev => [...prev, { role: 'user', content: msg }])

    try {
      const res = await apiPost(`/agents/${agent.id}/chat`, {
        agentId: agent.id,
        message: msg,
      })
      // apiPost throws on non-ok, so res is always successful here
      setMessages(prev => [...prev, {
        role: res.ok === false ? 'error' : 'assistant',
        content: res.reply || res.error || JSON.stringify(res)
      }])
    } catch (e) {
      setMessages(prev => [...prev, { role: 'error', content: e.message === 'SESSION_EXPIRED' ? 'Session expired. Please refresh.' : String(e) }])
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-card border border-border rounded-lg w-full max-w-2xl h-[600px] flex flex-col mx-4 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <Bot className="w-4 h-4 text-primary" />
            <span className="font-semibold">Chat with {agent.id}</span>
            <span className="text-xs text-muted-foreground">· {agent.model}</span>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {messages.length === 0 && (
            <div className="text-center text-muted-foreground py-12">
              <Bot className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">Start a conversation with {agent.id}</p>
            </div>
          )}

          {messages.map((msg, i) => (
            <div
              key={i}
              className={`flex gap-2 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              {msg.role !== 'user' && (
                <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0 mt-1">
                  {msg.role === 'error' ? (
                    <X className="w-3 h-3 text-red-400" />
                  ) : (
                    <Bot className="w-3 h-3 text-primary" />
                  )}
                </div>
              )}
              <div
                className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                  msg.role === 'user'
                    ? 'bg-primary text-primary-foreground'
                    : msg.role === 'error'
                    ? 'bg-red-400/10 text-red-400 border border-red-400/20'
                    : 'bg-secondary text-secondary-foreground'
                }`}
              >
                <pre className="whitespace-pre-wrap font-sans">{msg.content}</pre>
              </div>
              {msg.role === 'user' && (
                <div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center flex-shrink-0 mt-1">
                  <User className="w-3 h-3 text-primary-foreground" />
                </div>
              )}
            </div>
          ))}

          {sending && (
            <div className="flex gap-2">
              <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center">
                <Loader2 className="w-3 h-3 text-primary animate-spin" />
              </div>
              <div className="bg-secondary rounded-lg px-3 py-2 text-sm text-muted-foreground">
                Thinking...
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="border-t border-border p-3">
          <div className="flex gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSend()}
              placeholder={`Message ${agent.id}...`}
              disabled={sending}
              className="flex-1 bg-input border border-border rounded-md px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || sending}
              className="bg-primary hover:bg-primary/90 text-primary-foreground rounded-md px-3 py-2 disabled:opacity-50 transition-colors"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
