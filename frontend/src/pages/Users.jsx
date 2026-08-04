import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, KeyRound, ShieldCheck, Shield, X } from 'lucide-react'
import { users as usersApi } from '../api/client'

const ROLES = [
  { value: 'admin', label: 'Admin', icon: Shield, color: 'text-blue-400' },
  { value: 'super_admin', label: 'Super Admin', icon: ShieldCheck, color: 'text-purple-400' },
]

function RoleBadge({ role }) {
  const r = ROLES.find(x => x.value === role) ?? ROLES[0]
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium ${r.color}`}>
      <r.icon size={12} />
      {r.label}
    </span>
  )
}

function AddUserModal({ onClose, onAdd }) {
  const [form, setForm] = useState({ username: '', password: '', role: 'admin' })
  const [error, setError] = useState('')

  async function submit(e) {
    e.preventDefault()
    setError('')
    try {
      await onAdd(form)
      onClose()
    } catch (err) {
      setError(err.response?.data?.detail ?? 'Error creating user')
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="card w-full max-w-sm p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-white">Add User</h2>
          <button onClick={onClose} className="btn-ghost p-1"><X size={16} /></button>
        </div>

        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="text-xs text-gray-400 mb-1 block">Username</label>
            <input
              className="input w-full"
              required
              value={form.username}
              onChange={e => setForm(p => ({ ...p, username: e.target.value }))}
            />
          </div>
          <div>
            <label className="text-xs text-gray-400 mb-1 block">Password</label>
            <input
              type="password"
              className="input w-full"
              required
              minLength={8}
              value={form.password}
              onChange={e => setForm(p => ({ ...p, password: e.target.value }))}
            />
          </div>
          <div>
            <label className="text-xs text-gray-400 mb-1 block">Role</label>
            <select
              className="input w-full"
              value={form.role}
              onChange={e => setForm(p => ({ ...p, role: e.target.value }))}
            >
              {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>
          {error && <p className="text-red-400 text-xs">{error}</p>}
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancel</button>
            <button type="submit" className="btn-primary flex-1">Create</button>
          </div>
        </form>
      </div>
    </div>
  )
}

function ChangePasswordModal({ username, onClose, onSave }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  async function submit(e) {
    e.preventDefault()
    setError('')
    try {
      await onSave(username, { password })
      onClose()
    } catch (err) {
      setError(err.response?.data?.detail ?? 'Error updating password')
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="card w-full max-w-sm p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-white">Change Password — {username}</h2>
          <button onClick={onClose} className="btn-ghost p-1"><X size={16} /></button>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <input
            type="password"
            className="input w-full"
            placeholder="New password (min 8 chars)"
            required
            minLength={8}
            value={password}
            onChange={e => setPassword(e.target.value)}
          />
          {error && <p className="text-red-400 text-xs">{error}</p>}
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancel</button>
            <button type="submit" className="btn-primary flex-1">Save</button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function Users() {
  const qc = useQueryClient()
  const [showAdd, setShowAdd] = useState(false)
  const [changePw, setChangePw] = useState(null)

  const { data, isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: () => usersApi.list().then(r => r.data),
  })

  const createMut = useMutation({
    mutationFn: (form) => usersApi.create(form),
    onSuccess: () => qc.invalidateQueries(['users']),
  })

  const updateMut = useMutation({
    mutationFn: ({ username, data }) => usersApi.update(username, data),
    onSuccess: () => qc.invalidateQueries(['users']),
  })

  const deleteMut = useMutation({
    mutationFn: (username) => usersApi.delete(username),
    onSuccess: () => qc.invalidateQueries(['users']),
  })

  const userList = data?.users ?? []
  const currentUser = JSON.parse(atob((localStorage.getItem('nebula_token') ?? '').split('.')[1] ?? 'e30=') || '{}').sub

  function confirmDelete(username) {
    if (window.confirm(`Delete user "${username}"?`)) deleteMut.mutate(username)
  }

  function toggleRole(user) {
    const newRole = user.role === 'super_admin' ? 'admin' : 'super_admin'
    updateMut.mutate({ username: user.username, data: { role: newRole } })
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-white">Users</h1>
        <button onClick={() => setShowAdd(true)} className="btn-primary flex items-center gap-2 text-sm">
          <Plus size={15} /> Add User
        </button>
      </div>

      <div className="card overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-gray-500 text-sm">Loading...</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800">
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Username</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Role</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Created</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {userList.map(u => (
                <tr key={u.username} className="hover:bg-gray-800/40">
                  <td className="px-4 py-3 font-mono text-gray-200">
                    {u.username}
                    {u.username === currentUser && (
                      <span className="ml-2 text-xs text-gray-500">(you)</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <RoleBadge role={u.role} />
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">
                    {u.created_at ? new Date(u.created_at).toLocaleDateString() : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1 justify-end">
                      <button
                        onClick={() => toggleRole(u)}
                        className="btn-ghost p-1.5"
                        title={u.role === 'super_admin' ? 'Demote to Admin' : 'Promote to Super Admin'}
                        disabled={updateMut.isPending}
                      >
                        {u.role === 'super_admin'
                          ? <ShieldCheck size={14} className="text-purple-400" />
                          : <Shield size={14} className="text-blue-400" />
                        }
                      </button>
                      <button
                        onClick={() => setChangePw(u.username)}
                        className="btn-ghost p-1.5"
                        title="Change password"
                      >
                        <KeyRound size={14} className="text-gray-400" />
                      </button>
                      {u.username !== currentUser && (
                        <button
                          onClick={() => confirmDelete(u.username)}
                          className="btn-ghost p-1.5"
                          title="Delete user"
                          disabled={deleteMut.isPending}
                        >
                          <Trash2 size={14} className="text-red-400" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {userList.length === 0 && (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-500">No users found</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {showAdd && (
        <AddUserModal
          onClose={() => setShowAdd(false)}
          onAdd={(form) => createMut.mutateAsync(form)}
        />
      )}
      {changePw && (
        <ChangePasswordModal
          username={changePw}
          onClose={() => setChangePw(null)}
          onSave={(username, data) => updateMut.mutateAsync({ username, data })}
        />
      )}
    </div>
  )
}
