import React, { useState, useEffect } from 'react'
import { getCalendarEvents } from '../../api'
import styles from './CalendarEvents.module.css'

function fmtTime(iso) {
  const d = new Date(iso)
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

export default function CalendarEvents({ date }) {
  const [events, setEvents]   = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    getCalendarEvents(date).then(setEvents).catch(() => setEvents([])).finally(() => setLoading(false))
  }, [date])

  if (loading || events.length === 0) return null

  return (
    <div className={styles.wrap}>
      {events.map(e => (
        <div key={e.id} className={styles.event}>
          <span className={styles.dot} style={{ background: e.feed_color }} />
          <span className={styles.time}>
            {e.all_day ? 'All day' : fmtTime(e.start_time)}
          </span>
          <span className={styles.title}>{e.title}</span>
          {e.location && <span className={styles.location}>📍 {e.location}</span>}
        </div>
      ))}
    </div>
  )
}
