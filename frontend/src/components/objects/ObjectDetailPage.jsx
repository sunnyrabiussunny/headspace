import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { getObject, updateObject, deleteObject, getMentions, mentionSearch, createObject, getEntryContext } from '../../api'
import styles from './ObjectDetailPage.module.css'

const MENTION_RE = /@\[([^\]]+)\]\(([^)]+)\)/g
const TYPE_META = {
  PERSON:       { emoji: '👤', color: '#c97c4e', bg: '#2d1f17' },
  PLACE:        { emoji: '📍', color: '#5b8def', bg: '#172030' },
  IDEA:         { emoji: '💡', color: '#e0c040', bg: '#2a2010' },
  ORGANIZATION: { emoji: '🏢', color: '#3dbfa0', bg: '#112620' },
}
const TYPE_EMOJI = { PERSON: '👤', PLACE: '📍', IDEA: '💡', ORGANIZATION: '🏢' }

function parseMd(md) {
  const segs = []
  let last = 0
  MENTION_RE.lastIndex = 0
  let m
  while ((m = MENTION_RE.exec(md)) !== null) {
    if (m.index > last) segs.push({ type: 'text', val: md.slice(last, m.index) })
    segs.push({ type: 'mention', val: m[1], id: m[2] })
    last = m.index + m[0].length
  }
  if (last < md.length) segs.push({ type: 'text', val: md.slice(last) })
  return segs
}

function toMd(segs) {
  return segs.map(s => s.type === 'mention' ? `@[${s.val}](${s.id})` : s.val).join('')
}

function toDisplay(segs) {
  return segs.map(s => s.type === 'mention' ? `@${s.val}` : s.val).join('')
}

function reconcile(oldSegs, newDisplay) {
  const newSegs = []
  let cursor = 0
  for (const seg of oldSegs) {
    if (seg.type !== 'mention') continue
    const token = `@${seg.val}`
    const idx = newDisplay.indexOf(token, cursor)
    if (idx === -1) continue
    if (idx > cursor) newSegs.push({ type: 'text', val: newDisplay.slice(cursor, idx) })
    newSegs.push(seg)
    cursor = idx + token.length
  }
  if (cursor < newDisplay.length) newSegs.push({ type: 'text', val: newDisplay.slice(cursor) })
  if (newSegs.length === 0) return newDisplay.length > 0 ? [{ type: 'text', val: newDisplay }] : []
  return newSegs
}

function formatDate(dateStr) {
  if (!dateStr || dateStr.length < 10) return dateStr
  try {
    const d = new Date(dateStr + 'T00:00:00')
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
  } catch { return dateStr }
}

