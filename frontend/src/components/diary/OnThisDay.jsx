import React, { useState, useEffect } from 'react'
import { getOnThisDay } from '../../api'
import styles from './OnThisDay.module.css'

function stripMentions(text) {
  return (text || '').replace(/@\[([^\]]+)\]\([^)]+\)/g, '@$1')
}

export default function OnThisDay({ date, onJump }) {
  const [entries, setEntries] = useState([])
  const [open, setOpen]       = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    getOnThisDay(date).then(setEntries).catch(() => setEntries([])).finally(() => setLoading(false))
  }, [date])

  if (loading || entries.length === 0) return null

  return (
    <div className={styles.wrap}>
      <button className={styles.header} onClick={() => setOpen(v => !v)}>
        <span className={styles.title}>📅 On This Day</span>
        <span className={styles.count}>{entries.length} year{entries.length > 1 ? 's' : ''} back</span>
        <span className={styles.chev}>{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className={styles.list}>
          {entries.map(e => (
            <button key={e.id} className={styles.card} onClick={() => onJump?.(e.date)}>
              <span className={styles.yearsAgo}>{e.years_ago} year{e.years_ago > 1 ? 's' : ''} ago · {e.year}</span>
              <span className={styles.snippet}>{stripMentions(e.content).slice(0, 160)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
