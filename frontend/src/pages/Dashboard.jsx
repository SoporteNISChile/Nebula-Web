import { useQuery } from '@tanstack/react-query'
import { Network, Users, Shield, Activity, Clock, Wifi } from 'lucide-react'
import { nodes as nodesApi, service as serviceApi } from '../api/client'
import { StatCard } from '../components/Card'
import { StatusBadge } from '../components/StatusBadge'

function timeAgo(ts) {
  if (!ts) return 'Never'
  const diff = (Date.now() - new Date(ts).getTime()) / 1000
  if (diff < 60) return `${Math.floor(diff)}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

function certExpiry(dateStr) {
  if (!dateStr) return null
  const d = new Date(dateStr)
  const days = Math.floor((d - Date.now()) / 86400000)
  return days
}

export default function Dashboard() {
  const { data: nodesData } = useQuery({
    queryKey: ['nodes'],
    queryFn: () => nodesApi.list().then(r => r.data),
    refetchInterval: 15_000,
  })
  const { data: svcData } = useQuery({
    queryKey: ['service-status'],
    queryFn: () => serviceApi.status().then(r => r.data),
    refetchInterval: 15_000,
  })

  const allNodes = nodesData?.nodes ?? []
  const activeCount = allNodes.filter(n => n.active).length
  const recentHandshakes = nodesData?.recent_handshakes ?? []
  const running = svcData?.running ?? false

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-white">Dashboard</h1>
        <StatusBadge active={running} label={running ? 'Running' : 'Stopped'} />
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Active Nodes" value={activeCount} sub={`of ${allNodes.length} total`} icon={Wifi} color="text-green-400" />
        <StatCard label="Total Certs" value={allNodes.length} icon={Shield} color="text-nebula-400" />
        <StatCard
          label="Service"
          value={running ? 'Online' : 'Offline'}
          sub={svcData?.memory}
          icon={Activity}
          color={running ? 'text-green-400' : 'text-red-400'}
        />
        <StatCard
          label="Last Event"
          value={recentHandshakes[0] ? timeAgo(recentHandshakes[0].time) : '—'}
          sub={recentHandshakes[0]?.cert_name}
          icon={Clock}
          color="text-yellow-400"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Node status */}
        <div className="lg:col-span-2 card">
          <div className="px-4 pt-4 pb-2 border-b border-gray-800 flex items-center gap-2">
            <Users size={15} className="text-gray-400" />
            <h2 className="text-sm font-medium text-gray-300">Nodes</h2>
          </div>
          <div className="divide-y divide-gray-800">
            {allNodes.length === 0 && (
              <p className="px-4 py-6 text-sm text-gray-500 text-center">No nodes found</p>
            )}
            {allNodes.map(node => (
              <div key={node.name} className="px-4 py-3 flex items-center justify-between">
                <div>
                  <span className="text-sm font-medium text-gray-200">{node.name}</span>
                  <div className="text-xs text-gray-500 mt-0.5">
                    {node.networks?.[0] ?? '—'}
                    {node.groups?.length > 0 && ` · ${node.groups.join(', ')}`}
                  </div>
                </div>
                <div className="text-right flex items-center gap-3">
                  <div className="text-xs text-gray-500">{timeAgo(node.last_seen)}</div>
                  <StatusBadge active={node.active} />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Recent handshakes */}
        <div className="card">
          <div className="px-4 pt-4 pb-2 border-b border-gray-800 flex items-center gap-2">
            <Network size={15} className="text-gray-400" />
            <h2 className="text-sm font-medium text-gray-300">Recent Handshakes</h2>
          </div>
          <div className="divide-y divide-gray-800 max-h-96 overflow-y-auto">
            {recentHandshakes.length === 0 && (
              <p className="px-4 py-6 text-sm text-gray-500 text-center">No recent events</p>
            )}
            {recentHandshakes.map((h, i) => (
              <div key={i} className="px-4 py-2.5">
                <div className="text-sm text-gray-300 font-medium">{h.cert_name}</div>
                <div className="text-xs text-gray-500 mt-0.5 flex justify-between">
                  <span>{h.vpn_addrs?.replace(/[\[\]]/g, '') || '—'}</span>
                  <span>{timeAgo(h.time)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Service details */}
      {svcData && (
        <div className="card p-4">
          <div className="flex items-center gap-2 mb-3">
            <Activity size={15} className="text-gray-400" />
            <h2 className="text-sm font-medium text-gray-300">Service Status</h2>
          </div>
          <div className="font-mono text-xs text-gray-400 whitespace-pre-wrap leading-relaxed">
            {svcData.active}
            {svcData.pid && `\nPID: ${svcData.pid}`}
            {svcData.memory && `  Memory: ${svcData.memory}`}
            {svcData.cpu && `  CPU: ${svcData.cpu}`}
          </div>
        </div>
      )}
    </div>
  )
}
