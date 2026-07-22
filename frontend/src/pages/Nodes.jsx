import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Network, Clock, ChevronDown, ChevronUp, History } from 'lucide-react'
import { nodes as nodesApi } from '../api/client'
import { StatusBadge } from '../components/StatusBadge'

function timeAgo(ts) {
  if (!ts) return 'Never'
  const diff = (Date.now() - new Date(ts).getTime()) / 1000
  if (diff < 60) return `${Math.floor(diff)}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return new Date(ts).toLocaleString()
}

function formatExpiry(dateStr) {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  const days = Math.floor((d - Date.now()) / 86400000)
  const color = days < 30 ? 'text-red-400' : days < 90 ? 'text-yellow-400' : 'text-gray-400'
  return <span className={color}>{d.toLocaleDateString()} ({days}d)</span>
}

function NodeHistory({ name }) {
  const { data, isLoading } = useQuery({
    queryKey: ['node-history', name],
    queryFn: () => nodesApi.history(name).then(r => r.data),
  })

  if (isLoading) return <div className="text-xs text-gray-500 p-3">Loading…</div>

  const history = data?.history ?? []
  if (!history.length) return <div className="text-xs text-gray-500 p-3">No connection history</div>

  return (
    <div className="px-4 pb-3">
      <p className="label mb-2">Connection History</p>
      <div className="space-y-1">
        {history.map((h, i) => (
          <div key={i} className="text-xs text-gray-400 flex gap-4">
            <span className="text-gray-600 w-44 shrink-0">{new Date(h.ts).toLocaleString()}</span>
            <span>{h.vpn_addr}</span>
            <span className="text-gray-600">{h.remote_addr}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function Nodes() {
  const [expanded, setExpanded] = useState(null)
  const [filter, setFilter] = useState('')

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['nodes'],
    queryFn: () => nodesApi.list().then(r => r.data),
    refetchInterval: 30_000,
  })

  const allNodes = data?.nodes ?? []
  const filtered = allNodes.filter(n =>
    n.name?.toLowerCase().includes(filter.toLowerCase()) ||
    n.networks?.some(ip => ip.includes(filter))
  )

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-white">Nodes</h1>
        <div className="flex items-center gap-3">
          <input
            className="input text-sm w-48"
            placeholder="Filter by name or IP…"
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
              <th className="px-4 py-3 label">Name</th>
              <th className="px-4 py-3 label">VPN IP</th>
              <th className="px-4 py-3 label">Groups</th>
              <th className="px-4 py-3 label">Last Seen</th>
              <th className="px-4 py-3 label">Expires</th>
              <th className="px-4 py-3 label">Status</th>
              <th className="px-4 py-3 w-8"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {isLoading && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500 text-sm">Loading…</td></tr>
            )}
            {!isLoading && filtered.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500 text-sm">No nodes found</td></tr>
            )}
            {filtered.map(node => (
              <>
                <tr
                  key={node.name}
                  className="hover:bg-gray-800/40 cursor-pointer"
                  onClick={() => setExpanded(expanded === node.name ? null : node.name)}
                >
                  <td className="px-4 py-3 font-medium text-gray-200">{node.name}</td>
                  <td className="px-4 py-3 font-mono text-xs text-nebula-300">{node.networks?.[0] ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-400 text-xs">{node.groups?.join(', ') || '—'}</td>
                  <td className="px-4 py-3 text-gray-400">{timeAgo(node.last_seen)}</td>
                  <td className="px-4 py-3 text-xs">{formatExpiry(node.not_after)}</td>
                  <td className="px-4 py-3"><StatusBadge active={node.active} /></td>
                  <td className="px-4 py-3 text-gray-600">
                    {expanded === node.name ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </td>
                </tr>
                {expanded === node.name && (
                  <tr key={`${node.name}-detail`} className="bg-gray-900/50">
                    <td colSpan={7}>
                      <div className="px-4 py-3 grid grid-cols-2 gap-4 text-xs text-gray-400">
                        <div>
                          <p className="label mb-1">Fingerprint</p>
                          <p className="font-mono text-gray-500 break-all">{node.fingerprint ?? '—'}</p>
                        </div>
                        <div>
                          <p className="label mb-1">Valid Period</p>
                          <p>{node.not_before ? new Date(node.not_before).toLocaleString() : '—'}</p>
                          <p>{node.not_after ? new Date(node.not_after).toLocaleString() : '—'}</p>
                        </div>
                      </div>
                      <NodeHistory name={node.name} />
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
