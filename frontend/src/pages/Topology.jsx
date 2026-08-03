import { useQuery } from '@tanstack/react-query'
import api from '../api/client'

const NODE_W = 164
const NODE_H = 60
const NODE_R = 8
const STAGGER = NODE_H
const BAND_H = STAGGER * 3

const LIGHTHOUSE_Y = 90
const SERVERS_Y = 290
const CLIENTS_Y = 490

// center → top → bottom → center → …
const STAGGER_OFFSETS = [0, -1, 1]

function statusFill(status) {
  if (status === 'active') return '#22c55e'
  if (status === 'disconnected') return '#f59e0b'
  return '#6b7280'
}

function edgeColor(status) {
  if (status === 'active') return 'rgba(99,102,241,0.55)'
  if (status === 'disconnected') return 'rgba(245,158,11,0.25)'
  return 'rgba(100,116,139,0.18)'
}

function NodeCard({ x, y, node }) {
  const left = x - NODE_W / 2
  const top = y - NODE_H / 2
  const isLH = node.isLighthouse
  const bg = isLH ? '#1e1b4b' : '#1e293b'
  const border = isLH ? '#6366f1' : '#334155'

  return (
    <g>
      <rect x={left} y={top} width={NODE_W} height={NODE_H} rx={NODE_R}
        fill={bg} stroke={border} strokeWidth={1.5} />
      <circle cx={left + 13} cy={y} r={4} fill={statusFill(node.status)} />
      <text x={x + 2} y={y - 14} textAnchor="middle" dominantBaseline="middle"
        fill="#e2e8f0" fontSize={12} fontWeight={600}
        fontFamily="ui-sans-serif, system-ui, sans-serif">
        {node.name}
      </text>
      <text x={x + 2} y={y + 2} textAnchor="middle" dominantBaseline="middle"
        fill="#94a3b8" fontSize={10} fontFamily="ui-monospace, monospace">
        {node.vpn_ip || '—'}
      </text>
      <text x={x + 2} y={y + 16} textAnchor="middle" dominantBaseline="middle"
        fill="#64748b" fontSize={9} fontFamily="ui-monospace, monospace">
        {node.public_ip || ''}
      </text>
    </g>
  )
}

function calcLayout(lighthouse, nodes) {
  const servers = nodes.filter(n => n.layer === 'servers')
  const clients = nodes.filter(n => n.layer !== 'servers')

  const maxPerRow = Math.max(lighthouse ? 1 : 0, servers.length, clients.length, 1)
  const CANVAS_W = Math.max(700, (maxPerRow + 1) * (NODE_W + 28))

  const positions = {}

  if (lighthouse) {
    positions[lighthouse.name] = { x: CANVAS_W / 2, y: LIGHTHOUSE_Y }
  }

  servers.forEach((n, i) => {
    const x = (CANVAS_W / (servers.length + 1)) * (i + 1)
    positions[n.name] = { x, y: SERVERS_Y + STAGGER_OFFSETS[i % 3] * STAGGER }
  })

  clients.forEach((n, i) => {
    const x = (CANVAS_W / (clients.length + 1)) * (i + 1)
    positions[n.name] = { x, y: CLIENTS_Y }
  })

  const hasClients = clients.length > 0
  const hasServers = servers.length > 0
  const lastY = hasClients ? CLIENTS_Y : hasServers ? SERVERS_Y + STAGGER : LIGHTHOUSE_Y
  const CANVAS_H = lastY + NODE_H / 2 + 60

  return { positions, CANVAS_W, CANVAS_H, servers, clients }
}

export default function Topology() {
  const { data, isLoading } = useQuery({
    queryKey: ['topology'],
    queryFn: () => api.get('/topology').then(r => r.data),
    refetchInterval: 30_000,
  })

  if (isLoading) return <div className="p-6 text-sm text-gray-500">Loading…</div>

  const lighthouse = data?.lighthouse ? { ...data.lighthouse, isLighthouse: true } : null
  const nodes = (data?.nodes ?? []).map(n => ({ ...n, isLighthouse: false }))
  const allNodes = lighthouse ? [lighthouse, ...nodes] : nodes

  const { positions, CANVAS_W, CANVAS_H, servers, clients } = calcLayout(lighthouse, nodes)
  const lhPos = lighthouse ? positions[lighthouse.name] : null

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-white">Topology</h1>
        <div className="flex items-center gap-4 text-xs text-gray-500">
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-green-500 inline-block" /> Active</span>
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-yellow-500 inline-block" /> Disconnected</span>
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-gray-500 inline-block" /> Offline</span>
        </div>
      </div>

      <div className="card overflow-x-auto">
        <svg width="100%" viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`}
          style={{ background: '#0f172a', display: 'block', minHeight: 280 }}>

          {lighthouse && (
            <text x={12} y={LIGHTHOUSE_Y} dominantBaseline="middle"
              fill="#374151" fontSize={9} letterSpacing={1} fontFamily="ui-sans-serif, sans-serif">LIGHTHOUSE</text>
          )}
          {servers.length > 0 && (
            <text x={12} y={SERVERS_Y} dominantBaseline="middle"
              fill="#374151" fontSize={9} letterSpacing={1} fontFamily="ui-sans-serif, sans-serif">SERVERS</text>
          )}
          {clients.length > 0 && (
            <text x={12} y={CLIENTS_Y} dominantBaseline="middle"
              fill="#374151" fontSize={9} letterSpacing={1} fontFamily="ui-sans-serif, sans-serif">CLIENTS</text>
          )}

          {/* Servers virtual box — 3× node height */}
          {servers.length > 0 && (
            <rect x={0} y={SERVERS_Y - BAND_H / 2} width={CANVAS_W} height={BAND_H}
              fill="rgba(99,102,241,0.025)" stroke="rgba(99,102,241,0.12)"
              strokeWidth={1} strokeDasharray="5 5" />
          )}

          {/* Edges */}
          {lhPos && nodes.map(node => {
            const pos = positions[node.name]
            if (!pos) return null
            return (
              <line key={`edge-${node.name}`}
                x1={pos.x} y1={pos.y} x2={lhPos.x} y2={lhPos.y}
                stroke={edgeColor(node.status)}
                strokeWidth={node.status === 'active' ? 1.5 : 1} />
            )
          })}

          {/* Node cards */}
          {allNodes.map(node => {
            const pos = positions[node.name]
            if (!pos) return null
            return <NodeCard key={node.name} x={pos.x} y={pos.y} node={node} />
          })}
        </svg>
      </div>
    </div>
  )
}
