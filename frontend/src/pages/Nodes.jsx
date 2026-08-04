import { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Plus, Download, Shield, ChevronDown, ChevronUp, X,
  CheckCircle, AlertTriangle, Terminal, Apple, MonitorDot,
  Trash2, Pencil, Check, RefreshCw, RotateCcw, Activity,
} from 'lucide-react'
import { nodes as nodesApi, certs as certsApi, groups as groupsApi } from '../api/client'

// ── helpers ──────────────────────────────────────────────────────────────────

function nextAvailableIp(nodes) {
  const toInt = ip => ip.split('.').reduce((acc, o) => ((acc << 8) + parseInt(o, 10)) >>> 0, 0)
  const toIp  = n  => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.')
  let cidr = '/16'
  const ints = []
  for (const n of nodes) {
    const net = n.networks?.[0]; if (!net) continue
    const [ip, pfx] = net.split('/')
    cidr = `/${pfx}`
    ints.push(toInt(ip))
  }
  if (!ints.length) return ''
  ints.sort((a, b) => a - b)
  const used = new Set(ints)
  let next = ints[ints.length - 1] + 1
  while (used.has(next)) next++
  return `${toIp(next)}${cidr}`
}

function formatDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString()
}

function timeAgo(ts) {
  if (!ts) return '—'
  const s = (Date.now() - new Date(ts).getTime()) / 1000
  if (s < 60) return `${Math.floor(s)}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

// ── sub-components ───────────────────────────────────────────────────────────

function StatusDot({ status }) {
  return status === 'active'
    ? <span title="active"  className="inline-block w-3 h-3 rounded-full bg-green-500 shrink-0" />
    : <span title={status ?? 'offline'} className="inline-block w-3 h-3 rounded-full border-2 border-gray-500 shrink-0" />
}

function ExpiryText({ dateStr }) {
  if (!dateStr) return <span className="text-gray-500">—</span>
  const days = Math.floor((new Date(dateStr) - Date.now()) / 86400000)
  const cls = days < 30 ? 'text-red-400' : days < 90 ? 'text-yellow-400' : 'text-gray-400'
  return <span className={cls}>{formatDate(dateStr)} ({days}d)</span>
}

function GroupTags({ groups, groupColors }) {
  if (!groups?.length) return <span className="text-gray-600">—</span>
  return (
    <div className="flex flex-wrap gap-1">
      {groups.map(g => (
        <span key={g} className="px-1.5 py-0.5 rounded text-xs font-medium border"
          style={groupColors[g]
            ? { backgroundColor: `${groupColors[g]}22`, borderColor: `${groupColors[g]}66`, color: groupColors[g] }
            : { backgroundColor: '#1f2937', borderColor: '#374151', color: '#6b7280' }
          }>{g}</span>
      ))}
    </div>
  )
}

function BundleButtons({ name }) {
  const platforms = [
    { key: 'linux',   label: 'Linux',   icon: Terminal,   cls: 'text-orange-400 hover:text-orange-300' },
    { key: 'mac',     label: 'macOS',   icon: Apple,      cls: 'text-blue-400   hover:text-blue-300'   },
    { key: 'windows', label: 'Windows', icon: MonitorDot, cls: 'text-sky-400    hover:text-sky-300'    },
  ]
  return (
    <div className="flex items-center gap-1">
      {platforms.map(({ key, label, icon: Icon, cls }) => (
        <a key={key} href={certsApi.bundleUrl(name, key)} download={`${name}-nebula-${key}.zip`}
          title={`Download ${label} bundle`}
          className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-medium
            bg-gray-800 border border-gray-700 hover:border-gray-600 transition-colors ${cls}`}>
          <Icon size={11} />{label}<Download size={9} className="opacity-60" />
        </a>
      ))}
    </div>
  )
}

