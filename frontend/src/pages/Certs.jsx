import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Plus, Download, Shield, ChevronDown, ChevronUp, X,
  CheckCircle, AlertTriangle, Terminal, Apple, MonitorDot, Trash2, Pencil, Check,
} from 'lucide-react'
import { certs as certsApi } from '../api/client'

function nextAvailableIp(certs) {
  const toInt = ip => ip.split('.').reduce((acc, o) => ((acc << 8) + parseInt(o, 10)) >>> 0, 0)
  const toIp  = n  => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.')

  let cidr = '/16'
  const usedInts = []
  for (const cert of certs) {
    const net = cert.networks?.[0]
    if (!net) continue
    const [ip, prefix] = net.split('/')
    cidr = `/${prefix}`
    usedInts.push(toInt(ip))
  }
  if (!usedInts.length) return ''

  usedInts.sort((a, b) => a - b)
  const usedSet = new Set(usedInts)
  let next = usedInts[usedInts.length - 1] + 1
  while (usedSet.has(next)) next++
  return `${toIp(next)}${cidr}`
}

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

function BundleButtons({ name, compact = false }) {
  const platforms = [
    { key: 'linux',   label: 'Linux',   icon: Terminal, cls: 'text-orange-400 hover:text-orange-300' },
    { key: 'mac',     label: 'macOS',   icon: Apple,    cls: 'text-blue-400   hover:text-blue-300'   },
    { key: 'windows', label: 'Windows', icon: MonitorDot, cls: 'text-sky-400  hover:text-sky-300'   },
  ]
  return (
    <div className={`flex items-center gap-1.5 ${compact ? '' : 'flex-wrap gap-2'}`}>
      {platforms.map(({ key, label, icon: Icon, cls }) => (
        <a
          key={key}
          href={certsApi.bundleUrl(name, key)}
          download={`${name}-nebula-${key}.zip`}
          title={`Download ${label} install bundle`}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium
            bg-gray-800 border border-gray-700 hover:border-gray-600 transition-colors ${cls}`}
        >
          <Icon size={12} />
          {compact ? '' : label}
          <Download size={10} className="opacity-60" />
        </a>
      ))}
    </div>
  )
}

function DuplicateAlert({ ips }) {
  if (!ips?.length) return null
  return (
    <span
      title={`Cert used from multiple IPs: ${ips.join(', ')}`}
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium
        bg-red-900/40 border border-red-700/60 text-red-400 cursor-help"
    >
      <AlertTriangle size={10} />
      Duplicate ({ips.length} IPs)
    </span>
  )
}

function CreateCertModal({ onClose, onCreated, suggestedIp }) {
  const [form, setForm] = useState({ name: '', ip: '', groups: '', duration: '' })
  const [error, setError] = useState('')
  const qc = useQueryClient()

  const { data: caData } = useQuery({
    queryKey: ['certs-ca'],
    queryFn: () => certsApi.ca().then(r => r.data),
  })

  // Compute max safe duration from CA expiry
  const caExpiry = caData?.ca?.details?.notAfter
  const maxDurationHours = caExpiry
    ? Math.max(0, Math.floor((new Date(caExpiry) - Date.now()) / 3_600_000) - 1)
    : null
  const maxDurationLabel = maxDurationHours != null
    ? `${maxDurationHours}h (until CA expires ${new Date(caExpiry).toLocaleDateString()})`
    : null

  useEffect(() => {
    if (suggestedIp && !form.ip) setForm(f => ({ ...f, ip: suggestedIp }))
  }, [suggestedIp])

  useEffect(() => {
    if (maxDurationHours != null && !form.duration) {
      setForm(f => ({ ...f, duration: `${maxDurationHours}h` }))
    }
  }, [maxDurationHours])

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
            <div className="flex items-center justify-between mb-1">
              <label className="label">Duration</label>
              {maxDurationLabel && (
                <span className="text-xs text-gray-500">max: {maxDurationLabel}</span>
              )}
            </div>
            <input className="input w-full font-mono" placeholder="e.g. 8760h (1 year)" value={form.duration}
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

function DisplayNameCell({ cert }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(cert.display_name ?? '')
  const qc = useQueryClient()

  const save = useMutation({
    mutationFn: () => certsApi.patch(cert.name, { display_name: value.trim() || null }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['certs'] }); setEditing(false) },
  })

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <input
          autoFocus
          className="input py-0.5 px-1.5 text-xs w-36"
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') save.mutate(); if (e.key === 'Escape') setEditing(false) }}
        />
        <button onClick={() => save.mutate()} disabled={save.isPending}
          className="text-green-400 hover:text-green-300"><Check size={13} /></button>
        <button onClick={() => { setEditing(false); setValue(cert.display_name ?? '') }}
          className="text-gray-500 hover:text-gray-300"><X size={12} /></button>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-1.5 group/dn">
      <div className="flex items-center gap-2">
        <Shield size={13} className="text-nebula-400 shrink-0" />
        <div>
          {cert.display_name ? (
            <>
              <span className="font-medium text-gray-200">{cert.display_name}</span>
              <span className="ml-1.5 text-xs text-gray-500">({cert.name})</span>
            </>
          ) : (
            <span className="font-medium text-gray-200">{cert.name}</span>
          )}
        </div>
      </div>
      <button
        onClick={() => setEditing(true)}
        className="opacity-0 group-hover/dn:opacity-100 text-gray-600 hover:text-gray-300 transition-opacity"
        title="Edit display name"
      >
        <Pencil size={11} />
      </button>
    </div>
  )
}

export default function Certs() {
  const [showCreate, setShowCreate] = useState(false)
  const [created, setCreated] = useState(null)
  const [expanded, setExpanded] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(null) // cert name pending delete
  const qc = useQueryClient()

  const deleteMutation = useMutation({
    mutationFn: (name) => certsApi.delete(name),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['certs'] })
      setConfirmDelete(null)
      setExpanded(null)
    },
  })

  const { data, isLoading } = useQuery({
    queryKey: ['certs'],
    queryFn: () => certsApi.list().then(r => r.data),
    refetchInterval: 30_000,
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

      {/* Post-creation install panel */}
      {created && (
        <div className="card border-green-800 bg-green-900/10 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm text-green-400 font-medium">
              <CheckCircle size={15} />
              Certificate '{created}' created — download the install bundle for your OS:
            </div>
            <button onClick={() => setCreated(null)} className="text-green-700 hover:text-green-400">
              <X size={14} />
            </button>
          </div>
          <BundleButtons name={created} />
          <p className="text-xs text-gray-500">
            Each bundle includes the cert, key, CA, pre-configured nebula config, and an install script.
            Extract and run <code className="text-gray-400">install.sh</code> (or <code className="text-gray-400">install.ps1</code>) as admin.
          </p>
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
              <th className="px-4 py-3 label">Install</th>
              <th className="px-4 py-3 w-8"></th>
              <th className="px-4 py-3 w-8"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {isLoading && (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-500">Loading…</td></tr>
            )}
            {certs.map(cert => (
              <>
                <tr key={cert.name} className="hover:bg-gray-800/40">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      {cert.group_color && (
                        <span className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: cert.group_color }} />
                      )}
                      <DisplayNameCell cert={cert} />
                      {cert.duplicate_alert && (
                        <DuplicateAlert ips={cert.duplicate_alert} />
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-nebula-300">{cert.networks?.[0] ?? '—'}</td>
                  <td className="px-4 py-3 text-xs text-gray-400">{cert.groups?.join(', ') || '—'}</td>
                  <td className="px-4 py-3 text-xs text-gray-400">{formatDate(cert.not_before)}</td>
                  <td className="px-4 py-3 text-xs"><ExpiryText dateStr={cert.not_after} /></td>
                  <td className="px-4 py-3">
                    <BundleButtons name={cert.name} compact />
                  </td>
                  <td className="px-4 py-3 text-gray-600 cursor-pointer"
                    onClick={() => setExpanded(expanded === cert.name ? null : cert.name)}>
                    {expanded === cert.name ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </td>
                  <td className="px-4 py-3">
                    {confirmDelete === cert.name ? (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => deleteMutation.mutate(cert.name)}
                          disabled={deleteMutation.isPending}
                          className="btn text-xs py-0.5 px-2 bg-red-700 hover:bg-red-600 text-white rounded"
                        >
                          {deleteMutation.isPending ? '…' : 'Delete'}
                        </button>
                        <button onClick={() => setConfirmDelete(null)}
                          className="text-gray-500 hover:text-gray-300">
                          <X size={12} />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setConfirmDelete(cert.name)}
                        className="text-gray-600 hover:text-red-400 transition-colors"
                        title="Delete certificate"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </td>
                </tr>

                {expanded === cert.name && (
                  <tr key={`${cert.name}-detail`} className="bg-gray-900/50">
                    <td colSpan={8} className="px-4 py-4 space-y-4">
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

                      {cert.duplicate_alert && (
                        <div className="flex items-start gap-2 text-xs text-red-400 bg-red-900/20 border border-red-800/60 rounded-md px-3 py-2">
                          <AlertTriangle size={13} className="shrink-0 mt-0.5" />
                          <span>
                            <strong>Duplicate usage detected</strong> — this certificate connected from{' '}
                            {cert.duplicate_alert.length} different IPs in the last 15 minutes:{' '}
                            <span className="font-mono">{cert.duplicate_alert.join(', ')}</span>.
                            The cert may be installed on multiple devices. Revoke and reissue if unauthorized.
                          </span>
                        </div>
                      )}

                      <div className="border-t border-gray-800 pt-3">
                        <p className="label mb-2">Install Bundle</p>
                        <BundleButtons name={cert.name} />
                        <p className="mt-2 text-xs text-gray-600">
                          Includes cert, key, CA, nebula config and OS-specific install script.
                        </p>
                      </div>

                      <div className="border-t border-gray-800 pt-3">
                        <p className="label mb-2">Cert + Key only</p>
                        <a href={certsApi.downloadUrl(cert.name)} download
                          className="btn-ghost text-xs py-1 gap-1.5 inline-flex">
                          <Download size={12} /> Download .zip
                        </a>
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
          suggestedIp={nextAvailableIp(certs)}
        />
      )}
    </div>
  )
}
