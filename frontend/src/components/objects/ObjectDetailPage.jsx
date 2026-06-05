import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { getObject, updateObject, deleteObject, getMentions, mentionSearch, createObject, getEntriesForDate } from '../../api'
import MentionPopup from '../diary/MentionPopup'
import styles from './ObjectDetailPage.module.css'

const TYPE_META = {
  PERSON:       { emoji: '👤', color: '#c97c4e', bg: '#2d1f17' },
  PLACE:        { emoji: '📍', color: '#5b8def', bg: '#172030' },
  IDEA:         { emoji: '💡', color: '#e0c040', bg: '#2a2010' },
  ORGANIZATION: { emoji: '🏢', color: '#3dbfa0', bg: '#112620' },
}

export default function ObjectDetailPage() {
  const { id }                            = useParams()
  const navigate                          = useNavigate()
  const [obj, setObj]                     = useState(null)
  const [title, setTitle]                 = useState('')
  const [notes, setNotes]                 = useState('')
  const [backlinks, setBacklinks]         = useState([])  // enriched backlink items
  const [mentionQuery, setMentionQuery]   = useState(null)
  const [mentionAnchor, setMentionAnchor] = useState(0)
  const [mentionResults, setMentionResults] = useState([])
  const saveTimer  = useRef(null)
  const notesRef   = useRef(null)
  const mdRef      = useRef('')
  const mentionMap = useRef({})

  // Load object
  useEffect(() => {
    getObject(id).then(o => {
      setObj(o)
      setTitle(o.title)
      const { display, map } = markdownToDisplay(o.notes || '')
      setNotes(display)
      mdRef.current = o.notes || ''
      mentionMap.current = map
    }).catch(() => navigate('/objects'))
  }, [id])

  // Load and enrich backlinks — both diary AND object sources
  useEffect(() => {
    getMentions(id).then(async (mentions) => {
      const enriched = await Promise.all(
        mentions.map(async (m) => {
          if (m.source_type === 'diary') {
            // Find the diary entry to get its date
            try {
              // source_id is the entry id — fetch it via search workaround
              // We store entry id in source_id, so we call the diary endpoint
              const res = await fetch(`/api/diary/entry/${m.source_id}`)
              if (res.ok) {
                const entry = await res.json()
                return {
                  id: m.id,
                  source_type: 'diary',
                  source_id: m.source_id,
                  date: entry.date,
                  label: entry.date,
                  preview: entry.content
                    ?.replace(/@\[([^\]]+)\]\([^)]+\)/g, '@$1')
                    ?.slice(0, 100) || '',
                  created_at: m.created_at,
                }
              }
            } catch { /* fall through */ }
            // Fallback: use mention created_at date
            return {
              id: m.id,
              source_type: 'diary',
              source_id: m.source_id,
              date: m.created_at?.slice(0, 10),
              label: m.created_at?.slice(0, 10) || 'Diary entry',
              preview: '',
              created_at: m.created_at,
            }
          } else if (m.source_type === 'object') {
            // Fetch the source object's title
            try {
              const res = await fetch(`/api/objects/${m.source_id}`)
              if (res.ok) {
                const sourceObj = await res.json()
                return {
                  id: m.id,
                  source_type: 'object',
                  source_id: m.source_id,
                  date: null,
                  label: sourceObj.title,
                  objectType: sourceObj.type,
                  preview: sourceObj.notes
                    ?.replace(/@\[([^\]]+)\]\([^)]+\)/g, '@$1')
                    ?.slice(0, 100) || '',
                  created_at: m.created_at,
                }
              }
            } catch { /* fall through */ }
            return {
              id: m.id,
              source_type: 'object',
              source_id: m.source_id,
              date: null,
              label: 'Object',
              preview: '',
              created_at: m.created_at,
            }
          }
          return null
        })
      )
      setBacklinks(enriched.filter(Boolean))
    }).catch(() => {})
  }, [id])

  // Mention suggestions
  useEffect(() => {
    if (mentionQuery === null) { setMentionResults([]); return }
    mentionSearch(mentionQuery).then(setMentionResults).catch(() => setMentionResults([]))
  }, [mentionQuery])

  const triggerSave = useCallback((newTitle, newNotes) => {
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      try {
        const updated = await updateObject(id, {
          title: newTitle.trim() || 'Untitled',
          notes: newNotes,
        })
        setObj(updated)
      } catch { /* silent */ }
    }, 600)
  }, [id])

  useEffect(() => {
    return () => {
      clearTimeout(saveTimer.current)
      updateObject(id, { title: title.trim() || 'Untitled', notes: mdRef.current }).catch(() => {})
    }
  }, [id, title])

  const handleNotesChange = useCallback((e) => {
    const value = e.target.value
    setNotes(value)
    mdRef.current = displayToMarkdown(value, mentionMap.current)
    triggerSave(title, mdRef.current)

    const cursor = e.target.selectionStart
    const textBefore = value.slice(0, cursor)
    const atIdx = textBefore.lastIndexOf('@')
    if (atIdx >= 0) {
      const fragment = textBefore.slice(atIdx + 1)
      if (!fragment.includes(' ') && !fragment.includes('\n')) {
        setMentionAnchor(atIdx)
        setMentionQuery(fragment)
        return
      }
    }
    setMentionQuery(null)
  }, [title, triggerSave])

  const insertMention = useCallback((selectedObj) => {
    const ta = notesRef.current
    if (!ta) return
    const cursor = ta.selectionStart
    const before = notes.slice(0, mentionAnchor)
    const after  = notes.slice(cursor)
    const displayMention = `@${selectedObj.title}`
    const newDisplay = before + displayMention + ' ' + after

    mentionMap.current = {
      ...mentionMap.current,
      [mentionAnchor]: { display: selectedObj.title, id: selectedObj.id }
    }

    setNotes(newDisplay)
    mdRef.current = displayToMarkdown(newDisplay, mentionMap.current)
    setMentionQuery(null)
    setMentionResults([])
    triggerSave(title, mdRef.current)

    const newPos = before.length + displayMention.length + 1
    setTimeout(() => { ta.focus(); ta.setSelectionRange(newPos, newPos) }, 0)
  }, [notes, mentionAnchor, title, triggerSave])

  const handleCreateAndInsert = useCallback(async (name, type) => {
    try {
      const newObj = await createObject({ type, title: name })
      insertMention(newObj)
    } catch { /* silent */ }
  }, [insertMention])

  const handleBacklinkClick = useCallback((item) => {
    if (item.source_type === 'diary' && item.date) {
      // Navigate to diary with the CORRECT date via state
      navigate('/', { state: { targetDate: item.date } })
    } else if (item.source_type === 'object') {
      navigate(`/objects/${item.source_id}`)
    }
  }, [navigate])

  const handleDelete = async () => {
    if (!window.confirm('Delete this object? This cannot be undone.')) return
    await deleteObject(id)
    navigate('/objects')
  }

  if (!obj) return <div className={styles.loading}>Loading...</div>

  const meta = TYPE_META[obj.type] || TYPE_META.IDEA

  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <button className={styles.backBtn} onClick={() => navigate('/objects')}>
          <ArrowLeft />
        </button>
        <div className={styles.toolbarRight}>
          <button className="btn btn-danger" onClick={handleDelete}>Delete</button>
        </div>
      </div>

      <div className={styles.typeRow}>
        <span className={styles.typeBadge} style={{ background: meta.bg, color: meta.color }}>
          {meta.emoji} {obj.type}
        </span>
      </div>

      <input
        className={styles.titleInput}
        value={title}
        onChange={e => { setTitle(e.target.value); triggerSave(e.target.value, mdRef.current) }}
        placeholder="Title"
      />

      {obj.tags?.length > 0 && (
        <div className={styles.tagsRow}>
          <TagIcon />
          <span>{obj.tags.map(t => `#${t}`).join('  ')}</span>
        </div>
      )}

      <div className={styles.divider} />

      <div style={{ position: 'relative', flex: 1, display: 'flex', flexDirection: 'column' }}>
        <textarea
          ref={notesRef}
          className={styles.notesArea}
          value={notes}
          onChange={handleNotesChange}
          onKeyDown={e => e.key === 'Escape' && setMentionQuery(null)}
          placeholder="Notes... (type @ to link another object)"
        />
        {mentionQuery !== null && (
          <MentionPopup
            query={mentionQuery}
            results={mentionResults}
            onSelect={insertMention}
            onCreate={handleCreateAndInsert}
            onDismiss={() => setMentionQuery(null)}
          />
        )}
      </div>

      {/* Backlinks — both diary and object sources */}
      {backlinks.length > 0 && (
        <div className={styles.backlinks}>
          <div className={styles.divider} />
          <div className={styles.backlinksHeader}>
            <span>Backlinks</span>
            <span className={styles.blCount}>{backlinks.length}</span>
          </div>
          {backlinks.map(item => (
            <button
              key={item.id}
              className={styles.blRow}
              onClick={() => handleBacklinkClick(item)}
            >
              <span className={styles.blIcon}>
                {item.source_type === 'diary' ? <CalIcon /> : <LayersIcon />}
              </span>
              <div className={styles.blInfo}>
                <span className={styles.blLabel}>
                  {item.source_type === 'diary' ? item.label : item.label}
                </span>
                <span className={styles.blType}>
                  {item.source_type === 'diary' ? 'Diary entry' : `Object — ${item.objectType || ''}`}
                </span>
                {item.preview && (
                  <span className={styles.blPreview}>{item.preview}</span>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function markdownToDisplay(content) {
  const map = {}
  const display = content.replace(/@\[([^\]]+)\]\(([^)]+)\)/g, (_, name) => `@${name}`)
  return { display, map }
}

function displayToMarkdown(display, mentionMap) {
  let result = display
  const entries = Object.entries(mentionMap).sort((a, b) => Number(b[0]) - Number(a[0]))
  for (const [_, { display: name, id }] of entries) {
    const displayToken = `@${name}`
    const mdToken = `@[${name}](${id})`
    if (result.includes(displayToken) && !result.includes(mdToken)) {
      result = result.replace(displayToken, mdToken)
    }
  }
  return result
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function ArrowLeft() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
}
function TagIcon() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>
}
function CalIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
}
function LayersIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>
}
