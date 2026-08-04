import { useState, useRef, useEffect, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { RefreshCw, ZoomIn, ZoomOut, Maximize2, LayoutGrid, X, Wifi } from 'lucide-react'
import { nodes as nodesApi } from '../api/client'

const NODE_R_HUB  = 26
const NODE_R_LEAF = 18
const H_GAP       = 240
const V_GAP       = 220
const LH_Y        = 110
const MAX_LABEL   = 16

function trunc(s, max = MAX_LABEL) {
  if (!s) return ''
  return s.length > max ? s.slice(0, max - 1) + '…' : s
}

function isLighthouse(node) {
  if ((node.groups ?? []).includes('lighthouse')) return true
  if (node.name?.toLowerCase().includes('lighthouse')) return true
  const parts = (node.networks?.[0]?.split('/')[0] ?? '').split('.')
  return parts.length === 4 && parts[2] === '0' && parts[3] === '1'
}

function timeAgo(ts) {
  if (!ts) return 'nunca conectado'
  const s = (Date.now() - new Date(ts + (ts.endsWith('Z') ? '' : 'Z')).getTime()) / 1000
  if (s < 60)    return `${Math.floor(s)}s`
  if (s < 3600)  return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

function centerRow(nodes, cx, y) {
  const total = (nodes.length - 1) * H_GAP
  return nodes.map((n, i) => ({
    ...n,
    x: nodes.length === 1 ? cx : cx - total / 2 + i * H_GAP,
    y,
    isHub: isLighthouse(n),
  }))
}

function computeLayout(nodes) {
  if (nodes.length === 0) return { positioned: [], edges: [], W: 640, H: 400, layerBands: [] }

  const lhNodes  = nodes.filter(isLighthouse)
  const soporte  = nodes.filter(n =>
    !isLighthouse(n) && (n.groups ?? []).includes('soporte')
  )
  const sCentral = nodes.filter(n =>
    !isLighthouse(n) &&
    (n.groups ?? []).includes('servidores-central') &&
    !(n.groups ?? []).includes('soporte')
  )
  const bottom = nodes.filter(n =>
    !isLighthouse(n) &&
    !soporte.some(s => s.name === n.name) &&
    !sCentral.some(s => s.name === n.name)
  )

  const leftCount  = Math.floor(sCentral.length / 2)
  const rightCount = Math.ceil(sCentral.length / 2)

  // Canvas width: widest layer determines cx
  const halfW = (n) => n > 1 ? ((n - 1) / 2) * H_GAP : 0
  const midHalf = Math.max(leftCount, rightCount) * H_GAP
  const W = Math.max(680, (Math.max(midHalf, halfW(soporte.length), halfW(bottom.length)) + 160) * 2)
  const cx = W / 2

  // Layers — skip empty soporte/bottom
  const layerDefs = []
  if (soporte.length > 0)  layerDefs.push({ key: 'soporte',    label: 'Soporte' })
                           layerDefs.push({ key: 'middle',     label: 'Servidores Central' })
  if (bottom.length > 0)   layerDefs.push({ key: 'servidores', label: 'Servidores' })

  const layerY = {}
  layerDefs.forEach(({ key }, i) => { layerY[key] = LH_Y + i * V_GAP })

  const positioned = []

  // Layer 1: soporte — centered row
  if (soporte.length > 0) {
    centerRow(soporte, cx, layerY['soporte']).forEach(n => positioned.push({ ...n, isHub: false }))
  }

  // Layer 2: sCentral-left  LH  sCentral-right
  const midY = layerY['middle']
  sCentral.slice(0, leftCount).forEach((n, i) => {
    positioned.push({ ...n, x: cx - (leftCount - i) * H_GAP, y: midY, isHub: false })
  })
  lhNodes.forEach((lh, i) => {
    const x = lhNodes.length === 1 ? cx : cx + (i - (lhNodes.length - 1) / 2) * H_GAP
    positioned.push({ ...lh, x, y: midY, isHub: true })
  })
  sCentral.slice(leftCount).forEach((n, i) => {
    positioned.push({ ...n, x: cx + (i + 1) * H_GAP, y: midY, isHub: false })
  })

  // Layer 3: servidores + ungrouped — centered row
  if (bottom.length > 0) {
    centerRow(bottom, cx, layerY['servidores']).forEach(n => positioned.push({ ...n, isHub: false }))
  }

  const H = LH_Y + (layerDefs.length - 1) * V_GAP + 200

  const hubs   = positioned.filter(n => n.isHub)
  const leaves = positioned.filter(n => !n.isHub)
  const edges  = leaves.flatMap(cl => hubs.map(lh => ({ from: cl.name, to: lh.name })))

  const layerBands = layerDefs.map(({ key, label }) => ({ label, y: layerY[key] }))

  return { positioned, edges, W, H, layerBands }
}

function screenToContent(mx, my, t) {
  return { x: (mx - t.tx) / t.scale, y: (my - t.ty) / t.scale }
}

function NodePanel({ node, onClose }) {
  const [pingLines, setPingLines] = useState([])
  const [pinging,   setPinging]   = useState(false)
  const esRef = useRef(null)

  const startPing = () => {
    if (pinging) return
    setPingLines([])
    setPinging(true)
    const token = localStorage.getItem('nebula_token')
    const url = `/api/nodes/${node.name}/ping/stream?count=5${token ? `&token=${encodeURIComponent(token)}` : ''}`
    const es = new EventSource(url)
    esRef.current = es
    es.onmessage = (e) => {
      if (e.data.startsWith('__done__')) {
        setPinging(false)
        es.close()
        return
      }
      setPingLines(prev => [...prev, e.data])
    }
    es.onerror = () => { setPinging(false); es.close() }
  }

  useEffect(() => () => esRef.current?.close(), [])

  const ip = node.networks?.[0]?.split('/')[0] ?? '—'
  const disc = node.disconnected

  return (
    <div className="absolute bottom-4 left-4 z-20 w-72 card shadow-xl text-xs" onClick={e => e.stopPropagation()}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-gray-700">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${disc ? 'bg-red-500' : 'bg-green-500'}`} />
          <span className="font-semibold text-gray-100 truncate">{node.display_name ?? node.name}</span>
        </div>
        <button onClick={onClose} className="text-gray-500 hover:text-gray-300 ml-2 flex-shrink-0"><X size={13} /></button>
      </div>

      {/* Details */}
      <div className="px-3 py-2 space-y-1 border-b border-gray-700">
        {node.display_name && node.display_name !== node.name && (
          <div className="flex gap-2"><span className="text-gray-500 w-16">cert</span><span className="font-mono text-gray-300">{node.name}</span></div>
        )}
        <div className="flex gap-2"><span className="text-gray-500 w-16">IP</span><span className="font-mono text-gray-300">{ip}</span></div>
        {(node.groups ?? []).length > 0 && (
          <div className="flex gap-2"><span className="text-gray-500 w-16">grupos</span><span className="text-gray-300">{node.groups.join(', ')}</span></div>
        )}
        <div className="flex gap-2">
          <span className="text-gray-500 w-16">estado</span>
          <span className={disc ? 'text-red-400' : 'text-green-400'}>
            {disc ? `offline · ${node.last_seen ? `hace ${timeAgo(node.last_seen)}` : 'nunca'}` : `activo · ${timeAgo(node.last_seen)}`}
          </span>
        </div>
        {node.not_after && (
          <div className="flex gap-2"><span className="text-gray-500 w-16">cert exp</span><span className="text-gray-400">{new Date(node.not_after).toLocaleDateString('es-CL')}</span></div>
        )}
      </div>

      {/* Ping */}
      <div className="px-3 py-2">
        <button
          onClick={startPing}
          disabled={pinging}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium bg-indigo-700 hover:bg-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed text-white transition-colors"
        >
          <Wifi size={11} className={pinging ? 'animate-pulse' : ''} />
          {pinging ? 'Pingueando…' : 'Ping'}
        </button>
        {pingLines.length > 0 && (
          <div className="mt-2 font-mono text-gray-300 space-y-0.5 max-h-32 overflow-y-auto">
            {pingLines.map((l, i) => (
              <div key={i} className={l.includes('time=') ? 'text-green-400' : l.includes('unreachable') || l.includes('100%') ? 'text-red-400' : 'text-gray-400'}>{l}</div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default function Topology() {
  const [hovered,   setHovered]   = useState(null)
  const [selected,  setSelected]  = useState(null)
  const [transform, setTransform] = useState({ scale: 1, tx: 0, ty: 0 })
  const [panDrag,   setPanDrag]   = useState(null)
  const [nodeDrag,  setNodeDrag]  = useState(null)
  const [dragMoved, setDragMoved] = useState(false)
  const [overrides, setOverrides] = useState({})
  const svgRef = useRef(null)

  const { data: nodesData, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['nodes'],
    queryFn: () => nodesApi.list().then(r => r.data),
    refetchInterval: 15_000,
  })

  const allNodes = nodesData?.nodes ?? []

  // ALL nodes in topology — active=green, disconnected/offline=red dashed
  const topoNodes = allNodes.map(n => ({
    ...n,
    disconnected: n.status !== 'active',
  }))

  const { positioned: base, edges, W, H, layerBands } = computeLayout(topoNodes)

  // Apply in-memory drag overrides on top of computed positions
  const positioned = base.map(n => ({
    ...n,
    x: overrides[n.name]?.x ?? n.x,
    y: overrides[n.name]?.y ?? n.y,
  }))
  const nodeMap = Object.fromEntries(positioned.map(n => [n.name, n]))

  const fit = useCallback(() => {
    const el = svgRef.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    const s = Math.min(width / W, height / H, 1)
    setTransform({ scale: s, tx: (width - W * s) / 2, ty: (height - H * s) / 2 })
  }, [W, H])

  useEffect(() => { if (topoNodes.length > 0) fit() }, [topoNodes.length, fit])

  const onWheel = useCallback((e) => {
    e.preventDefault()
    const el = svgRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15
    setTransform(({ scale, tx, ty }) => {
      const s = Math.max(0.1, Math.min(8, scale * factor))
      return { scale: s, tx: mx - (mx - tx) * (s / scale), ty: my - (my - ty) * (s / scale) }
    })
  }, [])

  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [onWheel])

  const onSvgMouseDown = (e) => {
    if (e.button !== 0 || nodeDrag) return
    setSelected(null)
    setPanDrag({ sx: e.clientX - transform.tx, sy: e.clientY - transform.ty })
  }

  const onNodeMouseDown = (e, node) => {
    e.stopPropagation()
    if (e.button !== 0) return
    const el = svgRef.current
    const rect = el.getBoundingClientRect()
    const { x: cx, y: cy } = screenToContent(e.clientX - rect.left, e.clientY - rect.top, transform)
    setNodeDrag({ name: node.name, offX: node.x - cx, offY: node.y - cy, startX: e.clientX, startY: e.clientY, node })
    setDragMoved(false)
    setHovered(null)
  }

  const onMouseMove = (e) => {
    const el = svgRef.current
    const rect = el.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top

    if (nodeDrag) {
      const dx = e.clientX - nodeDrag.startX
      const dy = e.clientY - nodeDrag.startY
      if (!dragMoved && Math.sqrt(dx * dx + dy * dy) > 4) setDragMoved(true)
      const { x: cx, y: cy } = screenToContent(mx, my, transform)
      setOverrides(prev => ({ ...prev, [nodeDrag.name]: { x: cx + nodeDrag.offX, y: cy + nodeDrag.offY } }))
      return
    }
    if (panDrag) {
      setTransform(t => ({ ...t, tx: e.clientX - panDrag.sx, ty: e.clientY - panDrag.sy }))
    }
  }

  const onMouseUp = (e) => {
    if (nodeDrag && !dragMoved) {
      // Click (not drag) → open panel
      setSelected(nodeDrag.node)
    }
    setPanDrag(null)
    setNodeDrag(null)
    setDragMoved(false)
  }

  const resetLayout = () => setOverrides({})

  const zoom = (dir) => setTransform(t => ({
    ...t, scale: Math.max(0.1, Math.min(8, t.scale * (dir > 0 ? 1.25 : 0.8)))
  }))

  // Group legend
  const groupLegend = {}
  for (const n of topoNodes) {
    if (n.group_color) {
      for (const g of (n.groups ?? [])) {
        if (!groupLegend[g]) groupLegend[g] = n.group_color
      }
    }
  }

  const activeCount = topoNodes.filter(n => !n.disconnected).length
  const offlineCount = topoNodes.filter(n => n.disconnected).length

  return (
    <div className="p-6 space-y-4" style={{ height: 'calc(100vh - 64px)' }}>
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-white">Topology</h1>
        <div className="flex items-center gap-3">
          {Object.keys(groupLegend).length > 0 && (
            <div className="flex items-center gap-3 text-xs text-gray-400">
              {Object.entries(groupLegend).map(([g, color]) => (
                <span key={g} className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
                  {g}
                </span>
              ))}
            </div>
          )}

          <div className="flex items-center gap-1">
            <button onClick={() => zoom(1)}   className="btn-ghost p-1.5" title="Zoom in"><ZoomIn    size={14} /></button>
            <button onClick={() => zoom(-1)}  className="btn-ghost p-1.5" title="Zoom out"><ZoomOut  size={14} /></button>
            <button onClick={fit}             className="btn-ghost p-1.5" title="Fit"><Maximize2     size={14} /></button>
            <button onClick={resetLayout}     className="btn-ghost p-1.5" title="Reordenar"><LayoutGrid size={14} /></button>
          </div>

          <button onClick={() => refetch()} className="btn-ghost p-1.5" disabled={isFetching} title="Refresh">
            <RefreshCw size={14} className={isFetching ? 'animate-spin text-nebula-400' : 'text-gray-400'} />
          </button>
        </div>
      </div>

      <div className="card overflow-hidden relative" style={{ height: 'calc(100% - 56px)' }}>
        {isLoading ? (
          <div className="flex items-center justify-center h-full text-gray-500 text-sm">Loading...</div>
        ) : topoNodes.length === 0 ? (
          <div className="flex items-center justify-center h-full text-gray-500 text-sm">No hay nodos configurados</div>
        ) : (
          <svg
            ref={svgRef}
            width="100%" height="100%"
            style={{ cursor: nodeDrag || panDrag ? 'grabbing' : 'grab', display: 'block' }}
            onMouseDown={onSvgMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
            onMouseLeave={onMouseUp}
          >
            <defs>
              <style>{`
                @keyframes npulse {
                  0%   { r: 24; opacity: 0.5; }
                  100% { r: 46; opacity: 0;   }
                }
                .npulse { animation: npulse 2.4s ease-out infinite; }
              `}</style>
              <pattern id="topo-grid" width="36" height="36" patternUnits="userSpaceOnUse"
                patternTransform={`translate(${transform.tx % 36},${transform.ty % 36})`}>
                <path d="M 36 0 L 0 0 0 36" fill="none" stroke="#1f2937" strokeWidth="0.8" />
              </pattern>
            </defs>

            <rect width="100%" height="100%" fill="url(#topo-grid)" />

            <g transform={`translate(${transform.tx},${transform.ty}) scale(${transform.scale})`}>
              {/* Layer band labels */}
              {layerBands.map(band => (
                <text key={band.label} x={20} y={band.y + 5}
                  fill="#374151" fontSize={10} fontFamily="ui-monospace, monospace"
                  style={{ userSelect: 'none', pointerEvents: 'none' }}>
                  {band.label}
                </text>
              ))}

              {/* Horizontal alignment guide lines (subtle) */}
              {layerBands.map(band => (
                <line key={'guide-' + band.label}
                  x1={0} y1={band.y} x2={W} y2={band.y}
                  stroke="#1f2937" strokeWidth={0.5} strokeDasharray="4 8"
                  style={{ pointerEvents: 'none' }}
                />
              ))}

              {/* Edges */}
              {edges.map((e, i) => {
                const f = nodeMap[e.from]
                const t = nodeMap[e.to]
                if (!f || !t) return null
                const disc = f.disconnected
                return (
                  <line key={i}
                    x1={f.x} y1={f.y} x2={t.x} y2={t.y}
                    stroke={disc ? '#ef4444' : '#16a34a'}
                    strokeWidth={1.5}
                    strokeOpacity={disc ? 0.7 : 0.45}
                    strokeDasharray={disc ? '8 5' : undefined}
                  />
                )
              })}

              {/* Nodes */}
              {positioned.map(node => {
                const r    = node.isHub ? NODE_R_HUB : NODE_R_LEAF
                const pad  = 9
                const disc = node.disconnected
                const fill   = disc ? '#374151' : '#22c55e'
                const stroke = disc ? '#6b7280' : '#16a34a'
                return (
                  <g key={node.name}
                    transform={`translate(${node.x},${node.y})`}
                    style={{ cursor: nodeDrag?.name === node.name ? 'grabbing' : 'grab', opacity: disc ? 0.72 : 1 }}
                    onMouseDown={(e) => onNodeMouseDown(e, node)}
                    onMouseEnter={() => { if (!nodeDrag) setHovered(node) }}
                    onMouseLeave={() => setHovered(null)}
                  >
                    {/* Group color frame */}
                    {node.group_color && (
                      <rect
                        x={-(r + pad)} y={-(r + pad)}
                        width={(r + pad) * 2} height={(r + pad) * 2}
                        rx={8} ry={8}
                        fill="none"
                        stroke={disc ? '#4b5563' : node.group_color}
                        strokeWidth={1.5}
                        strokeDasharray="5 3"
                        strokeOpacity={0.75}
                      />
                    )}
                    {/* Active pulse ring */}
                    {!disc && (
                      <circle className="npulse" cx={0} cy={0} r={r}
                        fill="none" stroke="#22c55e" strokeWidth={1.5} />
                    )}
                    {/* Node circle */}
                    <circle cx={0} cy={0} r={r} fill={fill} stroke={stroke} strokeWidth={2.5} />
                    {/* Lighthouse triangle marker */}
                    {node.isHub && (
                      <polygon points="0,-9 8,7 -8,7" fill="rgba(255,255,255,0.28)" />
                    )}
                    {/* Label */}
                    <text y={r + 16} textAnchor="middle"
                      fill={disc ? '#9ca3af' : '#e5e7eb'}
                      fontSize={11} fontWeight={node.isHub ? '600' : '400'}
                      fontFamily="ui-monospace, monospace"
                      style={{ userSelect: 'none', pointerEvents: 'none' }}>
                      {trunc(node.display_name ?? node.name)}
                    </text>
                    {/* IP */}
                    <text y={r + 29} textAnchor="middle" fill="#6b7280"
                      fontSize={9.5} fontFamily="ui-monospace, monospace"
                      style={{ userSelect: 'none', pointerEvents: 'none' }}>
                      {node.networks?.[0]?.split('/')[0] ?? ''}
                    </text>
                  </g>
                )
              })}
            </g>
          </svg>
        )}

        {/* Legend */}
        <div className="absolute top-3 right-3 card px-3 py-2 text-xs space-y-1.5 pointer-events-none z-10">
          <div className="flex items-center gap-2">
            <svg width="28" height="8"><line x1="0" y1="4" x2="28" y2="4" stroke="#16a34a" strokeWidth="1.5" strokeOpacity="0.7"/></svg>
            <span className="text-gray-400">túnel activo</span>
          </div>
          <div className="flex items-center gap-2">
            <svg width="28" height="8"><line x1="0" y1="4" x2="28" y2="4" stroke="#ef4444" strokeWidth="1.5" strokeDasharray="4 3"/></svg>
            <span className="text-gray-400">nodo offline</span>
          </div>
        </div>

        {/* Node detail panel */}
        {selected && (
          <NodePanel
            node={{ ...selected, ...topoNodes.find(n => n.name === selected.name) }}
            onClose={() => setSelected(null)}
          />
        )}

        {/* Hover tooltip — hidden when panel open */}
        {hovered && !selected && (
          <div className="absolute bottom-4 left-4 card px-3 py-2.5 text-xs space-y-1 pointer-events-none shadow-lg z-10 min-w-[160px]">
            <div className="flex items-center gap-2">
              <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${hovered.disconnected ? 'bg-red-500' : 'bg-green-500'}`} />
              <span className="font-semibold text-gray-100 truncate">
                {hovered.display_name ?? hovered.name}
              </span>
            </div>
            {hovered.display_name && hovered.display_name !== hovered.name && (
              <div className="text-gray-500 font-mono truncate">{hovered.name}</div>
            )}
            <div className="text-gray-400 font-mono">{hovered.networks?.[0] ?? '—'}</div>
            {(hovered.groups ?? []).length > 0 && (
              <div className="text-gray-500">{hovered.groups.join(', ')}</div>
            )}
            {hovered.disconnected ? (
              <div className="text-red-400">
                offline · {hovered.last_seen ? `hace ${timeAgo(hovered.last_seen)}` : 'nunca conectado'}
              </div>
            ) : (
              <div className="text-green-400">activo · {timeAgo(hovered.last_seen)}</div>
            )}
          </div>
        )}

        <div className="absolute bottom-4 right-4 text-xs text-gray-600 font-mono pointer-events-none">
          {Math.round(transform.scale * 100)}%
        </div>
      </div>

      <p className="text-xs text-gray-600">
        {activeCount} activos · {offlineCount} offline · {allNodes.length} total
      </p>
    </div>
  )
}
