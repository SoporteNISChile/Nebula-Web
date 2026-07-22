import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Save, AlertTriangle, CheckCircle } from 'lucide-react'
import { config as configApi } from '../api/client'

export default function Config() {
  const qc = useQueryClient()
  const [content, setContent] = useState('')
  const [dirty, setDirty] = useState(false)
  const [result, setResult] = useState(null) // { ok, msg }

  const { data, isLoading } = useQuery({
    queryKey: ['nebula-config'],
    queryFn: () => configApi.get().then(r => r.data),
  })

  useEffect(() => {
    if (data?.content && !dirty) {
      setContent(data.content)
    }
  }, [data, dirty])

  const save = useMutation({
    mutationFn: () => configApi.update(content),
    onSuccess: ({ data }) => {
      setResult({ ok: true, msg: `Saved. Backup: ${data.backup}` })
      setDirty(false)
      qc.invalidateQueries({ queryKey: ['nebula-config'] })
    },
    onError: (err) => {
      setResult({ ok: false, msg: err.response?.data?.detail ?? 'Save failed' })
    },
  })

  return (
    <div className="p-6 space-y-4 h-full flex flex-col">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-white">Configuration</h1>
          {data?.path && <p className="text-xs text-gray-500 mt-0.5">{data.path}</p>}
        </div>
        <div className="flex items-center gap-3">
          {dirty && <span className="text-xs text-yellow-400">Unsaved changes</span>}
          <button
            className="btn-primary"
            onClick={() => {
              setResult(null)
              if (window.confirm('Save config? A backup will be created automatically.')) {
                save.mutate()
              }
            }}
            disabled={!dirty || save.isPending || isLoading}
          >
            <Save size={14} />
            Save
          </button>
        </div>
      </div>

      {result && (
        <div className={`flex items-start gap-2 px-3 py-2 rounded-md text-sm border ${
          result.ok
            ? 'bg-green-900/20 text-green-400 border-green-800'
            : 'bg-red-900/20 text-red-400 border-red-800'
        }`}>
          {result.ok ? <CheckCircle size={15} className="mt-0.5 shrink-0" /> : <AlertTriangle size={15} className="mt-0.5 shrink-0" />}
          {result.msg}
        </div>
      )}

      <div className="flex-1 min-h-0 card overflow-hidden">
        {isLoading ? (
          <div className="p-4 text-sm text-gray-500">Loading config…</div>
        ) : (
          <textarea
            className="w-full h-full bg-transparent text-sm font-mono text-gray-300 p-4 resize-none outline-none leading-relaxed"
            value={content}
            onChange={e => { setContent(e.target.value); setDirty(true); setResult(null) }}
            spellCheck={false}
          />
        )}
      </div>

      <p className="text-xs text-gray-600">
        Changes saved with automatic backup. Restart the Nebula service from the Service page for changes to take effect.
      </p>
    </div>
  )
}