function PingModal({ name, onClose }) {
  const [lines, setLines] = useState([])
  const [done, setDone]   = useState(false)
  const [success, setSuccess] = useState(null)
  const preRef = useRef(null)

  useEffect(() => {
    const es = new EventSource(nodesApi.pingStreamUrl(name, 5))
    es.onmessage = (e) => {
      const data = e.data
      if (data.startsWith('__done__:')) {
        const code = parseInt(data.split(':')[1], 10)
        setSuccess(code === 0)
        setDone(true)
        es.close()
      } else {
        setLines(l => [...l, data])
      }
    }
    es.onerror = () => { setDone(true); es.close() }
    return () => es.close()
  }, [name])

  useEffect(() => {
    if (preRef.current) preRef.current.scrollTop = preRef.current.scrollHeight
  }, [lines])

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="card w-full max-w-lg p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white flex items-center gap-2">
            <Activity size={14} className={!done ? 'animate-pulse text-nebula-400' : success ? 'text-green-400' : 'text-red-400'} />
            Ping — <span className="font-mono text-gray-300">{name}</span>
          </h2>
          {done && (
            <button onClick={onClose} className="text-gray-500 hover:text-gray-300"><X size={16} /></button>
          )}
        </div>

        <pre ref={preRef}
          className="bg-gray-950 border border-gray-800 rounded p-3 text-xs font-mono
            text-gray-300 h-52 overflow-y-auto whitespace-pre-wrap leading-relaxed">
          {lines.join('\n')}
          {!done && <span className="text-gray-600 animate-pulse">▌</span>}
        </pre>

        {done && (
          <div className={`flex items-center justify-between`}>
            <span className={`text-xs font-medium ${success ? 'text-green-400' : 'text-red-400'}`}>
              {success ? '✓ Conectividad OK' : '✗ Sin respuesta'}
            </span>
            <button onClick={onClose} className="btn-ghost text-sm py-1.5 px-4">Cerrar</button>
          </div>
        )}
      </div>
    </div>
  )
}

function PingButton({ name }) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button onClick={() => setOpen(true)}
        className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium
          bg-gray-800 border border-gray-700 hover:border-gray-500 hover:text-gray-200
          text-gray-400 transition-colors"
        title="Probar conectividad VPN">
        <Activity size={11} /> Ping
      </button>
      {open && <PingModal name={name} onClose={() => setOpen(false)} />}
    </>
  )
}

function NameCell({ node }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue]     = useState(node.display_name ?? '')
  const qc = useQueryClient()

  const save = useMutation({
    mutationFn: () => certsApi.patch(node.name, { display_name: value.trim() || null }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['nodes'] }); setEditing(false) },
  })

  if (editing) return (
    <div className="flex items-center gap-1">
      <input autoFocus className="input py-0.5 px-1.5 text-xs w-36" value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') save.mutate(); if (e.key === 'Escape') setEditing(false) }} />
      <button onClick={() => save.mutate()} disabled={save.isPending}
        className="text-green-400 hover:text-green-300"><Check size={13} /></button>
      <button onClick={() => { setEditing(false); setValue(node.display_name ?? '') }}
        className="text-gray-500 hover:text-gray-300"><X size={12} /></button>
    </div>
  )

  return (
    <div className="flex items-center gap-2 group/nm">
      <Shield size={13} className="text-nebula-400 shrink-0" />
      <div>
        {node.display_name
          ? <><span className="font-medium text-gray-200">{node.display_name}</span>
              <span className="ml-1.5 text-xs text-gray-500">({node.name})</span></>
          : <span className="font-medium text-gray-200">{node.name}</span>}
      </div>
      <button onClick={() => setEditing(true)}
        className="opacity-0 group-hover/nm:opacity-100 text-gray-600 hover:text-gray-300 transition-opacity"
        title="Edit display name"><Pencil size={11} /></button>
    </div>
  )
}

// ── Delete modal ─────────────────────────────────────────────────────────────

