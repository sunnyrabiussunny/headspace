import axios from 'axios'

const api = axios.create({ baseURL: '/api' })

export const listBoxes      = () => api.get('/board/boxes').then(r => r.data)
export const createBox      = (data) => api.post('/board/boxes', data).then(r => r.data)
export const updateBox      = (id, data) => api.put(`/board/boxes/${id}`, data).then(r => r.data)
export const bringBoxFront  = (id) => api.post(`/board/boxes/${id}/front`).then(r => r.data)
export const deleteBox      = (id) => api.delete(`/board/boxes/${id}`)

export const createItem     = (boxId, text) => api.post(`/board/boxes/${boxId}/items`, { text }).then(r => r.data)
export const updateItem     = (id, data) => api.put(`/board/items/${id}`, data).then(r => r.data)
export const deleteItem     = (id) => api.delete(`/board/items/${id}`)
