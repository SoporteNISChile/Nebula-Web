import { useState, useEffect, useRef, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Play, Square, Trash2, Download } from 'lucide-react'
import { logs as logsApi } from '../api/client'
import { LevelBadge } from '../components/StatusBadge'

function LogLine({ log }) {
  const bg = {
    error: 'bg-red-950/30',
    warning: 'bg-yellow-950/20',
    warn: 'bg-yellow-950/20',
  }[log.level] ?? ''

  return (
    <div className={`px-4 py-0.5 flex gap-3 text-xs font-mono hover:bg-gray-800/40 group ${bg}`}>
      <span className="text-gray-600 shrink-0 w-44">{log.time?.replace('T', ' ').replace('Z', '')}</span>
      <span className="w-12 shrink-0"><LevelBadge level={log.level} /></span>
      <span className="text-gray-300 break-all">{log.msg}</span>
      {Object.keys(log.fields ?? {}).length > 0 && (
        <span className="text-gray-600 hidden group-hover:inline">
          {Object.entries(log.fields).map(([k, v]) => `${k}=${v}`).join(' ')}
        </span>
      )}
    </div>
  )
}

export default function Logs() {
  const [live, setLive] = useState(false)
  const [liveLogs, setLiveLogs] = useState([])
  const [level, setLevel] = useState('')
  const [search, setSearch] = useState('')
  const [lines, setLines] = useState(200)
  const bottomRef = useRef(null)
  const esRef = useRef(null)

  const { data, refetch } = useQuery({
    queryKey: ['logs', lines, level, search],
    queryFn: () => logsApi.get({ n: lines, level: level || undefined, search: search || undefined }).then(r => r.data),
    enabled: !live,
  })

  const startLive = useCallback(() => {
    setLiveLogs([])
    const token = localStorage.getItem('nebula_token')
    const url = `${logsApi.streamUrl()}?token=${token}`
    const es = new EventSource(url)
    es.onmessage = (e) => {
      try {
        const log = JSON.parse(e.data)
        if (level && log.level !== level) return
        if (search && !log.raw?.toLowerCase().includes(search.toLowerCase())) return
        setLiveLogs(prev => [...prev.slice(-999), log])
      } catch {}
    }
    esRef.current = es
    setLive(true)
  }, [level, search])

  const stopLive = useCallback(() => {
    esRef.current?.close()
    setLive(false)
  }, [])

  useEffect(() => () => esRef.current?.close(), [])

  useEffect(() => {
    if (live) bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [liveLogs, live])

  const displayLogs = live ? liveLogs : (data?.logs ?? [])

  function downloadLogs() {
    const text = displayLogs.map(l => l.raw ?? `${l.time} [${l.level}] ${l.msg}`).join('\n')
    const blob = new Blob([text], { type: 'text/plain' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `nebula-logs-${Date.now()}.txt`
    a.click()
  }

  return (
    <div className="p-6 flex flex-col h-full space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-xl font-semibold text-white">Logs</h1>
        <div className="flex items-center gap-2 flex-wrap">
          <select
            className="input text-xs py-1.5"
            value={level}
            onChange={e => setLevel(e.target.value)}
          >
            <option value="">All levels</option>
            <option value="info">Info</option>
            <option value="warning">Warning</option>
            <option value="error">Error</option>
            <option value="debug">Debug</option>
          </select>
          <input
            className="input text-xs py-1.5 w-48"
            placeholder="Search…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {!live && (
            <select
              className="input text-xs py-1.5"
              value={lines}
              onChange={e => setLines(Number(e.target.value))}
            >
              <option value={100}>100 lines</option>
              <option value={200}>200 lines</option>
              <option value={500}>500 lines</option>
              <option value={1000}>1000 lines</option>
            </select>
          )}
          {live ? (
            <button onClick={stopLive} className="btn-danger text-xs py-1.5 gap-1.5">
              <Square size={12} /> Stop
            </button>
          ) : (
            <button onClick={startLive} className="btn-success text-xs py-1.5 gap-1.5">
              <Play size={12} /> Live
            </button>
          )}
          <button onClick={downloadLogs} className="btn-ghost text-xs py-1.5">
            <Download size={12} />
          </button>
          {!live && (
            <button onClick={() => refetch()} className="btn-ghost text-xs py-1.5">Refresh</button>
          )}
        </div>
      </div>

      <div className="card flex-1 overflow-y-auto min-h-0 py-2">
        {displayLogs.length === 0 && (
          <p className="text-sm text-gray-500 text-center py-12">No logs{live ? ' yet — waiting for events…' : ''}</p>
        )}
        {displayLogs.map((log, i) => <LogLine key={i} log={log} />)}
        <div ref={bottomRef} />
      </div>

      <div className="flex justify-between text-xs text-gray-600">
        <span>{displayLogs.length} lines{live ? ' (live)' : ''}</span>
        {live && <span className="text-green-500 animate-pulse">● Streaming</span>}
      </div>
    </div>
  )
}
