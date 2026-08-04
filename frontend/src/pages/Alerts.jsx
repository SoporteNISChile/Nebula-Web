import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle, RefreshCw } from 'lucide-react'
import { alerts as alertsApi } from '../api/client'

const EVENT_COLORS = {
  down: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  up:   'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
}

function fmtTs(ts) {
  if (!ts) return '—'
  try {
    return new Date(ts + 'Z').toLocaleString('es-CL', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    })
  } catch {
    return ts
  }
}

export default function Alerts() {
  const [filter, setFilter] = useState('all')

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['alerts'],
    queryFn: () => alertsApi.list({ limit: 300 }).then(r => r.data),
    refetchInterval: 30_000,
  })

  const entries = (data?.entries || []).filter(e => filter === 'all' || e.event === filter)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Alertas</h1>
        <button
          onClick={() => refetch()}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300"
        >
          <RefreshCw className="w-4 h-4" /> Actualizar
        </button>
      </div>

      {/* Filter chips */}
      <div className="flex gap-2">
        {[['all','Todos'], ['down','Caídas'], ['up','Recuperados']].map(([val, label]) => (
          <button
            key={val}
            onClick={() => setFilter(val)}
            className={`px-3 py-1 rounded-full text-sm font-medium transition-colors ${
              filter === val
                ? 'bg-indigo-600 text-white'
                : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl shadow overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-gray-500 dark:text-gray-400">Cargando...</div>
        ) : entries.length === 0 ? (
          <div className="p-8 text-center text-gray-500 dark:text-gray-400">
            Sin alertas registradas.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700 text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  <th className="px-4 py-3 text-left">Evento</th>
                  <th className="px-4 py-3 text-left">Nodo</th>
                  <th className="px-4 py-3 text-left">Grupos</th>
                  <th className="px-4 py-3 text-left">IP</th>
                  <th className="px-4 py-3 text-left">Slack</th>
                  <th className="px-4 py-3 text-left">Fecha</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {entries.map(entry => (
                  <tr key={entry.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold ${EVENT_COLORS[entry.event] || 'bg-gray-100 text-gray-700'}`}>
                        {entry.event === 'down'
                          ? <AlertTriangle className="w-3 h-3" />
                          : <CheckCircle className="w-3 h-3" />
                        }
                        {entry.event === 'down' ? 'Caída' : 'Recuperado'}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">
                      {entry.display_name || entry.cert_name}
                      {entry.display_name && entry.display_name !== entry.cert_name && (
                        <span className="ml-1.5 text-xs text-gray-400">({entry.cert_name})</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                      {(Array.isArray(entry.groups) ? entry.groups : []).join(', ') || '—'}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-600 dark:text-gray-400">
                      {entry.ip || '—'}
                    </td>
                    <td className="px-4 py-3">
                      {entry.slack_sent
                        ? <span className="text-green-600 dark:text-green-400 text-xs">✓ enviado</span>
                        : <span className="text-gray-400 text-xs">—</span>
                      }
                    </td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400 whitespace-nowrap">
                      {fmtTs(entry.ts)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
