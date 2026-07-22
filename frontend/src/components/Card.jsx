export function Card({ children, className = '' }) {
  return <div className={`card p-4 ${className}`}>{children}</div>
}

export function StatCard({ label, value, sub, icon: Icon, color = 'text-nebula-400' }) {
  return (
    <div className="card p-4 flex items-start gap-3">
      {Icon && (
        <div className={`mt-0.5 ${color}`}>
          <Icon size={20} />
        </div>
      )}
      <div className="min-w-0">
        <p className="label">{label}</p>
        <p className="text-2xl font-bold text-white leading-tight">{value}</p>
        {sub && <p className="text-xs text-gray-500 mt-0.5">{sub}</p>}
      </div>
    </div>
  )
}
