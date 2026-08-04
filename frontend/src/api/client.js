import axios from 'axios'

const api = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
})

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('nebula_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('nebula_token')
      window.location.href = '/login'
    }
    return Promise.reject(err)
  }
)

export default api

export const auth = {
  login: (username, password) => api.post('/auth/login', { username, password }),
  setup: (password) => api.post('/auth/setup', { password }),
  me: () => api.get('/auth/me'),
  health: () => api.get('/health'),
}

export const nodes = {
  list: () => api.get('/nodes'),
  history: (name, limit = 100) => api.get(`/nodes/${name}/history`, { params: { limit } }),
  pingStreamUrl: (name, count = 5) => {
    const token = localStorage.getItem('nebula_token')
    return `/api/nodes/${name}/ping/stream?count=${count}${token ? `&token=${encodeURIComponent(token)}` : ''}`
  },
}

export const logs = {
  get: (params) => api.get('/logs', { params }),
  streamUrl: () => '/api/logs/stream',
}

export const config = {
  get: () => api.get('/config'),
  update: (content) => api.put('/config', { content }),
}

function _authedUrl(path) {
  const token = localStorage.getItem('nebula_token')
  return `/api${path}${token ? `?token=${encodeURIComponent(token)}` : ''}`
}

export const certs = {
  list: () => api.get('/certs'),
  get: (name) => api.get(`/certs/${name}`),
  create: (data) => api.post('/certs', data),
  patch: (name, data) => api.patch(`/certs/${name}`, data),
  delete: (name, mode = 'delete') => api.delete(`/certs/${name}`, { params: { mode } }),
  downloadUrl: (name) => _authedUrl(`/certs/${name}/download`),
  bundleUrl: (name, platform) => _authedUrl(`/certs/${name}/bundle/${platform}`),
  ca: () => api.get('/certs/ca'),
  renewCa: (data) => api.post('/certs/ca/renew', data),
}

export const groups = {
  list: () => api.get('/groups'),
  create: (name, color) => api.post('/groups', { name, color }),
  update: (name, color) => api.put(`/groups/${name}`, { color }),
  delete: (name) => api.delete(`/groups/${name}`),
}

export const service = {
  status: () => api.get('/service/status'),
  file: () => api.get('/service/file'),
  action: (action) => api.post('/service/action', { action }),
  resources: () => api.get('/service/resources'),
}

export const audit = {
  list: (params) => api.get('/audit', { params }),
}

export const users = {
  list: () => api.get('/users'),
  create: (data) => api.post('/users', data),
  update: (username, data) => api.put(`/users/${username}`, data),
  delete: (username) => api.delete(`/users/${username}`),
}

export const cli = {
  commands: () => api.get('/cli/commands'),
  run: (command, args = []) => api.post('/cli/run', { command, args }),
}

export const alerts = {
  list: (params) => api.get('/alerts', { params }),
}
