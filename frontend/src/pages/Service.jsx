import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Play, Square, RefreshCw, RotateCcw, AlertTriangle, CheckCircle, Cpu, MemoryStick, HardDrive } from 'lucide-react'
import { service as serviceApi } from '../api/client'
import { StatusBadge } from '../components/StatusBadge'

const THRESHOLD = 85

function Sparkline({ data, color }) {
  if (!data || data.length < 2) return <div className="h-8 w-full bg-gray-800/40 rounded" />
  const W = 160, H = 32, pad = 2
  const min = 0, max = 100
  const pts = data.map((v, i) => {
    const x = pad + (i / (data.length - 1)) * (W - pad * 2)
    const y = H - pad - ((v - min) / (max - min)) * (H - pad * 2)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
  const last = data[data.length - 1]
  const lastX = W - pad
  const lastY = H - pad - ((last - min) / (max - min)) * (H - pad * 2)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-8" preserveAspectRatio="none">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" opacity="0.8" />
      <circle cx={lastX} cy={lastY} r="2.5" fill={color} />
    </svg>
  )
}

function ResourceCard({ label, icon: Icon, value, history, color, warn }) {
  return (
    <div className={`card p-4 ${warn ? 'ring-1 ring-yellow-500/40' : ''}`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Icon size={14} className={warn ? 'text-yellow-400' : 'text-gray-400'} />
          <span className="text-xs text-gray-400">{label}</span>
        </div>
        <div className="flex items-center gap-1.5">
          {warn && <AlertTriangle size={12} className="text-yellow-400" />}
          <span className={`text-lg font-semibold font-mono ${warn ? 'text-yellow-400' : 'text-white'}`}>
            {value != null ? `${value}%` : '—'}
          </span>
        </div>
      </div>
      <Sparkline data={history} color={warn ? '#facc15' : color} />
      <div className="mt-1 h-1 bg-gray-800 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${warn ? 'bg-yellow-500' : 'bg-nebula-500'}`}
          style={{ width: `${Math.min(value ?? 0, 100)}%` }}
        />
      </div>
    </div>
  )
}

export default function Service() {
  const qc = useQueryClient()
  const [actionResult, setActionResult] = useState(null)

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['service-status'],
    queryFn: () => serviceApi.status().then(r => r.data),
    refetchInterval: 10_000,
  })

  const { data: fileData } = useQuery({
    queryKey: ['service-file'],
    queryFn: () => serviceApi.file().then(r => r.data),
  })

  const { data: resData, refetch: refetchRes } = useQuery({
    queryKey: ['service-resources'],
    queryFn: () => serviceApi.resources().then(r => r.data),
    refetchInterval: 10_000,
    retry: false,
  })

  const action = useMutation({
    mutationFn: (act) => serviceApi.action(act),
    onSuccess: (_, act) => {
      setActionResult({ ok: true, msg: `Service ${act} successful` })
      setTimeout(() => {
        refetch()
        qc.invalidateQueries({ queryKey: ['service-status'] })
      }, 1500)
    },
    onError: (err, act) => {
      setActionResult({ ok: false, msg: err.response?.data?.detail ?? `${act} failed` })
    },
  })

  function doAction(act) {
    setActionResult(null)
    const dangerous = act === 'stop'
    if (dangerous && !window.confirm(`Stop the Nebula VPN service? All VPN tunnels will be disconnected.`)) return
    action.mutate(act)
  }

  const running = data?.running ?? false
  const cur = resData?.current ?? {}
  const history = resData?.history ?? []
  const cpuHistory  = history.map(h => h.cpu)
  const ramHistory  = history.map(h => h.ram)
  const diskHistory = history.map(h => h.disk)

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-white">Service</h1>
        <button onClick={() => { refetch(); refetchRes() }} className="btn-ghost text-xs">Refresh</button>
      </div>

      {/* Resource graphs */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <ResourceCard
          label="CPU"
          icon={Cpu}
          value={cur.cpu}
          history={cpuHistory}
          color="#818cf8"
          warn={(cur.cpu ?? 0) >= THRESHOLD}
        />
        <ResourceCard
          label="RAM"
          icon={MemoryStick}
          value={cur.ram}
          history={ramHistory}
          color="#34d399"
          warn={(cur.ram ?? 0) >= THRESHOLD}
        />
        <ResourceCard
          label="Disk"
          icon={HardDrive}
          value={cur.disk}
          history={diskHistory}
          color="#60a5fa"
          warn={(cur.disk ?? 0) >= THRESHOLD}
        />
      </div>

      {/* Status card */}
      <div className="card p-5">
        <div className="flex items-start justify-between mb-4">
          <div>
            <p className="text-sm text-gray-400 mb-1">Service Name</p>
            <p className="font-mono text-nebula-300">{data?.service_name ?? '—'}</p>
          </div>
          {!isLoading && <StatusBadge active={running} label={running ? 'Running' : 'Stopped'} />}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          {[
            ['PID', data?.pid ?? '—'],
            ['Memory', data?.memory ?? '—'],
            ['CPU', data?.cpu ?? '—'],
            ['Status', data?.active?.split('\n')[0] ?? '—'],
          ].map(([k, v]) => (
            <div key={k}>
              <p className="label mb-1">{k}</p>
              <p className="text-gray-300 font-mono text-xs">{v}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Actions */}
      <div className="card p-4">
        <p className="label mb-3">Actions</p>
        <div className="flex flex-wrap gap-2">
          <button
            className="btn-success"
            onClick={() => doAction('start')}
            disabled={running || action.isPending}
          >
            <Play size={14} /> Start
          </button>
          <button
            className="btn-danger"
            onClick={() => doAction('stop')}
            disabled={!running || action.isPending}
          >
            <Square size={14} /> Stop
          </button>
          <button
            className="btn-primary"
            onClick={() => doAction('restart')}
            disabled={action.isPending}
          >
            <RefreshCw size={14} /> Restart
          </button>
          <button
            className="btn-ghost"
            onClick={() => doAction('reload')}
            disabled={!running || action.isPending}
          >
            <RotateCcw size={14} /> Reload
          </button>
        </div>

        {action.isPending && (
          <p className="text-xs text-gray-500 mt-2 animate-pulse">Executing…</p>
        )}

        {actionResult && (
          <div className={`flex items-start gap-2 mt-3 px-3 py-2 rounded-md text-sm border ${
            actionResult.ok
              ? 'bg-green-900/20 text-green-400 border-green-800'
              : 'bg-red-900/20 text-red-400 border-red-800'
          }`}>
            {actionResult.ok
              ? <CheckCircle size={14} className="mt-0.5 shrink-0" />
              : <AlertTriangle size={14} className="mt-0.5 shrink-0" />}
            {actionResult.msg}
          </div>
        )}
      </div>

      {/* Systemd unit file */}
      {fileData?.content && (
        <div className="card p-4">
          <p className="label mb-3">Service Unit File</p>
          <pre className="text-xs font-mono text-gray-400 whitespace-pre-wrap overflow-x-auto leading-relaxed">
            {fileData.content}
          </pre>
        </div>
      )}
    </div>
  )
}
