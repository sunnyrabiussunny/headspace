import React, { useState, useEffect, useCallback } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import toast from 'react-hot-toast'
import { getAllEntries, deleteEntry } from '../../api'
import DiaryEditor from './DiaryEditor'
import styles from './AllEntriesPage.module.css'

const CLEAN_RE = /@\[([^\]]+)\]\([^)]+\)/g

function plainText(content) {
  if (!content || !content.trim()) return ''
  return content
    .replace(CLEAN_RE, '@$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/#{1,6}\s/g, '')
    .trim()
}

export default function AllEntriesPage() {
  const location = useLocation()
  const initialTag = new URLSearchParams(location.search).get('tag') || null
  const [entries, setEntries]     = useState([])
  const [activeTag, setActiveTag] = useState(initialTag)
  const [editingId, setEditingId] = useState(null)
  const [loading, setLoading]     = useState(true)
  const navigate = useNavigate()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const e = await getAllEntries(activeTag)
      setEntries(e)
    } catch {
      toast.error('Failed to load entries')
    } finally {
      setLoading(false)
    }
  }, [activeTag])

  useEffect(() => { load() }, [load])

  const handleSaved = (updated) => {
    const old = entries.find(e => e.id === updated.id)
    if (old && old.date !== updated.date) {
      load(); setEditingId(null)
    } else {
      setEntries(prev => prev.map(e => e.id === updated.id ? updated : e))
    }
  }

  const handleDelete = async (id) => {
    try {
      await deleteEntry(id)
      setEntries(prev => prev.filter(e => e.id !== id))
      if (editingId === id) setEditingId(null)
    } catch { toast.error('Failed to delete') }
  }

  // Group by date
  const grouped = entries.reduce((acc, entry) => {
    if (!acc[entry.date]) acc[entry.date] = []
    acc[entry.date].push(entry)
    return acc
  }, {})
  const dates = Object.keys(grouped).sort((a, b) => b.localeCompare(a))

  // Full-screen editor when editing
  if (editingId) {
    const entry = entries.find(e => e.id === editingId)
    if (entry) return (
      <div className={styles.editorWrap}>
        <button className={styles.backBtn} onClick={() => setEditingId(null)}>
          ← All Entries
        </button>
        <DiaryEditor
          entry={entry}
          onSave={handleSaved}
          onClose={() => setEditingId(null)}
          onDelete={() => handleDelete(entry.id)}
        />
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>All Entries</h1>
        <span className={styles.count}>
          {loading ? '…' : `${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}`}
        </span>
      </div>

      {loading ? (
        <div className={styles.empty}>Loading...</div>
      ) : entries.length === 0 ? (
        <div className={styles.empty}>No diary entries yet. Start writing on the Diary page.</div>
      ) : (
        <div className={styles.feed}>
          {dates.map(date => (
            <div key={date} className={styles.dateGroup}>
              <div className={styles.dateLabel}>
                <span className={styles.dateBadge}>
                  {format(parseISO(date), 'EEEE, d MMMM yyyy')}
                </span>
                <span className={styles.dateDayCount}>
                  {grouped[date].length}
                </span>
              </div>

              <div className={styles.cardGrid}>
                {grouped[date].map(entry => {
                  const preview = plainText(entry.content)
                  let timeStr = ''
                  try {
                    if (entry.created_at) timeStr = format(parseISO(entry.created_at), 'h:mm a')
                  } catch {}

                  return (
                    <div
                      key={entry.id}
                      className={styles.card}
                      onClick={() => setEditingId(entry.id)}
                    >
                      <div className={styles.cardHeader}>
                        <span className={styles.cardTime}>{timeStr}</span>
                        <button
                          className={styles.cardDel}
                          title="Delete"
                          onClick={e => { e.stopPropagation(); handleDelete(entry.id) }}
                        >
                          <TrashIcon />
                        </button>
                      </div>
                      <p className={styles.cardPreview}>
                        {preview
                          ? preview
                          : <span className={styles.emptyNote}>Empty note</span>
                        }
                      </p>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function TrashIcon() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
}
