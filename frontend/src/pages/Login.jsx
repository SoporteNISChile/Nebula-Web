import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Network, Lock } from 'lucide-react'
import { auth as authApi } from '../api/client'

export default function Login() {
  const navigate = useNavigate()
  const [mode, setMode] = useState('login') // 'login' | 'setup'
  const [form, setForm] = useState({ username: 'admin', password: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    authApi.health().then(({ data }) => {
      if (!data.setup_complete) setMode('setup')
      if (localStorage.getItem('nebula_token')) navigate('/dashboard')
    }).catch(() => {})
  }, [navigate])

  async function submit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      if (mode === 'setup') {
        await authApi.setup(form.password)
        setMode('login')
        setForm(f => ({ ...f, password: '' }))
        return
      }
      const { data } = await authApi.login(form.username, form.password)
      localStorage.setItem('nebula_token', data.access_token)
      navigate('/dashboard')
    } catch (err) {
      setError(err.response?.data?.detail ?? 'Request failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center justify-center gap-3 mb-8">
          <div className="w-10 h-10 rounded-xl bg-nebula-600 flex items-center justify-center">
            <Network size={20} className="text-white" />
          </div>
          <span className="text-2xl font-bold text-white">Nebula Web</span>
        </div>

        <div className="card p-6">
          <div className="flex items-center gap-2 mb-6">
            <Lock size={16} className="text-nebula-400" />
            <h1 className="text-sm font-medium text-gray-300">
              {mode === 'setup' ? 'Initial Setup — Set Admin Password' : 'Sign in'}
            </h1>
          </div>

          <form onSubmit={submit} className="space-y-4">
            {mode === 'login' && (
              <div>
                <label className="label block mb-1">Username</label>
                <input
                  className="input w-full"
                  value={form.username}
                  onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
                  autoFocus
                />
              </div>
            )}
            <div>
              <label className="label block mb-1">Password</label>
              <input
                type="password"
                className="input w-full"
                value={form.password}
                onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                autoFocus={mode === 'setup'}
                placeholder={mode === 'setup' ? 'Minimum 8 characters' : ''}
              />
            </div>

            {error && (
              <p className="text-sm text-red-400 bg-red-900/20 border border-red-800 rounded-md px-3 py-2">
                {error}
              </p>
            )}

            <button type="submit" className="btn-primary w-full justify-center py-2" disabled={loading}>
              {loading ? 'Please wait…' : mode === 'setup' ? 'Set Password & Continue' : 'Sign in'}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-gray-600 mt-6">Nebula Web — VPN Administration</p>
      </div>
    </div>
  )
}
