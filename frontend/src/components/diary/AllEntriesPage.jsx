import React, { useState, useEffect, useCallback } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import toast from 'react-hot-toast'
import { getAllEntries, deleteEntry } from '../../api'
import DiaryEditor from './DiaryEditor'
import { renderRichContent } from './renderRichContent'
import styles from './AllEntriesPage.module.css'

export default function AllEntriesPage() {
  const location   = useLocation()
  const [entries,   setEntries]   = useState([])
  const [activeTag, setActiveTag] = useState(
    new URLSearchParams(location.search).get('tag') || null
  )
  const [viewingId, setViewingId] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [loading,   setLoading]   = useState(true)
  const navigate = useNavigate()

  // Sync activeTag when URL changes
  useEffect(() => {
    const tag = new URLSearchParams(location.search).get('tag') || null
    setActiveTag(tag)
  }, [location.search])

  const load = useCallback(async () => {
    setLoading(true)
    try { setEntries(await getAllEntries(activeTag)) }
    catch { toast.error('Failed to load entries') }
    finally { setLoading(false) }
  }, [activeTag])

  useEffect(() => { load() }, [load])

  const handleSaved = (updated) => {
    const old = entries.find(e => e.id === updated.id)
    if (old && old.date !== updated.date) {
      load(); setEditingId(null); setViewingId(null)
    } else {
      setEntries(prev => prev.map(e => e.id === updated.id ? updated : e))
      setEditingId(null)
      setViewingId(updated.id)
    }
  }

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this entry?')) return
    try {
      await deleteEntry(id)
      setEntries(prev => prev.filter(e => e.id !== id))
      setViewingId(null); setEditingId(null)
    } catch { toast.error('Failed to delete') }
  }

  const grouped = entries.reduce((acc, e) => {
    if (!acc[e.date]) acc[e.date] = []
    acc[e.date].push(e)
    return acc
  }, {})
  const dates = Object.keys(grouped).sort((a, b) => b.localeCompare(a))

  // ── EDIT MODE ──────────────────────────────────────────────────────────
  if (editingId) {
    const entry = entries.find(e => e.id === editingId)
    if (entry) return (
      <div className={styles.fullscreenEditor}>
        <div className={styles.editorTopBar}>
          <button className={styles.backBtn}
            onClick={() => { setEditingId(null); setViewingId(entry.id) }}>
            ← Back to entry
          </button>
          <span className={styles.editorDate}>
            {format(parseISO(entry.date), 'd MMMM yyyy')}
          </span>
        </div>
        <DiaryEditor
          entry={entry}
          onSave={handleSaved}
          onClose={() => { setEditingId(null); setViewingId(entry.id) }}
          onDelete={() => handleDelete(entry.id)}
        />
      </div>
    )
  }

  // ── READ VIEW ──────────────────────────────────────────────────────────
  if (viewingId) {
    const entry = entries.find(e => e.id === viewingId)
    if (entry) {
      let timeStr = ''
      try { if (entry.created_at) timeStr = format(parseISO(entry.created_at), 'h:mm a') } catch {}
      const cleanTags = (entry.tags || []).filter(
        t => !t.startsWith('-') && !t.includes('--') && t.length < 40
      )
      return (
        <div className={styles.readPage}>
          <div className={styles.readTopBar}>
            <button className={styles.backBtn} onClick={() => setViewingId(null)}>
              ← Entries
            </button>
            <button className={styles.editBtn} onClick={() => setEditingId(entry.id)}>
              ✏️ Edit
            </button>
          </div>

          <div className={styles.readCard}>
            <div className={styles.readMeta}>
              <span className={styles.readDate}>
                {format(parseISO(entry.date), 'EEEE, d MMMM yyyy')}
              </span>
              {timeStr && <span className={styles.readTime}>{timeStr}</span>}
            </div>

            {/* Content — each paragraph rendered separately so pre-wrap works correctly */}
            <div className={styles.readContent}>
              {entry.content
                ? entry.content.split('\n').map((line, i) => (
                    <p key={i} className={styles.readLine}>
                      {renderRichContent(line, {
                        navigate,
                        onTagClick: (tag) => { setViewingId(null); setActiveTag(tag) }
                      }) || (line ? line : <br />)}
                    </p>
                  ))
                : <span className={styles.emptyNote}>Empty — click Edit to write.</span>
              }
            </div>

            {cleanTags.length > 0 && (
              <div className={styles.readTags}>
                {cleanTags.map(t => (
                  <span key={t} className={styles.tagPill}
                    onClick={() => { setViewingId(null); setActiveTag(t) }}>
                    #{t}
                  </span>
                ))}
              </div>
            )}

            <div className={styles.readActions}>
              <button className={styles.editBtn} onClick={() => setEditingId(entry.id)}>
                ✏️ Edit entry
              </button>
              <button className={styles.delBtn} onClick={() => handleDelete(entry.id)}>
                🗑 Delete
              </button>
            </div>
          </div>
        </div>
      )
    }
  }

  // ── GRID VIEW ──────────────────────────────────────────────────────────
  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Entries</h1>
        <span className={styles.count}>
          {loading ? '…' : `${entries.length} entries`}
        </span>
        {activeTag && (
          <span className={styles.filterBadge}>
            #{activeTag}
            <button className={styles.clearFilter} onClick={() => setActiveTag(null)}>×</button>
          </span>
        )}
      </div>

      {loading ? (
        <div className={styles.empty}>Loading...</div>
      ) : entries.length === 0 ? (
        <div className={styles.empty}>
          {activeTag ? `No entries tagged #${activeTag}.` : 'No diary entries yet.'}
        </div>
      ) : (
        <div className={styles.feed}>
          {dates.map(date => (
            <div key={date} className={styles.dateGroup}>
              <div className={styles.dateLabel}>
                <span className={styles.dateBadge}>
                  {format(parseISO(date), 'EEEE, d MMMM yyyy')}
                </span>
                <span className={styles.dateDayCount}>{grouped[date].length}</span>
              </div>
              <div className={styles.cardGrid}>
                {grouped[date].map(entry => {
                  let timeStr = ''
                  try { if (entry.created_at) timeStr = format(parseISO(entry.created_at), 'h:mm a') } catch {}
                  const cleanTags = (entry.tags || []).filter(
                    t => !t.startsWith('-') && !t.includes('--') && t.length < 40
                  )
                  return (
                    <div key={entry.id} className={styles.card}>
                      {/* Top bar — time + delete (clicking this area opens the entry) */}
                      <div className={styles.cardHeader}
                        onClick={() => setViewingId(entry.id)}
                        style={{ cursor:'pointer' }}>
                        <span className={styles.cardTime}>{timeStr || 'Entry'}</span>
                        <button className={styles.cardDel} title="Delete"
                          onClick={e => { e.stopPropagation(); handleDelete(entry.id) }}>
                          ×
                        </button>
                      </div>

                      {/* Content preview — clicking links works; clicking blank space opens entry */}
                      <div className={styles.cardPreviewArea}
                        onClick={() => setViewingId(entry.id)}>
                        <p className={styles.cardPreview}>
                          {/* Render rich content — @mention clicks navigate to objects */}
                          {renderRichContent(entry.content, {
                            navigate,
                            onTagClick: (tag) => setActiveTag(tag)
                          }) || <span className={styles.emptyNote}>Empty note</span>}
                        </p>
                      </div>

                      {cleanTags.length > 0 && (
                        <div className={styles.cardTagRow}>
                          {cleanTags.slice(0, 3).map(t => (
                            <span key={t} className={styles.cardTag}
                              onClick={e => { e.stopPropagation(); setActiveTag(t) }}>
                              #{t}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* Open button — always-visible tap target */}
                      <button className={styles.cardOpenBtn}
                        onClick={() => setViewingId(entry.id)}>
                        Open ↗
                      </button>
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