function DeleteModal({ node, onClose }) {
  const [pending, setPending] = useState(null)
  const [error, setError]     = useState('')
  const qc = useQueryClient()

  const run = async (mode) => {
    setPending(mode)
    setError('')
    try {
      await certsApi.delete(node.name, mode)
      qc.invalidateQueries({ queryKey: ['nodes'] })
      onClose()
    } catch (e) {
      setError(e.response?.data?.detail ?? 'Failed')
      setPending(null)
    }
  }

  const label = node.display_name ? `${node.display_name} (${node.name})` : node.name

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="card w-full max-w-sm p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-white">Remove node</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300"><X size={16} /></button>
        </div>
        <p className="text-sm text-gray-300">
          <span className="font-mono text-gray-100">{label}</span>
        </p>

        <div className="space-y-2">
          <button
            disabled={!!pending}
            onClick={() => run('delete')}
            className="w-full flex flex-col gap-0.5 px-3 py-2.5 rounded-md border border-red-700/60
              bg-red-900/20 hover:bg-red-900/40 text-left transition-colors disabled:opacity-50"
          >
            <span className="text-sm font-medium text-red-400">
              {pending === 'delete' ? 'Deleting…' : 'Delete Node'}
            </span>
            <span className="text-xs text-gray-500">
              Blocks cert, removes files and all metadata permanently.
            </span>
          </button>

          <button
            disabled={!!pending}
            onClick={() => run('revoke')}
            className="w-full flex flex-col gap-0.5 px-3 py-2.5 rounded-md border border-yellow-700/60
              bg-yellow-900/20 hover:bg-yellow-900/40 text-left transition-colors disabled:opacity-50"
          >
            <span className="text-sm font-medium text-yellow-400">
              {pending === 'revoke' ? 'Revoking…' : 'Revoke Certificate'}
            </span>
            <span className="text-xs text-gray-500">
              Blocks old cert. Node stays in list so you can reissue a new certificate (same IP allowed).
            </span>
          </button>
        </div>

        {error && <p className="text-xs text-red-400">{error}</p>}

        <button onClick={onClose} className="btn-ghost w-full justify-center text-sm">Cancel</button>
      </div>
    </div>
  )
}

// ── Edit Groups modal ─────────────────────────────────────────────────────────

function EditGroupsModal({ node, groupList, onClose }) {
  const [selected, setSelected] = useState(new Set(node.groups ?? []))
  const [error, setError]       = useState('')
  const qc = useQueryClient()

  const toggle = (name) => setSelected(s => {
    const next = new Set(s)
    next.has(name) ? next.delete(name) : next.add(name)
    return next
  })

  const save = useMutation({
    mutationFn: () => certsApi.patch(node.name, { groups: [...selected] }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['nodes'] }); onClose() },
    onError: (e) => setError(e.response?.data?.detail ?? 'Failed'),
  })

  const label = node.display_name ? `${node.display_name} (${node.name})` : node.name

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="card w-full max-w-sm p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-white">Edit Groups — {label}</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300"><X size={16} /></button>
        </div>

        {groupList.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {groupList.map(g => {
              const sel = selected.has(g.name)
              return (
                <button key={g.name} type="button" onClick={() => toggle(g.name)}
                  className="px-2.5 py-1 rounded text-xs font-medium border transition-all"
                  style={sel
                    ? { backgroundColor: `${g.color}33`, borderColor: g.color, color: g.color }
                    : { backgroundColor: '#1f2937', borderColor: '#374151', color: '#6b7280' }}>
                  {g.name}
                </button>
              )
            })}
          </div>
        ) : (
          <p className="text-xs text-gray-500">No groups defined yet. Create groups in the Groups page first.</p>
        )}

        {error && <p className="text-xs text-red-400">{error}</p>}

        <div className="flex gap-2">
          <button onClick={() => save.mutate()} disabled={save.isPending}
            className="btn-primary flex-1 justify-center py-2">
            {save.isPending ? 'Saving…' : 'Save'}
          </button>
          <button onClick={onClose} className="btn-ghost">Cancel</button>
        </div>
      </div>
    </div>
  )
}

// ── Renew CA modal ───────────────────────────────────────────────────────────

