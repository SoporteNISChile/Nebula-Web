import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, X, Check, Pencil, Network } from 'lucide-react'
import { groups as groupsApi, nodes as nodesApi } from '../api/client'

const PRESET_COLORS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#ef4444',
  '#f97316', '#eab308', '#22c55e', '#14b8a6',
  '#06b6d4', '#3b82f6', '#a855f7', '#64748b',
]

function ColorPicker({ value, onChange }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {PRESET_COLORS.map(c => (
        <button
          key={c}
          onClick={() => onChange(c)}
          className="w-6 h-6 rounded-full border-2 transition-transform hover:scale-110"
          style={{
            backgroundColor: c,
            borderColor: c === value ? '#fff' : 'transparent',
          }}
        />
      ))}
    </div>
  )
}

function CreateGroupModal({ onClose }) {
  const [name, setName] = useState('')
  const [color, setColor] = useState('#6366f1')
  const [error, setError] = useState('')
  const qc = useQueryClient()

  const create = useMutation({
    mutationFn: () => groupsApi.create(name.trim(), color),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['groups'] })
      onClose()
    },
    onError: (e) => setError(e.response?.data?.detail ?? 'Failed to create group'),
  })

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="card w-full max-w-sm p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-white">New Group</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300"><X size={16} /></button>
        </div>

        <div>
          <label className="label block mb-1">Name *</label>
          <input className="input w-full" placeholder="ej: soporte-ti" value={name}
            onChange={e => setName(e.target.value.toLowerCase().replace(/\s+/g, '-'))} />
          <p className="text-xs text-gray-500 mt-1">Minúsculas y guiones, sin espacios — ej: <span className="font-mono">soporte-ti</span></p>
        </div>

        <div>
          <label className="label block mb-2">Color</label>
          <ColorPicker value={color} onChange={setColor} />
          <div className="mt-2 flex items-center gap-2">
            <span className="w-5 h-5 rounded-full border border-gray-700" style={{ backgroundColor: color }} />
            <span className="text-xs text-gray-400 font-mono">{color}</span>
          </div>
        </div>

        {error && <p className="text-xs text-red-400">{error}</p>}

        <div className="flex gap-2">
          <button
            className="btn-primary flex-1 justify-center"
            disabled={!name.trim() || create.isPending}
            onClick={() => create.mutate()}
          >
            {create.isPending ? 'Creating…' : 'Create'}
          </button>
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  )
}

function GroupRow({ group, members }) {
  const [editing, setEditing] = useState(false)
  const [color, setColor] = useState(group.color)
  const [confirmDel, setConfirmDel] = useState(false)
  const qc = useQueryClient()

  const update = useMutation({
    mutationFn: () => groupsApi.update(group.name, color),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['groups'] })
      setEditing(false)
    },
  })

  const del = useMutation({
    mutationFn: () => groupsApi.delete(group.name),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['groups'] }),
  })

  return (
    <div className="flex items-start gap-3 py-3 border-b border-gray-800 last:border-0">
      <span className="w-5 h-5 rounded-full mt-0.5 shrink-0 border border-gray-700"
        style={{ backgroundColor: group.color }} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-gray-200">{group.name}</span>
          <span className="text-xs font-mono text-gray-500">{group.color}</span>
        </div>
        {members.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {members.map(n => (
              <span key={n.name} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs
                bg-gray-800 border border-gray-700 text-gray-300">
                <span className={`w-1.5 h-1.5 rounded-full ${n.status === 'active' ? 'bg-green-500' : 'bg-gray-500'}`} />
                {n.display_name ?? n.name}
              </span>
            ))}
          </div>
        )}
        {members.length === 0 && (
          <p className="text-xs text-gray-600 mt-1">No nodes in this group</p>
        )}
        {editing && (
          <div className="mt-2 space-y-2">
            <ColorPicker value={color} onChange={setColor} />
            <div className="flex gap-2">
              <button
                onClick={() => update.mutate()}
                disabled={update.isPending}
                className="btn-ghost text-xs py-1 gap-1 text-green-400 hover:text-green-300"
              >
                <Check size={12} /> Save
              </button>
              <button onClick={() => { setEditing(false); setColor(group.color) }}
                className="btn-ghost text-xs py-1 gap-1">
                <X size={12} /> Cancel
              </button>
            </div>
          </div>
        )}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {!editing && (
          <button onClick={() => setEditing(true)}
            className="text-gray-600 hover:text-gray-300 p-1">
            <Pencil size={13} />
          </button>
        )}
        {confirmDel ? (
          <div className="flex items-center gap-1">
            <button onClick={() => del.mutate()} disabled={del.isPending}
              className="text-xs px-2 py-0.5 bg-red-700 hover:bg-red-600 text-white rounded">
              {del.isPending ? '…' : 'Delete'}
            </button>
            <button onClick={() => setConfirmDel(false)} className="text-gray-500 hover:text-gray-300">
              <X size={12} />
            </button>
          </div>
        ) : (
          <button onClick={() => setConfirmDel(true)}
            className="text-gray-600 hover:text-red-400 p-1">
            <Trash2 size={13} />
          </button>
        )}
      </div>
    </div>
  )
}

export default function Groups() {
  const [showCreate, setShowCreate] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['groups'],
    queryFn: () => groupsApi.list().then(r => r.data),
  })

  const { data: nodesData } = useQuery({
    queryKey: ['nodes'],
    queryFn: () => nodesApi.list().then(r => r.data),
    refetchInterval: 30_000,
  })

  const groupList = data?.groups ?? []
  const allNodes  = nodesData?.nodes ?? []

  // build {groupName: [node, ...]} membership map
  const memberMap = {}
  for (const n of allNodes) {
    for (const g of (n.groups ?? [])) {
      if (!memberMap[g]) memberMap[g] = []
      memberMap[g].push(n)
    }
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-white">Groups</h1>
        <button className="btn-primary" onClick={() => setShowCreate(true)}>
          <Plus size={14} /> New Group
        </button>
      </div>

      <p className="text-xs text-gray-500">
        Groups are assigned to nodes at creation. Each group has a color shown in the topology map.
      </p>

      <div className="card p-4">
        {isLoading ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : groupList.length === 0 ? (
          <p className="text-sm text-gray-500">No groups yet. Create one to start color-coding your topology.</p>
        ) : (
          groupList.map(g => (
            <GroupRow key={g.name} group={g} members={memberMap[g.name] ?? []} />
          ))
        )}
      </div>

      {showCreate && <CreateGroupModal onClose={() => setShowCreate(false)} />}
    </div>
  )
}
