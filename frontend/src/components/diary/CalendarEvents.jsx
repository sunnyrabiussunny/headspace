import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { getCalendarEvents, importCalendarToDiary } from '../../api'
import { renderRichContent } from './renderRichContent'
import styles from './CalendarEvents.module.css'

function fmtTime(iso) {
  const d = new Date(iso)
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

// onImported: called after a manual (or auto) import adds entries, so the
// parent (DiaryPage) can refresh its entries list.
export default function CalendarEvents({ date, onImported }) {
  const [events, setEvents]     = useState([])
  const [loading, setLoading]   = useState(true)
  const [importing, setImporting] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    setLoading(true)
    getCalendarEvents(date).then(setEvents).catch(() => setEvents([])).finally(() => setLoading(false))
  }, [date])

  const handleImportNow = async () => {
    setImporting(true)
    try {
      const res = await importCalendarToDiary(date)
      if (res.imported > 0) {
        toast.success(`Imported ${res.imported} event${res.imported === 1 ? '' : 's'} into the diary`)
        onImported?.()
      } else {
        toast('All of today\'s events are already in the diary', { icon: 'ℹ️' })
      }
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Import failed')
    } finally {
      setImporting(false)
    }
  }

  if (loading || events.length === 0) return null

  return (
    <div className={styles.wrap}>
      {events.map(e => (
        <div key={e.id} className={styles.event}>
          <span className={styles.dot} style={{ background: e.feed_color }} />
          <span className={styles.time}>
            {e.all_day ? 'All day' : fmtTime(e.start_time)}
          </span>
          <span className={styles.title}>
            {renderRichContent(e.title_tagged || e.title, { navigate }) || e.title}
          </span>
          {e.location && <span className={styles.location}>📍 {e.location}</span>}
        </div>
      ))}
      <button className={styles.importBtn} onClick={handleImportNow} disabled={importing}
        title="Turn these calendar events into diary entries now">
        📥 {importing ? 'Importing…' : 'Import to Diary'}
      </button>
    </div>
  )
}
