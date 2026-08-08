import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  LayoutDashboard, Network, ScrollText, Settings, Activity, LogOut,
  Share2, Tag, Users, Terminal, ClipboardList, AlertTriangle, Bell
} from 'lucide-react'
import { auth, service as serviceApi, alerts as alertsApi } from '../api/client'

const nav = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/nodes',     icon: Network,         label: 'Nodes' },
  { to: '/topology',  icon: Share2,          label: 'Topology' },
  { to: '/groups',    icon: Tag,             label: 'Groups' },
  { to: '/logs',      icon: ScrollText,      label: 'Logs' },
  { to: '/config',    icon: Settings,        label: 'Config' },
  { to: '/service',   icon: Activity,        label: 'Service' },
]

const superAdminNav = [
  { to: '/users',     icon: Users,           label: 'Users' },
  { to: '/cli',       icon: Terminal,        label: 'CLI' },
  { to: '/audit',     icon: ClipboardList,   label: 'Audit Log' },
  { to: '/alerts',    icon: Bell,            label: 'Alertas' },
]

export default function Layout() {
  const navigate = useNavigate()
  const { data: me } = useQuery({
    queryKey: ['me'],
    queryFn: () => auth.me().then(r => r.data),
    staleTime: 60_000,
  })
  const isSuperAdmin = me?.role === 'super_admin'

  const { data: resData } = useQuery({
    queryKey: ['service-resources'],
    queryFn: () => serviceApi.resources().then(r => r.data),
    refetchInterval: 30_000,
    retry: false,
  })
  const resourceWarning = resData?.warning === true

  const { data: alertsData } = useQuery({
    queryKey: ['alerts-sidebar'],
    queryFn: () => alertsApi.list({ limit: 50 }).then(r => r.data),
    refetchInterval: 60_000,
    retry: false,
    enabled: isSuperAdmin,
  })
  // Badge = nodes currently down: latest event per node is 'down'
  // (entries come sorted by ts DESC, so first occurrence per node wins)
  const recentDownCount = (() => {
    const latest = {}
    for (const e of (alertsData?.entries || [])) {
      if (!(e.cert_name in latest)) latest[e.cert_name] = e.event
    }
    return Object.values(latest).filter(ev => ev === 'down').length
  })()

  function logout() {
    localStorage.removeItem('nebula_token')
    navigate('/login')
  }

  const navLink = ({ to, icon: Icon, label }) => (
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
      <span className="flex-1">{label}</span>
      {to === '/service' && resourceWarning && (
        <AlertTriangle size={13} className="text-yellow-400 shrink-0" />
      )}
      {to === '/alerts' && recentDownCount > 0 && (
        <span className="ml-auto min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-red-600 text-white text-[10px] font-bold px-1 shrink-0">
          {recentDownCount > 99 ? '99+' : recentDownCount}
        </span>
      )}
    </NavLink>
  )

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

        <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
          {nav.map(navLink)}

          {isSuperAdmin && (
            <>
              <div className="pt-2 pb-1 px-3">
                <span className="text-xs text-gray-600 uppercase tracking-wider">Admin</span>
              </div>
              {superAdminNav.map(navLink)}
            </>
          )}
        </nav>

        <div className="p-2 border-t border-gray-800">
          {me && (
            <div className="px-3 py-1.5 text-xs text-gray-500 font-mono truncate">{me.username}</div>
          )}
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
