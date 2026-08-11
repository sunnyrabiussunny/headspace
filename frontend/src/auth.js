const TOKEN_KEY = 'headspace_token'
const USER_KEY = 'headspace_user'

export const getToken = () => localStorage.getItem(TOKEN_KEY)
export const setToken = (token) => localStorage.setItem(TOKEN_KEY, token)
export const clearToken = () => localStorage.removeItem(TOKEN_KEY)

export const getStoredUser = () => {
  try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null') } catch { return null }
}
export const setStoredUser = (user) => localStorage.setItem(USER_KEY, JSON.stringify(user))
export const clearStoredUser = () => localStorage.removeItem(USER_KEY)

export function logout() {
  clearToken()
  clearStoredUser()
  window.location.href = '/login'
}

/** Wire an axios instance to send the bearer token and to log out on 401. */
export function attachAuth(instance) {
  instance.interceptors.request.use((config) => {
    const token = getToken()
    if (token) config.headers.Authorization = `Bearer ${token}`
    return config
  })
  instance.interceptors.response.use(
    (res) => res,
    (err) => {
      if (err?.response?.status === 401 && window.location.pathname !== '/login') {
        clearToken()
        clearStoredUser()
        window.location.href = '/login'
      }
      return Promise.reject(err)
    }
  )
  return instance
}
