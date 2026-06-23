import React, { useState, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { globalSearch } from '../api'
import styles from './GlobalSearch.module.css'

export default function GlobalSearch() {
  const [query,   setQuery]   = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [open,    setOpen]    = useState(false)
  const timer  = useRef(null)
  const inputRef = useRef(null)
  const navigate = useNavigate()

  const handleChange = useCallback((e) => {
    const q = e.target.value
    setQuery(q)
    clearTimeout(timer.current)
    if (!q.trim()) { setResults([]); setOpen(false); return }
    setLoading(true)
    setOpen(true)
    timer.current = setTimeout(async () => {
      try {
        const r = await globalSearch(q.trim())
        setResults(r)
      } catch {}
      finally { setLoading(false) }
    }, 280)
  }, [])

  const clear = () => { setQuery(''); setResults([]); setOpen(false) }

  const pick = (r) => {
    clear()
    if (r.type === 'diary') navigate('/', { state: { targetDate: r.date } })
    else navigate(`/objects/${r.id}`)
  }

  const TYPE_EMOJI = { PERSON:'👤', PLACE:'📍', IDEA:'💡', ORGANIZATION:'🏢', MEDIA:'🎬' }

  return (
    <div className={styles.wrap}>
      <div className={styles.bar}>
        <SearchIcon />
        <input
          ref={inputRef}
          className={styles.input}
          placeholder="Search diary and objects..."
          value={query}
          onChange={handleChange}
          onKeyDown={e => e.key === 'Escape' && clear()}
          onFocus={() => query && setOpen(true)}
        />
        {query && (
          <button className={styles.clearBtn} onClick={clear}><XIcon /></button>
        )}
      </div>

      {open && query && (
        <>
          <div className={styles.backdrop} onClick={clear} />
          <div className={styles.dropdown}>
            {loading && <div className={styles.hint}>Searching…</div>}
            {!loading && results.length === 0 && (
              <div className={styles.hint}>No results for "{query}"</div>
            )}
            {results.map(r => (
              <button key={r.id} className={styles.row} onClick={() => pick(r)}>
                <span className={styles.rowIcon}>
                  {r.type === 'diary' ? '📅' : (TYPE_EMOJI[r.object_type] || '📄')}
                </span>
                <div className={styles.rowInfo}>
                  <span className={styles.rowTitle}>{r.title}</span>
                  {r.preview && <span className={styles.rowPreview}>{r.preview}</span>}
                </div>
                <span className={styles.rowMeta}>
                  {r.type === 'diary' ? r.date : r.object_type}
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function SearchIcon() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
}
function XIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
}
