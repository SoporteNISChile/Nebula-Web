import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Nodes from './pages/Nodes'
import Logs from './pages/Logs'
import Config from './pages/Config'
import Certs from './pages/Certs'
import Service from './pages/Service'

function RequireAuth({ children }) {
  const token = localStorage.getItem('nebula_token')
  if (!token) return <Navigate to="/login" replace />
  return children
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<RequireAuth><Layout /></RequireAuth>}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="nodes" element={<Nodes />} />
          <Route path="logs" element={<Logs />} />
          <Route path="config" element={<Config />} />
          <Route path="certs" element={<Certs />} />
          <Route path="service" element={<Service />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
