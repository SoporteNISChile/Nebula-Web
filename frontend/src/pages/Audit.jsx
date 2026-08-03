import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import api from '../api/client'

function timeAgo(ts) {
  if (!ts) return '—'
  const diff = (Date.now() - new Date(ts + 'Z').getTime()) / 1000
  if (diff < 60) return `${Math.floor(diff)}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return new Date(ts + 'Z').toLocaleString()
}

const ACTION_COLOR = {
  login: 'text-green-400',
  logout: 'text-gray-400',
  cert: 'text-blue-400',
  node: 'text-nebula-300',
  config: 'text-yellow-400',
  service: 'text-orange-400',
  user: 'text-purple-400',
}

function actionColor(action) {
  for (const [key, cls] of Object.entries(ACTION_COLOR)) {
    if (action?.toLowerCase().startsWith(key)) return cls
  }
  return 'text-gray-300'
}

export default function Audit() {
  const [filter, setFilter] = useState('')

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['audit'],
    queryFn: () => api.get('/audit?limit=500').then(r => r.data),
    refetchInterval: 30_000,
  })

  const entries = (data?.entries ?? []).filter(e =>
    !filter ||
    e.actor?.toLowerCase().includes(filter.toLowerCase()) ||
    e.action?.toLowerCase().includes(filter.toLowerCase()) ||
    e.target?.toLowerCase().includes(filter.toLowerCase())
  )

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-white">Audit Log</h1>
        <div className="flex items-center gap-3">
          <input
            className="input text-sm w-48"
            placeholder="Filter…"
            value={filter}
            onChange={e => setFilter(e.target.value)}
          />
          <button onClick={() => refetch()} className="btn-ghost text-xs">Refresh</button>
        </div>
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800 text-left">
              <th className="px-4 py-3 label">Time</th>
              <th className="px-4 py-3 label">Actor</th>
              <th className="px-4 py-3 label">Action</th>
              <th className="px-4 py-3 label">Target</th>
              <th className="px-4 py-3 label">Detail</th>
              <th className="px-4 py-3 label">IP</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {isLoading && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500 text-sm">Loading…</td></tr>
            )}
            {!isLoading && entries.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500 text-sm">No entries</td></tr>
            )}
            {entries.map((e, i) => (
              <tr key={i} className="hover:bg-gray-800/30">
                <td className="px-4 py-2.5 text-gray-500 text-xs whitespace-nowrap" title={e.ts}>{timeAgo(e.ts)}</td>
                <td className="px-4 py-2.5 text-gray-300 font-medium text-xs">{e.actor ?? '—'}</td>
                <td className={`px-4 py-2.5 font-mono text-xs ${actionColor(e.action)}`}>{e.action ?? '—'}</td>
                <td className="px-4 py-2.5 text-gray-400 text-xs">{e.target ?? '—'}</td>
                <td className="px-4 py-2.5 text-gray-500 text-xs max-w-xs truncate">{e.detail ?? ''}</td>
                <td className="px-4 py-2.5 font-mono text-xs text-gray-600">{e.ip ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
