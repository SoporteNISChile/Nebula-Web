import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ClipboardList, RefreshCw } from 'lucide-react'
import { audit as auditApi } from '../api/client'

const CATEGORIES = [
  { value: '', label: 'All' },
  { value: 'auth', label: 'Auth' },
  { value: 'user', label: 'Users' },
  { value: 'cert', label: 'Certs' },
  { value: 'config', label: 'Config' },
  { value: 'service', label: 'Service' },
  { value: 'cli', label: 'CLI' },
  { value: 'group', label: 'Groups' },
]

const ACTION_COLORS = {
  'auth.login':          'text-green-400',
  'auth.login_failed':   'text-red-400',
  'auth.password_change':'text-yellow-400',
  'auth.setup':          'text-blue-400',
  'user.create':         'text-green-400',
  'user.update':         'text-yellow-400',
  'user.delete':         'text-red-400',
  'cert.create':         'text-green-400',
  'cert.delete':         'text-red-400',
  'cert.revoke':         'text-orange-400',
  'cert.patch':          'text-yellow-400',
  'cert.ca_renew':       'text-purple-400',
  'config.update':       'text-yellow-400',
  'service.start':       'text-green-400',
  'service.stop':        'text-red-400',
  'service.restart':     'text-yellow-400',
  'service.reload':      'text-blue-400',
  'cli.run':             'text-nebula-400',
  'group.create':        'text-green-400',
  'group.update':        'text-yellow-400',
  'group.delete':        'text-red-400',
}

function fmtTs(ts) {
  if (!ts) return '—'
  const d = new Date(ts.endsWith('Z') ? ts : ts + 'Z')
  return d.toLocaleString('es-CL', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  })
}

export default function Audit() {
  const [category, setCategory] = useState('')
  const [actor, setActor] = useState('')

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['audit', category, actor],
    queryFn: () => auditApi.list({ category: category || undefined, actor: actor || undefined, limit: 500 }).then(r => r.data),
    refetchInterval: 30_000,
  })

  const entries = data?.entries ?? []

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ClipboardList size={18} className="text-nebula-400" />
          <h1 className="text-xl font-semibold text-white">Audit Log</h1>
          <span className="text-xs text-gray-500 ml-1">{entries.length} entries</span>
        </div>
        <button onClick={() => refetch()} className="btn-ghost text-xs flex items-center gap-1" disabled={isFetching}>
          <RefreshCw size={12} className={isFetching ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="flex gap-1">
          {CATEGORIES.map(c => (
            <button
              key={c.value}
              onClick={() => setCategory(c.value)}
              className={`px-2.5 py-1 rounded text-xs transition-colors ${
                category === c.value
                  ? 'bg-nebula-700 text-nebula-200'
                  : 'bg-gray-800 text-gray-400 hover:text-gray-200'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
        <input
          type="text"
          placeholder="Filter by user…"
          value={actor}
          onChange={e => setActor(e.target.value)}
          className="input text-xs px-2 py-1 w-36"
        />
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-left">
                <th className="px-4 py-2.5 text-xs text-gray-500 font-medium w-44">Timestamp</th>
                <th className="px-4 py-2.5 text-xs text-gray-500 font-medium w-28">User</th>
                <th className="px-4 py-2.5 text-xs text-gray-500 font-medium w-36">Action</th>
                <th className="px-4 py-2.5 text-xs text-gray-500 font-medium w-32">Target</th>
                <th className="px-4 py-2.5 text-xs text-gray-500 font-medium">Detail</th>
                <th className="px-4 py-2.5 text-xs text-gray-500 font-medium w-28">IP</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/60">
              {isLoading && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500 text-xs">Loading…</td></tr>
              )}
              {!isLoading && entries.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500 text-xs">No entries</td></tr>
              )}
              {entries.map(e => (
                <tr key={e.id} className="hover:bg-gray-800/30 transition-colors">
                  <td className="px-4 py-2 font-mono text-xs text-gray-500">{fmtTs(e.ts)}</td>
                  <td className="px-4 py-2 font-mono text-xs text-gray-300">{e.actor}</td>
                  <td className="px-4 py-2 font-mono text-xs">
                    <span className={ACTION_COLORS[e.action] ?? 'text-gray-400'}>{e.action}</span>
                  </td>
                  <td className="px-4 py-2 font-mono text-xs text-gray-400">{e.target ?? '—'}</td>
                  <td className="px-4 py-2 text-xs text-gray-500 max-w-xs truncate">{e.detail ?? ''}</td>
                  <td className="px-4 py-2 font-mono text-xs text-gray-600">{e.ip ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
