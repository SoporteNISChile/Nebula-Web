export function StatusBadge({ active, label }) {
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${
      active ? 'bg-green-900/50 text-green-400' : 'bg-gray-800 text-gray-500'
    }`}>
      <span className={`w-1.5 h-1.5 rounded-full ${active ? 'bg-green-400' : 'bg-gray-600'}`} />
      {label ?? (active ? 'Active' : 'Offline')}
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
