import axios from 'axios'
import { attachAuth, setToken, setStoredUser } from './auth'

const api = attachAuth(axios.create({ baseURL: '/api/auth' }))

export async function login(username, password) {
  const { data } = await api.post('/login', { username, password })
  setToken(data.token)
  setStoredUser(data.user)
  return data.user
}

export const me         = () => api.get('/me').then(r => r.data)
export const listUsers  = () => api.get('/users').then(r => r.data)
export const createUser = (payload) => api.post('/users', payload).then(r => r.data)
export const changePassword = (payload) => api.put('/me/password', payload).then(r => r.data)
