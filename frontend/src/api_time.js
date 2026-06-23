import axios from 'axios'
const api = axios.create({ baseURL: '/api/time' })

export const getProjects    = () => api.get('/projects').then(r => r.data)
export const createProject  = (d) => api.post('/projects', d).then(r => r.data)
export const updateProject  = (id, d) => api.put(`/projects/${id}`, d).then(r => r.data)
export const deleteProject  = (id) => api.delete(`/projects/${id}`)

export const getTasks       = (pid) => api.get('/tasks', { params: pid ? { project_id: pid } : {} }).then(r => r.data)
export const createTask     = (d) => api.post('/tasks', d).then(r => r.data)
export const deleteTask     = (id) => api.delete(`/tasks/${id}`)

export const getRunning     = () => api.get('/running').then(r => r.data)
export const startTimer     = (d) => api.post('/start', d).then(r => r.data)
export const stopTimer      = () => api.post('/stop').then(r => r.data)

export const getEntries     = (params) => api.get('/entries', { params }).then(r => r.data)
export const createEntryManual = (d) => api.post('/entries', d).then(r => r.data)
export const updateTimeEntry   = (id, d) => api.put(`/entries/${id}`, d).then(r => r.data)
export const deleteTimeEntry   = (id) => api.delete(`/entries/${id}`)

export const getReport      = (from_date, to_date) =>
  api.get('/report/summary', { params: { from_date, to_date } }).then(r => r.data)

export const exportCSV      = (from_date, to_date) => {
  window.location.href = `/api/time/report/export?from_date=${from_date}&to_date=${to_date}`
}

export const fmtDuration = (secs) => {
  if (!secs || secs < 0) return '0:00:00'
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  const s = Math.floor(secs % 60)
  return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
}

export const fmtHours = (secs) => {
  const h = secs / 3600
  return h < 0.1 ? '<0.1h' : `${h.toFixed(1)}h`
}
