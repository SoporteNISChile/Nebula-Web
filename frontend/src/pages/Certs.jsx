import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Download, Shield, ChevronDown, ChevronUp, X, CheckCircle, AlertTriangle } from 'lucide-react'
import { certs as certsApi } from '../api/client'

function formatDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString()
}

function ExpiryText({ dateStr }) {
  if (!dateStr) return <span className="text-gray-500">—</span>
  const days = Math.floor((new Date(dateStr) - Date.now()) / 86400000)
  const cls = days < 30 ? 'text-red-400' : days < 90 ? 'text-yellow-400' : 'text-gray-400'
  return <span className={cls}>{formatDate(dateStr)} ({days}d)</span>
}

function CreateCertModal({ onClose, onCreated }) {
  const [form, setForm] = useState({ name: '', ip: '', groups: '', duration: '' })
  const [error, setError] = useState('')
  const qc = useQueryClient()

  const create = useMutation({
    mutationFn: () => certsApi.create({
      name: form.name,
      ip: form.ip,
      groups: form.groups ? form.groups.split(',').map(g => g.trim()).filter(Boolean) : [],
      duration: form.duration || undefined,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['certs'] })
      onCreated(form.name)
      onClose()
    },
    onError: (err) => setError(err.response?.data?.detail ?? 'Failed to create cert'),
  })

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="card w-full max-w-md p-5">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-white">Create New Certificate</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300"><X size={18} /></button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="label block mb-1">Node Name *</label>
            <input className="input w-full" placeholder="e.g. laptop-office" value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          </div>
          <div>
            <label className="label block mb-1">VPN IP / CIDR *</label>
            <input className="input w-full font-mono" placeholder="e.g. 10.120.1.50/16" value={form.ip}
              onChange={e => setForm(f => ({ ...f, ip: e.target.value }))} />
          </div>
          <div>
            <label className="label block mb-1">Groups (comma-separated)</label>
            <input className="input w-full" placeholder="e.g. servers, vpn-users" value={form.groups}
              onChange={e => setForm(f => ({ ...f, groups: e.target.value }))} />
          </div>
          <div>
            <label className="label block mb-1">Duration (optional)</label>
            <input className="input w-full font-mono" placeholder="e.g. 8760h0m0s (1 year default)" value={form.duration}
              onChange={e => setForm(f => ({ ...f, duration: e.target.value }))} />
          </div>

          {error && (
            <div className="flex items-start gap-2 text-sm text-red-400 bg-red-900/20 border border-red-800 rounded-md px-3 py-2">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              {error}
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <button
              className="btn-primary flex-1 justify-center py-2"
              onClick={() => create.mutate()}
              disabled={!form.name || !form.ip || create.isPending}
            >
              {create.isPending ? 'Creating…' : 'Create Certificate'}
            </button>
            <button className="btn-ghost" onClick={onClose}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function Certs() {
  const [showCreate, setShowCreate] = useState(false)
  const [created, setCreated] = useState(null)
  const [expanded, setExpanded] = useState(null)

  const { data, isLoading } = useQuery({
    queryKey: ['certs'],
    queryFn: () => certsApi.list().then(r => r.data),
  })

  const certs = data?.certs ?? []

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-white">Certificates</h1>
        <button className="btn-primary" onClick={() => setShowCreate(true)}>
          <Plus size={14} /> New Certificate
        </button>
      </div>

      {created && (
        <div className="flex items-center justify-between px-3 py-2 bg-green-900/20 border border-green-800 rounded-md text-sm text-green-400">
          <div className="flex items-center gap-2">
            <CheckCircle size={14} />
            Certificate '{created}' created. Download it from the table below.
          </div>
          <button onClick={() => setCreated(null)} className="text-green-600 hover:text-green-400"><X size={14} /></button>
        </div>
      )}

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800 text-left">
              <th className="px-4 py-3 label">Name</th>
              <th className="px-4 py-3 label">VPN IP</th>
              <th className="px-4 py-3 label">Groups</th>
              <th className="px-4 py-3 label">Issued</th>
              <th className="px-4 py-3 label">Expires</th>
              <th className="px-4 py-3 label">Actions</th>
              <th className="px-4 py-3 w-8"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {isLoading && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500">Loading…</td></tr>
            )}
            {certs.map(cert => (
              <>
                <tr key={cert.name} className="hover:bg-gray-800/40">
                  <td className="px-4 py-3 font-medium text-gray-200 flex items-center gap-2">
                    <Shield size={13} className="text-nebula-400 shrink-0" />
                    {cert.name}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-nebula-300">{cert.networks?.[0] ?? '—'}</td>
                  <td className="px-4 py-3 text-xs text-gray-400">{cert.groups?.join(', ') || '—'}</td>
                  <td className="px-4 py-3 text-xs text-gray-400">{formatDate(cert.not_before)}</td>
                  <td className="px-4 py-3 text-xs"><ExpiryText dateStr={cert.not_after} /></td>
                  <td className="px-4 py-3">
                    <a
                      href={certsApi.downloadUrl(cert.name)}
                      className="btn-ghost text-xs py-1 gap-1.5"
                      download
                    >
                      <Download size={12} /> Download
                    </a>
                  </td>
                  <td className="px-4 py-3 text-gray-600 cursor-pointer" onClick={() => setExpanded(expanded === cert.name ? null : cert.name)}>
                    {expanded === cert.name ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </td>
                </tr>
                {expanded === cert.name && (
                  <tr key={`${cert.name}-detail`} className="bg-gray-900/50">
                    <td colSpan={7} className="px-4 py-3">
                      <div className="grid grid-cols-2 gap-4 text-xs text-gray-400">
                        <div>
                          <p className="label mb-1">Fingerprint</p>
                          <p className="font-mono text-gray-500 break-all">{cert.fingerprint ?? '—'}</p>
                        </div>
                        <div>
                          <p className="label mb-1">Issuer</p>
                          <p className="font-mono text-gray-500 break-all">{cert.issuer ?? '—'}</p>
                        </div>
                        <div>
                          <p className="label mb-1">All Networks</p>
                          <p className="font-mono">{cert.networks?.join(', ') || '—'}</p>
                        </div>
                        <div>
                          <p className="label mb-1">File</p>
                          <p className="font-mono text-gray-500">{cert.filename}</p>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>

      {showCreate && (
        <CreateCertModal
          onClose={() => setShowCreate(false)}
          onCreated={(name) => setCreated(name)}
        />
      )}
    </div>
  )
}