export default function ObjectDetailPage() {
  const { id }      = useParams()
  const navigate    = useNavigate()
  const [obj, setObj]           = useState(null)
  const [title, setTitle]       = useState('')
  const [backlinks, setBacklinks] = useState([])

  // Notes editor state (uncontrolled textarea)
  const segsRef       = useRef([])
  const taRef         = useRef(null)
  const saveTimer     = useRef(null)
  const [, forceRender]     = useState(0)
  const [query, setQuery]   = useState(null)
  const [atAnchor, setAtAnchor] = useState(0)
  const [results, setResults]   = useState([])
  const [selIdx, setSelIdx]     = useState(0)

  const titleTimer = useRef(null)

  useEffect(() => {
    getObject(id).then(o => {
      setObj(o)
      setTitle(o.title)
      const segs = parseMd(o.notes || '')
      segsRef.current = segs
      const d = toDisplay(segs)
      if (taRef.current) {
        taRef.current.value = d
        taRef.current.focus()
      }
      forceRender(n => n + 1)
    }).catch(() => navigate('/objects'))
  }, [id])

  // Load backlinks
  useEffect(() => {
    getMentions(id).then(async mentions => {
      const enriched = await Promise.all(mentions.map(async m => {
        if (m.source_type === 'diary') {
          try {
            const ctx = await getEntryContext(m.source_id, id)
            return { id: m.id, type: 'diary', sourceId: m.source_id, label: ctx.date, snippet: ctx.snippet }
          } catch {
            return { id: m.id, type: 'diary', sourceId: m.source_id, label: m.created_at?.slice(0,10), snippet: '' }
          }
        } else {
          try {
            const res = await fetch(`/api/objects/${m.source_id}`)
            const src = await res.json()
            return { id: m.id, type: 'object', sourceId: m.source_id, label: src.title, objectType: src.type, snippet: '' }
          } catch {
            return { id: m.id, type: 'object', sourceId: m.source_id, label: 'Object', snippet: '' }
          }
        }
      }))
      setBacklinks(enriched)
    }).catch(() => {})
  }, [id])

  // Mention search
  useEffect(() => {
    if (query === null) { setResults([]); setSelIdx(0); return }
    mentionSearch(query).then(r => { setResults(r); setSelIdx(0) }).catch(() => {})
  }, [query])

  const saveNotes = useCallback(() => {
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      updateObject(id, { notes: toMd(segsRef.current) }).catch(() => {})
    }, 500)
  }, [id])

  const saveTitle = useCallback((val) => {
    clearTimeout(titleTimer.current)
    titleTimer.current = setTimeout(() => {
      updateObject(id, { title: val.trim() || 'Untitled' }).catch(() => {})
    }, 600)
  }, [id])

  useEffect(() => {
    return () => {
      clearTimeout(saveTimer.current)
      clearTimeout(titleTimer.current)
      updateObject(id, { notes: toMd(segsRef.current), title: title.trim() || 'Untitled' }).catch(() => {})
    }
  }, [id, title])

  const handleNotesChange = useCallback((e) => {
    const ta = e.target
    const newVal = ta.value
    const cursor = ta.selectionStart
    segsRef.current = reconcile(segsRef.current, newVal)
    forceRender(n => n + 1)
    saveNotes()

    const before = newVal.slice(0, cursor)
    const atIdx  = before.lastIndexOf('@')
    if (atIdx >= 0) {
      const frag = before.slice(atIdx + 1)
      if (!frag.includes(' ') && !frag.includes('\n') && frag.length <= 60) {
        setAtAnchor(atIdx)
        setQuery(frag)
        return
      }
    }
    setQuery(null)
  }, [saveNotes])

  const doInsert = useCallback((obj) => {
    const ta = taRef.current
    if (!ta) return
    const cursor   = ta.selectionStart
    const curVal   = ta.value
    const before   = curVal.slice(0, atAnchor)
    const after    = curVal.slice(cursor)
    const token    = `@${obj.title}`
    const newVal   = before + token + ' ' + after
    const beforeSegs = reconcile(segsRef.current, before)
    segsRef.current  = [
      ...beforeSegs,
      { type: 'mention', val: obj.title, id: obj.id },
      { type: 'text', val: ' ' + after }
    ]
    ta.value = newVal
    const newPos = before.length + token.length + 1
    ta.setSelectionRange(newPos, newPos)
    ta.focus()
    setQuery(null)
    setResults([])
    forceRender(n => n + 1)
    saveNotes()
  }, [atAnchor, saveNotes])

  const doCreate = useCallback(async (name, type) => {
    try { doInsert(await createObject({ type, title: name })) } catch {}
  }, [doInsert])

  const handleNotesKeyDown = useCallback((e) => {
    if (query !== null) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSelIdx(i => Math.min(i + 1, results.length)) }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setSelIdx(i => Math.max(i - 1, 0)) }
      else if (e.key === 'Enter') {
        e.preventDefault()
        if (selIdx < results.length) doInsert(results[selIdx])
        else if (query.trim()) doCreate(query.trim(), 'PERSON')
      } else if (e.key === 'Escape') setQuery(null)
    }
  }, [query, results, selIdx, doInsert, doCreate])

  const handleBacklinkClick = useCallback((item) => {
    if (item.type === 'diary' && item.label) {
      navigate('/', { state: { targetDate: item.label } })
    } else if (item.type === 'object') {
      navigate(`/objects/${item.sourceId}`)
    }
  }, [navigate])

  const handleDelete = async () => {
    if (!window.confirm('Delete this object?')) return
    await deleteObject(id)
    navigate('/objects')
  }

  if (!obj) return <div className={styles.loading}>Loading...</div>

  const meta = TYPE_META[obj.type] || TYPE_META.IDEA
  const segs = segsRef.current
  const richSpans = segs.length > 0
    ? segs.map((seg, i) => {
        if (seg.type === 'mention') {
          return (
            <span key={i} className={styles.chip}
              onMouseDown={e => { e.preventDefault(); navigate(`/objects/${seg.id}`) }}>
              {seg.val}
            </span>
          )
        }
        if (query !== null) {
          const token = '@' + query
          const idx   = seg.val.indexOf(token)
          if (idx >= 0) return (
            <span key={i}>
              {seg.val.slice(0, idx)}
              <span className={styles.typing}>{seg.val.slice(idx, idx + token.length)}</span>
              {seg.val.slice(idx + token.length)}
            </span>
          )
        }
        return <span key={i}>{seg.val}</span>
      })
    : null

  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <button className={styles.backBtn} onClick={() => navigate('/objects')}><ArrowLeft /></button>
        <button className="btn btn-danger" onClick={handleDelete}>Delete</button>
      </div>

      <div className={styles.typeRow}>
        <span className={styles.typeBadge} style={{ background: meta.bg, color: meta.color }}>
          {meta.emoji} {obj.type}
        </span>
      </div>

      <input
        className={styles.titleInput}
        value={title}
        onChange={e => { setTitle(e.target.value); saveTitle(e.target.value) }}
        placeholder="Title"
      />

      {obj.tags?.length > 0 && (
        <div className={styles.tagsRow}>
          <TagIcon />
          <span>{obj.tags.map(t => `#${t}`).join('  ')}</span>
        </div>
      )}

      <div className={styles.divider} />

      {/* Notes editor — same overlay technique as DiaryEditor */}
      <div className={styles.notesWrap}>
        <div className={styles.notesRich} aria-hidden>
          {richSpans || <span className={styles.placeholder}>Notes... (type @ to link)</span>}
          <span className={styles.ghost}> </span>
        </div>
        <textarea
          ref={taRef}
          className={styles.notesTa}
          onChange={handleNotesChange}
          onKeyDown={handleNotesKeyDown}
          placeholder="Notes... (type @ to link)"
          spellCheck={false}
          defaultValue=""
        />
        {query !== null && (
          <div className={styles.popup}>
            <div className={styles.popupHint}>↑↓ navigate · Enter select · Esc close</div>
            {results.map((o, i) => (
              <div key={o.id}
                className={`${styles.popupRow} ${i === selIdx ? styles.active : ''}`}
                onMouseEnter={() => setSelIdx(i)}
                onMouseDown={e => { e.preventDefault(); doInsert(o) }}>
                <span className={styles.popupEmoji}>{TYPE_EMOJI[o.type] || '📄'}</span>
                <span className={styles.popupTitle}>{o.title}</span>
                <span className={styles.popupType}>{o.type}</span>
              </div>
            ))}
            {query.trim() && (
              <div
                className={`${styles.popupRow} ${styles.createRow} ${selIdx === results.length ? styles.active : ''}`}
                onMouseEnter={() => setSelIdx(results.length)}
                onMouseDown={e => { e.preventDefault(); doCreate(query.trim(), 'PERSON') }}>
                <span className={styles.popupEmoji}>＋</span>
                <span className={styles.popupTitle}>Create "{query.trim()}"</span>
                <span className={styles.popupType}>new</span>
              </div>
            )}
          </div>
        )}
      </div>

      {backlinks.length > 0 && (
        <div className={styles.backlinks}>
          <div className={styles.divider} />
          <div className={styles.blHeader}>
            <span>Backlinks</span>
            <span className={styles.blCount}>{backlinks.length}</span>
          </div>
          {backlinks.map(item => (
            <button key={item.id} className={styles.blRow} onClick={() => handleBacklinkClick(item)}>
              <span className={styles.blIcon}>{item.type === 'diary' ? <CalIcon /> : <LayersIcon />}</span>
              <div className={styles.blInfo}>
                <span className={styles.blLabel}>
                  {item.type === 'diary' ? formatDate(item.label) : item.label}
                </span>
                {item.snippet && <span className={styles.blSnippet}>{item.snippet}</span>}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function ArrowLeft() { return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg> }
function TagIcon()   { return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg> }
function CalIcon()   { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg> }
function LayersIcon(){ return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg> }
