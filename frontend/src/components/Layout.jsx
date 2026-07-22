import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, Network, ScrollText, Settings, ShieldCheck, Activity, LogOut
} from 'lucide-react'

const nav = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/nodes',     icon: Network,          label: 'Nodes' },
  { to: '/logs',      icon: ScrollText,        label: 'Logs' },
  { to: '/config',    icon: Settings,          label: 'Config' },
  { to: '/certs',     icon: ShieldCheck,       label: 'Certificates' },
  { to: '/service',   icon: Activity,          label: 'Service' },
]

export default function Layout() {
  const navigate = useNavigate()

  function logout() {
    localStorage.removeItem('nebula_token')
    navigate('/login')
  }

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside className="w-56 flex-shrink-0 bg-gray-900 border-r border-gray-800 flex flex-col">
        <div className="px-4 py-5 border-b border-gray-800">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-md bg-nebula-600 flex items-center justify-center">
              <Network size={14} className="text-white" />
            </div>
            <span className="font-semibold text-white tracking-tight">Nebula Web</span>
          </div>
        </div>

        <nav className="flex-1 p-2 space-y-0.5">
          {nav.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
                  isActive
                    ? 'bg-nebula-900/60 text-nebula-300 font-medium'
                    : 'text-gray-400 hover:text-gray-100 hover:bg-gray-800'
                }`
              }
            >
              <Icon size={16} />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="p-2 border-t border-gray-800">
          <button
            onClick={logout}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm text-gray-400 hover:text-red-400 hover:bg-gray-800 transition-colors"
          >
            <LogOut size={16} />
            Logout
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-y-auto bg-gray-950">
        <Outlet />
      </main>
    </div>
  )
}
