import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Play, Square, RefreshCw, RotateCcw, AlertTriangle, CheckCircle } from 'lucide-react'
import { service as serviceApi } from '../api/client'
import { StatusBadge } from '../components/StatusBadge'

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

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-white">Service</h1>
        <button onClick={() => refetch()} className="btn-ghost text-xs">Refresh</button>
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
