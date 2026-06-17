import axios from 'axios'

const api = axios.create({ baseURL: '/api' })

// ── Diary ──────────────────────────────────────────────────────────────────

export const getDatesWithEntries = () => api.get('/diary/dates').then(r => r.data)
export const getAllEntries        = (tag) => api.get('/diary/all', { params: tag ? { tag } : {} }).then(r => r.data)
export const getEntriesForDate   = (date) => api.get(`/diary/date/${date}`).then(r => r.data)
export const createEntry         = (date) => api.post('/diary/', { date, content: '', tags: [] }).then(r => r.data)
export const updateEntry         = (id, data) => api.put(`/diary/${id}`, data).then(r => r.data)
export const deleteEntry         = (id) => api.delete(`/diary/${id}`)
export const searchDiary         = (q) => api.get(`/diary/search/${encodeURIComponent(q)}`).then(r => r.data)

// ── Objects ────────────────────────────────────────────────────────────────

export const listObjects         = (type) => api.get('/objects/', { params: type ? { type } : {} }).then(r => r.data)
export const getObject           = (id) => api.get(`/objects/${id}`).then(r => r.data)
export const createObject        = (data) => api.post('/objects/', data).then(r => r.data)
export const updateObject        = (id, data) => api.put(`/objects/${id}`, data).then(r => r.data)
export const deleteObject        = (id) => api.delete(`/objects/${id}`)
export const getMentions         = (id) => api.get(`/objects/${id}/mentions`).then(r => r.data)
export const mentionSearch       = (q) => api.get('/objects/mention-search', { params: { q } }).then(r => r.data)
export const searchObjects       = (q) => api.get('/objects/search', { params: { q } }).then(r => r.data)
export const mergeObjects        = (source_id, target_id) => api.post('/objects/merge', { source_id, target_id }).then(r => r.data)

// ── Tags ───────────────────────────────────────────────────────────────────

export const listTags            = () => api.get('/tags/').then(r => r.data)
export const renameTag           = (old_name, new_name) => api.put('/tags/rename', { old_name, new_name }).then(r => r.data)
export const deleteTag           = (name) => api.delete(`/tags/${encodeURIComponent(name)}`).then(r => r.data)

// ── Search ─────────────────────────────────────────────────────────────────

export const globalSearch        = (q) => api.get(`/search/${encodeURIComponent(q)}`).then(r => r.data)

// ── Export ─────────────────────────────────────────────────────────────────

export const getExportStatus     = () => api.get('/export/status').then(r => r.data)
export const runBackup           = () => api.post('/export/backup').then(r => r.data)
export const downloadBackup      = () => { window.location.href = '/api/export/download' }
export const importBackup        = (file) => {
  const form = new FormData()
  form.append('file', file)
  return api.post('/export/import', form, { headers: { 'Content-Type': 'multipart/form-data' } }).then(r => r.data)
}
export const importCapacities    = (file) => {
  const form = new FormData()
  form.append('file', file)
  return api.post('/export/import-capacities', form, { headers: { 'Content-Type': 'multipart/form-data' } }).then(r => r.data)
}
export const getEntryContext     = (entryId, objectId) =>
  api.get(`/diary/entry/${entryId}/context`, { params: { object_id: objectId } }).then(r => r.data)