function RenewCaModal({ currentCaName, onClose }) {
  const [name, setName]         = useState(currentCaName ?? 'Nebula CA')
  const [duration, setDuration] = useState('175200h')
  const [confirmed, setConfirmed] = useState(false)
  const [result, setResult]     = useState(null)
  const [error, setError]       = useState('')
  const [pending, setPending]   = useState(false)
  const qc = useQueryClient()

  const run = async () => {
    setPending(true); setError('')
    try {
      const r = await certsApi.renewCa({ name: name.trim(), duration: duration.trim() })
      setResult(r.data)
      qc.invalidateQueries({ queryKey: ['nodes'] })
      qc.invalidateQueries({ queryKey: ['certs-ca'] })
    } catch (e) {
      setError(e.response?.data?.detail ?? 'Failed')
    } finally {
      setPending(false)
    }
  }

  if (result) return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="card w-full max-w-md p-5 space-y-4">
        <div className="flex items-center gap-2 text-green-400 font-semibold">
          <CheckCircle size={16} /> CA renewed successfully
        </div>
        <p className="text-sm text-gray-300">
          {result.resigned.length} certs re-signed.
          {result.failed.length > 0 && (
            <span className="text-yellow-400 ml-1">{result.failed.length} failed.</span>
          )}
        </p>
        <div className="bg-yellow-900/20 border border-yellow-700/50 rounded-md px-3 py-2.5 text-xs text-yellow-300 space-y-1">
          <p className="font-semibold">Action required on every node:</p>
          <p>Download and reinstall the bundle — the CA certificate changed.</p>
        </div>
        {result.failed.length > 0 && (
          <div className="text-xs text-red-400 space-y-0.5">
            {result.failed.map(f => <p key={f.name}>{f.name}: {f.error}</p>)}
          </div>
        )}
        <button onClick={onClose} className="btn-primary w-full justify-center">Done</button>
      </div>
    </div>
  )

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="card w-full max-w-md p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-white flex items-center gap-2">
            <RotateCcw size={15} /> Renew Certificate Authority
          </h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300"><X size={16} /></button>
        </div>

        <div className="bg-red-900/20 border border-red-700/50 rounded-md px-3 py-2.5 text-xs text-red-300 space-y-1">
          <p className="font-semibold">This is a destructive operation.</p>
          <p>A new CA will be generated and all active node certs will be re-signed.
             Every node must download and reinstall its bundle after this completes.</p>
        </div>

        <div>
          <label className="label block mb-1">CA Name</label>
          <input className="input w-full" value={name} onChange={e => setName(e.target.value)} />
        </div>

        <div>
          <label className="label block mb-1">Validity duration</label>
          <input className="input w-full font-mono" value={duration}
            onChange={e => setDuration(e.target.value)}
            placeholder="e.g. 175200h (20 years)" />
          <p className="text-xs text-gray-500 mt-1">
            175200h = 20 years · 87600h = 10 years · 43800h = 5 years
          </p>
        </div>

        <label className="flex items-start gap-2 cursor-pointer">
          <input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)}
            className="mt-0.5 accent-red-500" />
          <span className="text-xs text-gray-400">
            I understand all nodes will show as expired until reinstalled
          </span>
        </label>

        {error && <p className="text-xs text-red-400">{error}</p>}

        <div className="flex gap-2">
          <button
            onClick={run}
            disabled={!confirmed || !name.trim() || !duration.trim() || pending}
            className="flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-md
              bg-red-700 hover:bg-red-600 text-white text-sm font-medium
              disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {pending ? <><RefreshCw size={13} className="animate-spin" /> Renewing…</> : 'Renew CA'}
          </button>
          <button onClick={onClose} className="btn-ghost">Cancel</button>
        </div>
      </div>
    </div>
  )
}

// ── Create modal ─────────────────────────────────────────────────────────────

