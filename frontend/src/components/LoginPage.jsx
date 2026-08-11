import React, { useState } from 'react'
import { login } from '../api_auth'
import logoImg from '../assets/logo.png'
import styles from './LoginPage.module.css'

export default function LoginPage({ onLoggedIn }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    if (!username.trim() || !password) return
    setLoading(true)
    setError('')
    try {
      const user = await login(username.trim().toLowerCase(), password)
      onLoggedIn(user)
    } catch (err) {
      setError(err?.response?.data?.detail || 'Incorrect username or password')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={styles.wrap}>
      <form className={styles.card} onSubmit={submit}>
        <img src={logoImg} alt="Headspace" className={styles.logo} />
        <h1 className={styles.title}>Headspace</h1>
        <p className={styles.subtitle}>Sign in to your account</p>

        <input
          className={styles.input}
          type="text"
          placeholder="Username"
          value={username}
          autoCapitalize="none"
          autoCorrect="off"
          onChange={e => setUsername(e.target.value)}
          autoFocus
        />
        <input
          className={styles.input}
          type="password"
          placeholder="Password"
          value={password}
          onChange={e => setPassword(e.target.value)}
        />

        {error && <div className={styles.error}>{error}</div>}

        <button className={styles.submitBtn} type="submit" disabled={loading}>
          {loading ? 'Signing in…' : 'Sign in'}
        </button>

        <p className={styles.hint}>
          Each account has its own completely separate diary, objects, board, and habits.
        </p>
      </form>
    </div>
  )
}
