import React, { useState, useEffect, useRef, useCallback } from 'react'
import { updateEntry, mentionSearch, createObject } from '../../api'
import { useNavigate } from 'react-router-dom'
import styles from './DiaryEditor.module.css'

const MENTION_RE = /@\[([^\]]+)\]\(([^)]+)\)/g

// Parse markdown → segments
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

// Segments → markdown
function toMd(segs) {
  return segs.map(s => s.type === 'mention' ? `@[${s.val}](${s.id})` : s.val).join('')
}

// Segments → plain display text
function toDisplay(segs) {
  return segs.map(s => s.type === 'mention' ? `@${s.val}` : s.val).join('')
}

export default function DiaryEditor({ entry, onSave, onClose, onDelete }) {
  const segsRef   = useRef([])
  const [display, setDisplay]           = useState('')
  const [query, setQuery]               = useState(null)   // null = hidden
  const [atAnchor, setAtAnchor]         = useState(0)
  const [results, setResults]           = useState([])
  const [selectedIdx, setSelectedIdx]   = useState(0)
  const taRef     = useRef(null)
  const saveTimer = useRef(null)
  const navigate  = useNavigate()

  // Mount
  useEffect(() => {
    const segs = parseMd(entry.content || '')
    segsRef.current = segs
    const d = toDisplay(segs)
    setDisplay(d)
    setTimeout(() => {
      const ta = taRef.current
      if (!ta) return
      ta.focus()
      ta.setSelectionRange(d.length, d.length)
    }, 50)
  }, [entry.id])

  // Fetch suggestions
  useEffect(() => {
    if (query === null) { setResults([]); setSelectedIdx(0); return }
    mentionSearch(query).then(r => { setResults(r); setSelectedIdx(0) }).catch(() => {})
  }, [query])

  const save = useCallback(() => {
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      try {
        const saved = await updateEntry(entry.id, { content: toMd(segsRef.current) })
        onSave(saved)
      } catch {}
    }, 500)
  }, [entry.id, onSave])

  useEffect(() => {
    return () => {
      clearTimeout(saveTimer.current)
      updateEntry(entry.id, { content: toMd(segsRef.current) }).catch(() => {})
    }
  }, [entry.id])

  // Reconcile segments when user types
  const reconcile = useCallback((newDisplay, oldDisplay, oldSegs) => {
    // Find which @Name tokens still exist in new display, in order
    const newSegs = []
    let cursor = 0
    const used = new Set()

    for (const seg of oldSegs) {
      if (seg.type !== 'mention') continue
      const token = `@${seg.val}`
      const idx = newDisplay.indexOf(token, cursor)
      if (idx === -1 || used.has(idx)) continue
      // text before this mention
      if (idx > cursor) newSegs.push({ type: 'text', val: newDisplay.slice(cursor, idx) })
      newSegs.push(seg)
      cursor = idx + token.length
      used.add(idx)
    }
    // remaining
    if (cursor < newDisplay.length) newSegs.push({ type: 'text', val: newDisplay.slice(cursor) })
    if (newSegs.length === 0) return newDisplay ? [{ type: 'text', val: newDisplay }] : []
    return newSegs
  }, [])

  const handleChange = useCallback((e) => {
    const val = e.target.value
    const cursor = e.target.selectionStart
    const oldDisplay = toDisplay(segsRef.current)
    segsRef.current = reconcile(val, oldDisplay, segsRef.current)
    setDisplay(val)
    save()

    // Detect @
    const before = val.slice(0, cursor)
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
  }, [reconcile, save])

  const doInsert = useCallback((obj) => {
    const ta = taRef.current
    if (!ta) return
    const cursor  = ta.selectionStart
    const before  = display.slice(0, atAnchor)
    const after   = display.slice(cursor)
    const token   = `@${obj.title}`
    const newDisp = before + token + ' ' + after

    // Build new segments
    const beforeSegs = reconcile(before, toDisplay(segsRef.current), segsRef.current)
    const newSegs = [
      ...beforeSegs,
      { type: 'mention', val: obj.title, id: obj.id },
      { type: 'text', val: ' ' + after }
    ]
    segsRef.current = newSegs
    setDisplay(newDisp)
    setQuery(null)
    setResults([])
    save()

    const newPos = before.length + token.length + 1
    setTimeout(() => { ta.focus(); ta.setSelectionRange(newPos, newPos) }, 0)
  }, [display, atAnchor, reconcile, save])

  const doCreate = useCallback(async (name, type) => {
    try {
      const obj = await createObject({ type, title: name })
      doInsert(obj)
    } catch {}
  }, [doInsert])

  const handleKeyDown = useCallback((e) => {
    if (query !== null) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIdx(i => Math.min(i + 1, results.length)) }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIdx(i => Math.max(i - 1, 0)) }
      else if (e.key === 'Enter') {
        e.preventDefault()
        if (selectedIdx < results.length) doInsert(results[selectedIdx])
        else if (query.trim()) doCreate(query.trim(), 'PERSON')
      }
      else if (e.key === 'Escape') setQuery(null)
      return
    }
    if (e.key === 'Escape') onClose()
  }, [query, results, selectedIdx, doInsert, doCreate, onClose])

  // Build rich display spans
  const richSpans = segsRef.current.map((seg, i) => {
    if (seg.type === 'mention') {
      return (
        <span
          key={i}
          className={styles.chip}
          onMouseDown={e => { e.preventDefault(); navigate(`/objects/${seg.id}`) }}
        >{seg.val}</span>
      )
    }
    // Highlight any @typing fragment in this text segment
    if (query !== null) {
      const token = '@' + query
      const idx   = seg.val.indexOf(token)
      if (idx >= 0) {
        return (
          <span key={i}>
            {seg.val.slice(0, idx)}
            <span className={styles.typing}>{seg.val.slice(idx, idx + token.length)}</span>
            {seg.val.slice(idx + token.length)}
          </span>
        )
      }
    }
    return <span key={i}>{seg.val}</span>
  })

  return (
    <div className={styles.editor}>
      <div className={styles.header}>
        <button className={styles.doneBtn} onClick={onClose}><CheckIcon /> Done</button>
        <button className={styles.delBtn}  onClick={onDelete}><TrashIcon /></button>
      </div>

      <div className={styles.body}>
        {/* Rich rendered layer */}
        <div className={styles.rich} aria-hidden>
          {richSpans}<span className={styles.ghost}> </span>
        </div>

        {/* Transparent input layer */}
        <textarea
          ref={taRef}
          className={styles.ta}
          value={display}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder="Start writing... (type @ to link)"
          spellCheck={false}
        />

        {/* Mention popup */}
        {query !== null && (
          <MentionDropdown
            query={query}
            results={results}
            selectedIdx={selectedIdx}
            onSelect={doInsert}
            onCreate={doCreate}
            onHover={setSelectedIdx}
          />
        )}
      </div>
    </div>
  )
}