function CreateNodeModal({ onClose, onCreated, suggestedIp, groupList, reissueName, reissueIp }) {
  const [form, setForm] = useState({
    name: reissueName ?? '',
    ip: reissueIp ?? suggestedIp,
    groups: '',
    duration: '',
  })
  const [error, setError] = useState('')
  const qc = useQueryClient()

  const { data: caData } = useQuery({
    queryKey: ['certs-ca'],
    queryFn: () => certsApi.ca().then(r => r.data),
  })
  const caExpiry = caData?.ca?.details?.notAfter
  const maxHours = caExpiry
    ? Math.max(0, Math.floor((new Date(caExpiry) - Date.now()) / 3_600_000) - 1)
    : null
  const TWENTY_YEARS_H = 20 * 365 * 24  // 175200h
  const defaultHours = maxHours != null ? Math.min(TWENTY_YEARS_H, maxHours) : TWENTY_YEARS_H

  const create = useMutation({
    mutationFn: () => certsApi.create({
      name: form.name,
      ip: form.ip,
      groups: form.groups ? form.groups.split(',').map(g => g.trim()).filter(Boolean) : [],
      duration: form.duration || undefined,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['nodes'] }); onCreated(form.name); onClose() },
    onError: (e) => setError(e.response?.data?.detail ?? 'Failed to create'),
  })

  const selectedGroups = form.groups.split(',').map(s => s.trim()).filter(Boolean)

  const toggleGroup = (name) => {
    const next = selectedGroups.includes(name)
      ? selectedGroups.filter(x => x !== name)
      : [...selectedGroups, name]
    setForm(f => ({ ...f, groups: next.join(', ') }))
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="card w-full max-w-md p-5">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-white">{reissueName ? 'Reissue Certificate' : 'New Node'}</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300"><X size={18} /></button>
        </div>
        <div className="space-y-4">
          <div>
            <label className="label block mb-1">Node Name *</label>
            <input className="input w-full" placeholder="ej: laptop-oficina"
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value.toLowerCase().replace(/\s+/g, '-') }))}
              readOnly={!!reissueName} disabled={!!reissueName} />
            {!reissueName && (
              <p className="text-xs text-gray-500 mt-1">Minúsculas y guiones — ej: <span className="font-mono">servidor-1-respaldo</span></p>
            )}
          </div>
          <div>
            <label className="label block mb-1">VPN IP / CIDR *</label>
            <input className="input w-full font-mono" placeholder="e.g. 10.120.1.50/16"
              value={form.ip} onChange={e => setForm(f => ({ ...f, ip: e.target.value }))} />
          </div>
          <div>
            <label className="label block mb-1">Groups</label>
            {groupList.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {groupList.map(g => {
                  const sel = selectedGroups.includes(g.name)
                  return (
                    <button key={g.name} type="button" onClick={() => toggleGroup(g.name)}
                      className="px-2 py-0.5 rounded text-xs font-medium border transition-all"
                      style={sel
                        ? { backgroundColor: `${g.color}33`, borderColor: g.color, color: g.color }
                        : { backgroundColor: '#1f2937', borderColor: '#374151', color: '#6b7280' }}>
                      {g.name}
                    </button>
                  )
                })}
              </div>
            )}
            <input className="input w-full text-xs" placeholder="or type: vpn-users, servers"
              value={form.groups} onChange={e => setForm(f => ({ ...f, groups: e.target.value }))} />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="label">Duration</label>
              {maxHours != null && (
                <span className="text-xs text-gray-500">
                  max: {maxHours}h (CA expires {new Date(caExpiry).toLocaleDateString()})
                </span>
              )}
            </div>
            <input className="input w-full font-mono" placeholder="e.g. 175200h (20 years)"
              value={form.duration || `${defaultHours}h`}
              onChange={e => setForm(f => ({ ...f, duration: e.target.value }))} />
          </div>
          {error && (
            <div className="flex items-start gap-2 text-sm text-red-400 bg-red-900/20
              border border-red-800 rounded-md px-3 py-2">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />{error}
            </div>
          )}
          <div className="flex gap-2 pt-1">
            <button className="btn-primary flex-1 justify-center py-2"
              onClick={() => create.mutate()}
              disabled={!form.name || !form.ip || create.isPending}>
              {create.isPending ? 'Creating…' : 'Create Node'}
            </button>
            <button className="btn-ghost" onClick={onClose}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── main page ─────────────────────────────────────────────────────────────────

