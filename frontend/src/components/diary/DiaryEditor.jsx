import React, { useState, useEffect, useRef, useCallback } from 'react'
import { updateEntry, mentionSearch, createObject } from '../../api'
import { useNavigate } from 'react-router-dom'
import styles from './DiaryEditor.module.css'

const MENTION_RE = /@\[([^\]]+)\]\(([^)]+)\)/g

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
  // Keep existing mention tokens if they still appear verbatim in newDisplay
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
  // If no segments yet (fresh entry or all mentions deleted), return plain text
  if (newSegs.length === 0) {
    return newDisplay.length > 0 ? [{ type: 'text', val: newDisplay }] : []
  }
  return newSegs
}

const TYPE_EMOJI = { PERSON: '👤', PLACE: '📍', IDEA: '💡', ORGANIZATION: '🏢' }

export default function DiaryEditor({ entry, onSave, onClose, onDelete }) {
  const segsRef       = useRef([])
  const displayRef    = useRef('')          // ground truth for display — NOT state
  const taRef         = useRef(null)
  const saveTimer     = useRef(null)
  const navigate      = useNavigate()

  const [, forceRender]       = useState(0)  // only for rich layer redraws
  const [query, setQuery]     = useState(null)
  const [atAnchor, setAtAnchor] = useState(0)
  const [results, setResults] = useState([])
  const [selIdx, setSelIdx]   = useState(0)

  // Mount — parse existing markdown, set textarea value directly (no state)
  useEffect(() => {
    const segs = parseMd(entry.content || '')
    segsRef.current = segs
    const d = toDisplay(segs)
    displayRef.current = d
    if (taRef.current) {
      taRef.current.value = d
      taRef.current.focus()
      taRef.current.setSelectionRange(d.length, d.length)
    }
    forceRender(n => n + 1)
  }, [entry.id])

  // Mention search
  useEffect(() => {
    if (query === null) { setResults([]); setSelIdx(0); return }
    mentionSearch(query).then(r => { setResults(r); setSelIdx(0) }).catch(() => {})
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

  // onChange — manipulate textarea value directly, never via React state
  const handleChange = useCallback((e) => {
    const ta = e.target
    const newVal = ta.value
    const cursor = ta.selectionStart

    // Reconcile segments with new display value
    segsRef.current = reconcile(segsRef.current, newVal)
    displayRef.current = newVal
    // DO NOT call setDisplay — just trigger rich layer redraw
    forceRender(n => n + 1)
    save()

    // Detect @
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
  }, [save])

  const doInsert = useCallback((obj) => {
    const ta = taRef.current
    if (!ta) return
    const cursor   = ta.selectionStart
    const curVal   = ta.value
    const before   = curVal.slice(0, atAnchor)
    const after    = curVal.slice(cursor)
    const token    = `@${obj.title}`
    const newVal   = before + token + ' ' + after

    // Build new segments
    const beforeSegs = reconcile(segsRef.current, before)
    segsRef.current  = [
      ...beforeSegs,
      { type: 'mention', val: obj.title, id: obj.id },
      { type: 'text', val: ' ' + after }
    ]
    displayRef.current = newVal

    // Set textarea value directly — preserves cursor control
    ta.value = newVal
    const newPos = before.length + token.length + 1
    ta.setSelectionRange(newPos, newPos)
    ta.focus()

    setQuery(null)
    setResults([])
    forceRender(n => n + 1)
    save()
  }, [atAnchor, save])

  const doCreate = useCallback(async (name, type) => {
    try { doInsert(await createObject({ type, title: name })) } catch {}
  }, [doInsert])

  const handleKeyDown = useCallback((e) => {
    if (query !== null) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSelIdx(i => Math.min(i + 1, results.length)) }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setSelIdx(i => Math.max(i - 1, 0)) }
      else if (e.key === 'Enter') {
        e.preventDefault()
        if (selIdx < results.length) doInsert(results[selIdx])
        else if (query.trim()) doCreate(query.trim(), 'PERSON')
      } else if (e.key === 'Escape') setQuery(null)
      return
    }
    if (e.key === 'Escape') onClose()
  }, [query, results, selIdx, doInsert, doCreate, onClose])

  // Build rich spans for overlay
  const segs = segsRef.current
  const curDisplay = displayRef.current
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
        // Highlight live @typing in this text segment
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
    : [<span key="plain">{curDisplay}</span>]

  return (
    <div className={styles.editor}>
      <div className={styles.header}>
        <button className={styles.doneBtn} onClick={onClose}><CheckIcon /> Done</button>
        <button className={styles.delBtn} onClick={onDelete}><TrashIcon /></button>
      </div>
      <div className={styles.body}>
        <div className={styles.rich} aria-hidden>
          {richSpans}<span className={styles.ghost}> </span>
        </div>
        <textarea
          ref={taRef}
          className={styles.ta}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder="Start writing... (type @ to link)"
          spellCheck={false}
          defaultValue=""
        />
        {query !== null && (
          <div className={styles.popup}>
            <div className={styles.popupHint}>↑↓ navigate · Enter select · Esc close</div>
            {results.map((obj, i) => (
              <div key={obj.id}
                className={`${styles.popupRow} ${i === selIdx ? styles.active : ''}`}
                onMouseEnter={() => setSelIdx(i)}
                onMouseDown={e => { e.preventDefault(); doInsert(obj) }}>
                <span className={styles.popupEmoji}>{TYPE_EMOJI[obj.type] || '📄'}</span>
                <span className={styles.popupTitle}>{obj.title}</span>
                <span className={styles.popupType}>{obj.type}</span>
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
    </div>
  )
}

function CheckIcon() { return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg> }
function TrashIcon() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg> }
