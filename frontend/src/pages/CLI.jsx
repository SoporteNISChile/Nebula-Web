import { useState, useRef, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Terminal, Play, Trash2, ChevronRight } from 'lucide-react'
import { cli as cliApi } from '../api/client'

function OutputBlock({ entry }) {
  const isError = entry.exit_code !== 0
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 text-xs text-gray-500">
        <ChevronRight size={12} className="text-nebula-400" />
        <span className="font-mono text-nebula-300">
          {entry.command}{entry.args?.length ? ' ' + entry.args.join(' ') : ''}
        </span>
        <span className="ml-auto">{new Date(entry.ts).toLocaleTimeString()}</span>
      </div>
      {(entry.output || entry.error) && (
        <pre className={`font-mono text-xs whitespace-pre-wrap break-all pl-4 ${
          isError ? 'text-red-400' : 'text-green-300'
        }`}>
          {entry.output || entry.error}
        </pre>
      )}
      {!entry.output && !entry.error && (
        <p className="font-mono text-xs text-gray-600 pl-4">(no output)</p>
      )}
    </div>
  )
}

export default function CLI() {
  const [selectedCmd, setSelectedCmd] = useState('')
  const [argInputs, setArgInputs] = useState([])
  const [history, setHistory] = useState([])
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')
  const bottomRef = useRef(null)

  const { data: cmdsData } = useQuery({
    queryKey: ['cli-commands'],
    queryFn: () => cliApi.commands().then(r => r.data),
  })

  const commands = cmdsData?.commands ?? []
  const currentCmd = commands.find(c => c.name === selectedCmd)

  useEffect(() => {
    if (commands.length > 0 && !selectedCmd) {
      setSelectedCmd(commands[0].name)
    }
  }, [commands])

  useEffect(() => {
    if (currentCmd) {
      const required = currentCmd.args.filter(a => !a.endsWith('?'))
      setArgInputs(new Array(currentCmd.args.length).fill(''))
    }
  }, [selectedCmd])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [history])

  async function run() {
    if (!selectedCmd || running) return
    setError('')

    const args = argInputs.filter(a => a.trim())
    setRunning(true)
    try {
      const res = await cliApi.run(selectedCmd, args)
      setHistory(h => [...h, { ...res.data, ts: new Date().toISOString() }])
    } catch (err) {
      setError(err.response?.data?.detail ?? 'Command failed')
    } finally {
      setRunning(false)
    }
  }

  function handleKey(e) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) run()
  }

  return (
    <div className="p-6 space-y-4 h-full flex flex-col" style={{ height: 'calc(100vh - 64px)' }}>
      <div className="flex items-center gap-3">
        <Terminal size={18} className="text-nebula-400" />
        <h1 className="text-xl font-semibold text-white">Nebula CLI</h1>
        <span className="text-xs text-gray-500 bg-gray-800 px-2 py-0.5 rounded">super-admin only</span>
      </div>

      {/* Command selector */}
      <div className="card p-4 space-y-3">
        <div className="flex gap-3 flex-wrap">
          <div className="flex-1 min-w-[200px]">
            <label className="text-xs text-gray-400 mb-1 block">Command</label>
            <select
              className="input w-full font-mono"
              value={selectedCmd}
              onChange={e => setSelectedCmd(e.target.value)}
            >
              {commands.map(c => (
                <option key={c.name} value={c.name}>{c.name}</option>
              ))}
            </select>
          </div>

          {currentCmd?.args?.map((arg, i) => {
            const isOptional = arg.endsWith('?')
            const label = isOptional ? arg.slice(0, -1) + ' (optional)' : arg
            return (
              <div key={i} className="flex-1 min-w-[160px]">
                <label className="text-xs text-gray-400 mb-1 block font-mono">{label}</label>
                <input
                  className="input w-full font-mono"
                  placeholder={isOptional ? 'optional' : 'required'}
                  value={argInputs[i] ?? ''}
                  onChange={e => setArgInputs(prev => { const n=[...prev]; n[i]=e.target.value; return n })}
                  onKeyDown={handleKey}
                />
              </div>
            )
          })}

          <div className="flex items-end">
            <button
              onClick={run}
              disabled={running}
              className="btn-primary flex items-center gap-2 h-9"
              title="Run (Ctrl+Enter)"
            >
              <Play size={14} />
              {running ? 'Running...' : 'Run'}
            </button>
          </div>
        </div>

        {currentCmd && (
          <p className="text-xs text-gray-500">{currentCmd.description}</p>
        )}
        {error && <p className="text-xs text-red-400">{error}</p>}
      </div>

      {/* Output terminal */}
      <div className="flex-1 card bg-gray-950 border-gray-800 overflow-hidden flex flex-col min-h-0">
        <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800">
          <span className="text-xs text-gray-500 font-mono">output</span>
          {history.length > 0 && (
            <button onClick={() => setHistory([])} className="btn-ghost p-1" title="Clear">
              <Trash2 size={12} />
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {history.length === 0 ? (
            <p className="text-gray-600 text-xs font-mono">Select a command and press Run.</p>
          ) : (
            history.map((entry, i) => <OutputBlock key={i} entry={entry} />)
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      <p className="text-xs text-gray-600">
        Ctrl+Enter to run · Commands execute via Nebula sshd at 127.0.0.1:2222
      </p>
    </div>
  )
}