export default function Nodes() {
  const [showCreate, setShowCreate]     = useState(false)
  const [showRenewCa, setShowRenewCa]   = useState(false)
  const [reissueNode, setReissueNode]   = useState(null)
  const [editGroupsNode, setEditGroups] = useState(null)
  const [created, setCreated]           = useState(null)
  const [expanded, setExpanded]         = useState(null)
  const [deleteNode, setDeleteNode]     = useState(null)

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['nodes'],
    queryFn: () => nodesApi.list().then(r => r.data),
    refetchInterval: 30_000,
  })

  const { data: groupsData } = useQuery({
    queryKey: ['groups'],
    queryFn: () => groupsApi.list().then(r => r.data),
  })

  const { data: caData } = useQuery({
    queryKey: ['certs-ca'],
    queryFn: () => certsApi.ca().then(r => r.data),
  })

  const allNodes    = data?.nodes ?? []
  const groupList   = groupsData?.groups ?? []
  const groupColors = Object.fromEntries(groupList.map(g => [g.name, g.color]))
  const activeCount = allNodes.filter(n => n.status === 'active').length
  const caName      = caData?.ca?.details?.name ?? 'Nebula CA'

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-white">Nodes</h1>
          <p className="text-xs text-gray-500 mt-0.5">{activeCount} active · {allNodes.length} total</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => refetch()} className="btn-ghost p-2" disabled={isFetching} title="Refresh">
            <RefreshCw size={14} className={isFetching ? 'animate-spin text-nebula-400' : 'text-gray-400'} />
          </button>
          <button className="btn-ghost text-xs py-1.5 gap-1.5 text-gray-400 hover:text-yellow-400"
            onClick={() => setShowRenewCa(true)} title="Renew Certificate Authority">
            <RotateCcw size={13} /> Renew CA
          </button>
          <button className="btn-primary" onClick={() => setShowCreate(true)}>
            <Plus size={14} /> New Node
          </button>
        </div>
      </div>

      {created && (
        <div className="card border-green-800 bg-green-900/10 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm text-green-400 font-medium">
              <CheckCircle size={15} />
              Node '{created}' created — download install bundle:
            </div>
            <button onClick={() => setCreated(null)} className="text-green-700 hover:text-green-400"><X size={14} /></button>
          </div>
          <BundleButtons name={created} />
        </div>
      )}

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800 text-left">
              <th className="px-3 py-3 w-4"></th>
              <th className="px-3 py-3 label">Name</th>
              <th className="px-3 py-3 label">VPN IP</th>
              <th className="px-3 py-3 label">Groups</th>
              <th className="px-3 py-3 label">Last seen</th>
              <th className="px-3 py-3 label">Expires</th>
              <th className="px-3 py-3 label">Install</th>
              <th className="px-3 py-3 label">Conectividad</th>
              <th className="px-3 py-3 w-6"></th>
              <th className="px-3 py-3 w-6"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {isLoading && (
              <tr><td colSpan={10} className="px-4 py-8 text-center text-gray-500">Loading…</td></tr>
            )}
            {allNodes.map(node => (
              <>
                <tr key={node.name} className={`hover:bg-gray-800/40 ${node.revoked ? 'opacity-60' : ''}`}>
                  <td className="px-3 py-3"><StatusDot status={node.status} /></td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <NameCell node={node} />
                      {node.revoked && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs
                          bg-yellow-900/40 border border-yellow-700/60 text-yellow-400">
                          Revoked
                        </span>
                      )}
                      {node.duplicate_alert && (
                        <span title={`Multiple IPs: ${node.duplicate_alert.join(', ')}`}
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs
                            bg-red-900/40 border border-red-700/60 text-red-400 cursor-help">
                          <AlertTriangle size={10} /> Dup
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-3 font-mono text-xs text-nebula-300">
                    {node.networks?.[0]?.split('/')[0] ?? '—'}
                  </td>
                  <td className="px-3 py-3">
                    {node.revoked
                      ? <GroupTags groups={node.groups} groupColors={groupColors} />
                      : <button onClick={() => setEditGroups(node)}
                          className="flex items-center gap-1.5 text-left hover:bg-gray-700/40 rounded px-1 -mx-1 py-0.5 transition-colors w-full"
                          title="Edit groups">
                          <GroupTags groups={node.groups} groupColors={groupColors} />
                          <Pencil size={10} className="text-gray-600 shrink-0" />
                        </button>}
                  </td>
                  <td className="px-3 py-3 text-xs text-gray-400">{timeAgo(node.last_seen)}</td>
                  <td className="px-3 py-3 text-xs"><ExpiryText dateStr={node.not_after} /></td>
                  <td className="px-3 py-3">
                    {node.revoked
                      ? <button onClick={() => setReissueNode(node)}
                          className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium
                            bg-yellow-900/30 border border-yellow-700/60 text-yellow-400
                            hover:bg-yellow-900/60 transition-colors">
                          <Plus size={11} /> Reissue Certificate
                        </button>
                      : <BundleButtons name={node.name} />}
                  </td>
                  <td className="px-3 py-3">
                    {!node.revoked && <PingButton name={node.name} />}
                  </td>
                  <td className="px-3 py-3 text-gray-600 cursor-pointer"
                    onClick={() => setExpanded(expanded === node.name ? null : node.name)}>
                    {expanded === node.name ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </td>
                  <td className="px-3 py-3">
                    <button onClick={() => setDeleteNode(node)}
                      className="text-gray-600 hover:text-red-400 transition-colors"
                      title="Delete node"><Trash2 size={14} /></button>
                  </td>
                </tr>

                {expanded === node.name && (
                  <tr key={`${node.name}-exp`} className="bg-gray-900/50">
                    <td colSpan={10} className="px-4 py-4 space-y-3">
                      <div className="grid grid-cols-3 gap-4 text-xs text-gray-400">
                        <div>
                          <p className="label mb-1">Fingerprint</p>
                          <p className="font-mono text-gray-500 break-all">{node.fingerprint ?? '—'}</p>
                        </div>
                        <div>
                          <p className="label mb-1">Issued</p>
                          <p>{formatDate(node.not_before)}</p>
                        </div>
                        <div>
                          <p className="label mb-1">Cert file</p>
                          <p className="font-mono text-gray-500">{node.filename}</p>
                        </div>
                      </div>
                      {node.duplicate_alert && (
                        <div className="flex items-start gap-2 text-xs text-red-400 bg-red-900/20
                          border border-red-800/60 rounded-md px-3 py-2">
                          <AlertTriangle size={13} className="shrink-0 mt-0.5" />
                          Connected from {node.duplicate_alert.length} IPs in last 15 min:
                          <span className="font-mono ml-1">{node.duplicate_alert.join(', ')}</span>
                        </div>
                      )}
                      <div className="border-t border-gray-800 pt-3">
                        <p className="label mb-2">Cert + Key only</p>
                        <a href={certsApi.downloadUrl(node.name)} download
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
        <CreateNodeModal
          onClose={() => setShowCreate(false)}
          onCreated={setCreated}
          suggestedIp={nextAvailableIp(allNodes)}
          groupList={groupList}
        />
      )}

      {reissueNode && (
        <CreateNodeModal
          onClose={() => setReissueNode(null)}
          onCreated={(name) => { setCreated(name); setReissueNode(null) }}
          suggestedIp={reissueNode.networks?.[0] ?? ''}
          groupList={groupList}
          reissueName={reissueNode.name}
          reissueIp={reissueNode.networks?.[0] ?? ''}
        />
      )}

      {deleteNode && (
        <DeleteModal node={deleteNode} onClose={() => { setDeleteNode(null); setExpanded(null) }} />
      )}

      {editGroupsNode && (
        <EditGroupsModal node={editGroupsNode} groupList={groupList} onClose={() => setEditGroups(null)} />
      )}

      {showRenewCa && (
        <RenewCaModal currentCaName={caName} onClose={() => setShowRenewCa(false)} />
      )}
    </div>
  )
}
