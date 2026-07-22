export function StatusBadge({ status, active, label }) {
  // Accepts either status='active'|'disconnected'|'offline' or legacy active=bool
  const resolved = status ?? (active ? 'active' : 'offline')

  const styles = {
    active:       { bg: 'bg-green-900/50 text-green-400',   dot: 'bg-green-400',   text: label ?? 'Active' },
    disconnected: { bg: 'bg-yellow-900/40 text-yellow-400', dot: 'bg-yellow-400',  text: label ?? 'Disconnected' },
    offline:      { bg: 'bg-gray-800 text-gray-500',        dot: 'bg-gray-600',    text: label ?? 'Offline' },
  }

  const s = styles[resolved] ?? styles.offline
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${s.bg}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
      {s.text}
    </span>
  )
}

export function LevelBadge({ level }) {
  const styles = {
    info:    'text-gray-300',
    warning: 'text-yellow-400',
    warn:    'text-yellow-400',
    error:   'text-red-400',
    debug:   'text-gray-500',
  }
  return <span className={`font-mono text-xs ${styles[level] ?? 'text-gray-400'}`}>{level?.toUpperCase()}</span>
}
