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
}

export const logs = {
  get: (params) => api.get('/logs', { params }),
  streamUrl: () => '/api/logs/stream',
}

export const config = {
  get: () => api.get('/config'),
  update: (content) => api.put('/config', { content }),
}

export const certs = {
  list: () => api.get('/certs'),
  get: (name) => api.get(`/certs/${name}`),
  create: (data) => api.post('/certs', data),
  downloadUrl: (name) => `/api/certs/${name}/download`,
  ca: () => api.get('/certs/ca'),
}

export const service = {
  status: () => api.get('/service/status'),
  file: () => api.get('/service/file'),
  action: (action) => api.post('/service/action', { action }),
}
