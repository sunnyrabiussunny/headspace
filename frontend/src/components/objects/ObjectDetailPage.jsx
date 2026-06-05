import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { getObject, updateObject, deleteObject, getMentions, mentionSearch, createObject } from '../../api'
import MentionPopup from '../diary/MentionPopup'
import toast from 'react-hot-toast'
import styles from './ObjectDetailPage.module.css'

const TYPE_META = {
  PERSON:       { emoji: '👤', color: '#c97c4e', bg: '#2d1f17' },
  PLACE:        { emoji: '📍', color: '#5b8def', bg: '#172030' },
  IDEA:         { emoji: '💡', color: '#e0c040', bg: '#2a2010' },
  ORGANIZATION: { emoji: '🏢', color: '#3dbfa0', bg: '#112620' },
}

export default function ObjectDetailPage() {
  const { id }                        = useParams()
  const navigate                      = useNavigate()
  const [obj, setObj]                 = useState(null)
  const [title, setTitle]             = useState('')
  const [notes, setNotes]             = useState('')
  const [backlinks, setBacklinks]     = useState([])
  const [mentionQuery, setMentionQuery]   = useState(null)
  const [mentionAnchor, setMentionAnchor] = useState(0)
  const [mentionResults, setMentionResults] = useState([])
  const saveTimer   = useRef(null)
  const notesRef    = useRef(null)
  const mdRef       = useRef('')
  const mentionMap  = useRef({})

  useEffect(() => {
    getObject(id).then(o => {
      setObj(o)
      setTitle(o.title)
      const { display, map } = markdownToDisplay(o.notes || '')
      setNotes(display)
      mdRef.current = o.notes || ''
      mentionMap.current = map
    }).catch(() => navigate('/objects'))

    getMentions(id).then(setBacklinks).catch(() => {})
  }, [id])

  // Fetch mention suggestions
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

  // Flush on unmount
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

    // Detect @ for mention popup
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

  const insertMention = useCallback((obj) => {
    const ta = notesRef.current
    if (!ta) return
    const cursor = ta.selectionStart
    const before = notes.slice(0, mentionAnchor)
    const after  = notes.slice(cursor)
    const displayMention = `@${obj.title}`
    const newDisplay = before + displayMention + ' ' + after

    mentionMap.current = {
      ...mentionMap.current,
      [mentionAnchor]: { display: obj.title, id: obj.id }
    }

    setNotes(newDisplay)
    mdRef.current = displayToMarkdown(newDisplay, mentionMap.current)
    setMentionQuery(null)
    setMentionResults([])
    triggerSave(title, mdRef.current)

    const newPos = before.length + displayMention.length + 1
    setTimeout(() => {
      ta.focus()
      ta.setSelectionRange(newPos, newPos)
    }, 0)
  }, [notes, mentionAnchor, title, triggerSave])

  const handleCreateAndInsert = useCallback(async (name, type) => {
    try {
      const newObj = await createObject({ type, title: name })
      insertMention(newObj)
    } catch { /* silent */ }
  }, [insertMention])

  const handleNotesKeyDown = useCallback((e) => {
    if (e.key === 'Escape') setMentionQuery(null)
  }, [])

  const handleDelete = async () => {
    if (!window.confirm('Delete this object? This cannot be undone.')) return
    await deleteObject(id)
    navigate('/objects')
  }

  if (!obj) return <div className={styles.loading}>Loading...</div>

  const meta = TYPE_META[obj.type] || TYPE_META.IDEA

  return (
    <div className={styles.page}>
      {/* Toolbar */}
      <div className={styles.toolbar}>
        <button className={styles.backBtn} onClick={() => navigate('/objects')}>
          <ArrowLeft />
        </button>
        <div className={styles.toolbarRight}>
          <button className="btn btn-danger" onClick={handleDelete}>Delete</button>
        </div>
      </div>

      {/* Type badge */}
      <div className={styles.typeRow}>
        <span className={styles.typeBadge} style={{ background: meta.bg, color: meta.color }}>
          {meta.emoji} {obj.type}
        </span>
      </div>

      {/* Title */}
      <input
        className={styles.titleInput}
        value={title}
        onChange={e => { setTitle(e.target.value); triggerSave(e.target.value, mdRef.current) }}
        placeholder="Title"
      />

      {/* Tags */}
      {obj.tags?.length > 0 && (
        <div className={styles.tagsRow}>
          <TagIcon />
          <span>{obj.tags.map(t => `#${t}`).join('  ')}</span>
        </div>
      )}

      <div className={styles.divider} />

      {/* Notes editor with @mention support */}
      <div style={{ position: 'relative', flex: 1 }}>
        <textarea
          ref={notesRef}
          className={styles.notesArea}
          value={notes}
          onChange={handleNotesChange}
          onKeyDown={handleNotesKeyDown}
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

      {/* Backlinks */}
      {backlinks.length > 0 && (
        <div className={styles.backlinks}>
          <div className={styles.divider} />
          <div className={styles.backlinksHeader}>
            <span>Backlinks</span>
            <span className={styles.blCount}>{backlinks.length}</span>
          </div>
          {backlinks.map(m => (
            <BacklinkRow key={m.id} mention={m} />
          ))}
        </div>
      )}
    </div>
  )
}

function BacklinkRow({ mention }) {
  const navigate = useNavigate()
  return (
    <button
      className={styles.blRow}
      onClick={() => navigate('/')}
    >
      <CalIcon />
      <div className={styles.blInfo}>
        <span className={styles.blDate}>{mention.created_at?.slice(0, 10)}</span>
        <span className={styles.blType}>{mention.source_type === 'diary' ? 'Diary entry' : 'Object notes'}</span>
      </div>
    </button>
  )
}

// ── Helpers (same as DiaryEditor) ─────────────────────────────────────────────

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

function ArrowLeft() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
}
function TagIcon() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>
}
function CalIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
}