// ── Inline MentionDropdown (no separate file needed) ──────────────────────────
const TYPE_EMOJI = { PERSON:'👤', PLACE:'📍', IDEA:'💡', ORGANIZATION:'🏢' }

function MentionDropdown({ query, results, selectedIdx, onSelect, onCreate, onHover }) {
  const ref = useRef(null)
  return (
    <div className={styles.popup} ref={ref}>
      <div className={styles.popupHint}>Search or press Enter to create</div>
      {results.map((obj, i) => (
        <div
          key={obj.id}
          className={`${styles.popupRow} ${i === selectedIdx ? styles.popupRowActive : ''}`}
          onMouseEnter={() => onHover(i)}
          onMouseDown={e => { e.preventDefault(); onSelect(obj) }}
        >
          <span className={styles.popupEmoji}>{TYPE_EMOJI[obj.type] || '📄'}</span>
          <span className={styles.popupTitle}>{obj.title}</span>
          <span className={styles.popupType}>{obj.type}</span>
        </div>
      ))}
      {query.trim() && (
        <div
          className={`${styles.popupRow} ${styles.popupCreate} ${selectedIdx === results.length ? styles.popupRowActive : ''}`}
          onMouseEnter={() => onHover(results.length)}
          onMouseDown={e => { e.preventDefault(); onCreate(query.trim(), 'PERSON') }}
        >
          <span className={styles.popupEmoji}>＋</span>
          <span className={styles.popupTitle}>Create "{query.trim()}"</span>
          <span className={styles.popupType}>new object</span>
        </div>
      )}
    </div>
  )
}

function CheckIcon() { return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg> }
function TrashIcon() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg> }
