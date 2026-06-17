import React, { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import toast from 'react-hot-toast'
import { getAllEntries, listTags, deleteEntry } from '../../api'
import DiaryEditor from './DiaryEditor'
import styles from './AllEntriesPage.module.css'

const MENTION_RE = /@\[([^\]]+)\]\(([^)]+)\)/g

function renderContent(content, navigate) {
  if (!content || !content.trim()) return <span style={{ color: 'var(--text-muted)' }}>Empty entry</span>
  const parts = []
  let last = 0
  MENTION_RE.lastIndex = 0
  let m
  while ((m = MENTION_RE.exec(content)) !== null) {
    if (m.index > last) parts.push(<span key={`t${last}`}>{content.slice(last, m.index)}</span>)
    const name = m[1], objId = m[2]
    parts.push(
      <span key={`m${m.index}`} className={styles.mentionLink}
        onClick={e => { e.stopPropagation(); navigate(`/objects/${objId}`) }}>
        {name}
      </span>
    )
    last = m.index + m[0].length
  }
  if (last < content.length) parts.push(<span key={`t${last}`}>{content.slice(last)}</span>)
  return parts
}

export default function AllEntriesPage() {
  const [entries, setEntries]       = useState([])
  const [tags, setTags]             = useState([])
  const [activeTag, setActiveTag]   = useState(null)
  const [editingId, setEditingId]   = useState(null)
  const [loading, setLoading]       = useState(true)
  const navigate = useNavigate()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const e = await getAllEntries(activeTag)
      setEntries(e)
    } catch { toast.error('Failed to load entries') }
    try {
      const t = await listTags()
      setTags(t)
    } catch { /* tags non-critical */ }
    finally { setLoading(false) }
  }, [activeTag])

  useEffect(() => { load() }, [load])

  const handleSaved = (updated) => {
    setEntries(prev => prev.map(e => e.id === updated.id ? updated : e))
  }

  const handleDelete = async (id) => {
    try {
      await deleteEntry(id)
      setEntries(prev => prev.filter(e => e.id !== id))
      if (editingId === id) setEditingId(null)
    } catch { toast.error('Failed to delete') }
  }

  // Group entries by date
  const grouped = entries.reduce((acc, entry) => {
    const d = entry.date
    if (!acc[d]) acc[d] = []
    acc[d].push(entry)
    return acc
  }, {})
  const dates = Object.keys(grouped).sort((a, b) => b.localeCompare(a))

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>All Entries</h1>
        <span className={styles.count}>{entries.length} entries</span>
      </div>

      {/* Tag filter chips */}
      {tags.length > 0 && (
        <div className={styles.tagChips}>
          <button
            className={`${styles.tagChip} ${!activeTag ? styles.tagChipActive : ''}`}
            onClick={() => setActiveTag(null)}
          >All</button>
          {tags.map(t => (
            <button
              key={t.name}
              className={`${styles.tagChip} ${activeTag === t.name ? styles.tagChipActive : ''}`}
              onClick={() => setActiveTag(activeTag === t.name ? null : t.name)}
            >
              #{t.name} <span className={styles.tagCount}>{t.diary_count}</span>
            </button>
          ))}
        </div>
      )}

      <div className={styles.divider} />

      {loading ? (
        <div className={styles.empty}>Loading...</div>
      ) : dates.length === 0 ? (
        <div className={styles.empty}>No entries found.</div>
      ) : (
        <div className={styles.feed}>
          {dates.map(date => (
            <div key={date} className={styles.dateGroup}>
              <div className={styles.dateLabel}>
                <span className={styles.dateBadge}>
                  {format(parseISO(date), 'EEEE, d MMMM yyyy')}
                </span>
              </div>
              {grouped[date].map(entry =>
                editingId === entry.id ? (
                  <DiaryEditor
                    key={entry.id}
                    entry={entry}
                    onSave={handleSaved}
                    onClose={() => setEditingId(null)}
                    onDelete={() => handleDelete(entry.id)}
                  />
                ) : (
                  <div key={entry.id} className={styles.entryCard} onClick={() => setEditingId(entry.id)}>
                    <div className={styles.entryMeta}>
                      <span className={styles.entryTime}>
                        {entry.created_at ? format(parseISO(entry.created_at), 'h:mm a') : ''}
                      </span>
                      <button className={styles.delBtn}
                        onClick={e => { e.stopPropagation(); handleDelete(entry.id) }}
                        title="Delete">
                        <TrashIcon />
                      </button>
                    </div>
                    <p className={styles.entryContent}>{renderContent(entry.content, navigate)}</p>
                    {entry.tags?.length > 0 && (
                      <div className={styles.entryTags}>
                        {entry.tags.map(t => (
                          <span key={t} className={styles.tagPill}
                            onClick={e => { e.stopPropagation(); setActiveTag(t) }}>
                            #{t}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function TrashIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
}
