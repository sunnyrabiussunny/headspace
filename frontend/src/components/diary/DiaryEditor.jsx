import React, { useState, useEffect, useRef, useCallback } from 'react'
import { format, parseISO } from 'date-fns'
import { updateEntry, mentionSearch, createObject } from '../../api'
import styles from './DiaryEditor.module.css'

const MENTION_RE = /@\[([^\]]+)\]\(([^)]+)\)/g
const TAG_RE     = /#([a-zA-Z0-9_\-]+)/g
const TYPE_EMOJI = { PERSON:'👤', PLACE:'📍', IDEA:'💡', ORGANIZATION:'🏢', MEDIA:'🎬' }
const TYPE_NAMES = ['PERSON','PLACE','IDEA','ORGANIZATION','MEDIA']

const TEMPLATES = [
  {
    label: '📓 Daily Reflection',
    text: `**Daily Reflection**\n\nWhat went well today:\n\nWhat I struggled with:\n\nNew learning today:\n\nGrateful for:\n`,
  },
  {
    label: '📋 Meeting Notes',
    text: `**Meeting Notes**\n\nDate: \nAttendees: \n\nAgenda:\n\nDiscussion:\n\nAction items:\n`,
  },
  {
    label: '💡 Idea Capture',
    text: `**Idea Capture**\n\nThe idea:\n\nWhy it matters:\n\nNext step:\n`,
  },
]

function parseMd(md) {
  const segs = []; let last = 0
  MENTION_RE.lastIndex = 0; let m
  while ((m = MENTION_RE.exec(md)) !== null) {
    if (m.index > last) segs.push({ type:'text', val: md.slice(last, m.index) })
    segs.push({ type:'mention', val: m[1], id: m[2] })
    last = m.index + m[0].length
  }
  if (last < md.length) segs.push({ type:'text', val: md.slice(last) })
  return segs
}
function toMd(segs) {
  return segs.map(s => s.type === 'mention' ? `@[${s.val}](${s.id})` : s.val).join('')
}
function toDisplay(segs) {
  return segs.map(s => s.type === 'mention' ? `@${s.val}` : s.val).join('')
}
function reconcile(oldSegs, newDisplay) {
  const out = []; let cursor = 0
  for (const seg of oldSegs) {
    if (seg.type !== 'mention') continue
    const token = `@${seg.val}`
    const idx = newDisplay.indexOf(token, cursor)
    if (idx === -1) continue
    if (idx > cursor) out.push({ type:'text', val: newDisplay.slice(cursor, idx) })
    out.push(seg)
    cursor = idx + token.length
  }
  if (cursor < newDisplay.length) out.push({ type:'text', val: newDisplay.slice(cursor) })
  return out.length === 0 && newDisplay.length > 0
    ? [{ type:'text', val: newDisplay }]
    : out
}
function extractTags(text) {
  const tags = new Set()
  TAG_RE.lastIndex = 0
  let m
  while ((m = TAG_RE.exec(text)) !== null) {
    tags.add(m[1].toLowerCase())
  }
  return [...tags]
}

export default function DiaryEditor({ entry, onSave, onClose, onDelete }) {
  const segsRef          = useRef([])
  const taRef            = useRef(null)
  const saveTimer        = useRef(null)
  const anchorRef        = useRef(-1)
  const skipNextRef      = useRef(false)
  const lastInsertEndRef = useRef(-1)

  const [query,      setQuery]      = useState(null)
  const [results,    setResults]    = useState([])
  const [selIdx,     setSelIdx]     = useState(0)
  const [createType, setCreateType] = useState('PERSON')
  const [tags,       setTags]       = useState(entry.tags || [])
  const [showTemplates, setShowTemplates] = useState(false)
  const [showTimeEdit, setShowTimeEdit]   = useState(false)
  const [timeValue, setTimeValue]         = useState('')

  // Mount
  useEffect(() => {
    const segs = parseMd(entry.content || '')
    segsRef.current = segs
    anchorRef.current        = -1
    skipNextRef.current      = false
    lastInsertEndRef.current = -1
    const d = toDisplay(segs)
    if (taRef.current) {
      taRef.current.value = d
      taRef.current.focus()
      taRef.current.setSelectionRange(d.length, d.length)
    }
    setTags(entry.tags || [])
    // Init time value from entry
    if (entry.created_at) {
      try {
        const dt = typeof entry.created_at === 'string'
          ? parseISO(entry.created_at)
          : new Date(entry.created_at)
        setTimeValue(format(dt, "yyyy-MM-dd'T'HH:mm"))
      } catch {}
    }
  }, [entry.id])

  // Fetch suggestions
  useEffect(() => {
    if (query === null) { setResults([]); setSelIdx(0); return }
    mentionSearch(query).then(r => { setResults(r); setSelIdx(0) }).catch(() => {})
  }, [query])

  // Save debounced
  const save = useCallback((extraData = {}) => {
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      try {
        const content = toMd(segsRef.current)
        const detectedTags = extractTags(toDisplay(segsRef.current))
        // Merge: keep manual tags + detected ones
        const allTags = [...new Set([...detectedTags])]
        const saved = await updateEntry(entry.id, { content, tags: allTags, ...extraData })
        setTags(saved.tags || [])
        onSave(saved)
      } catch {}
    }, 500)
  }, [entry.id, onSave])

  useEffect(() => {
    return () => {
      clearTimeout(saveTimer.current)
      const content = toMd(segsRef.current)
      const detectedTags = extractTags(toDisplay(segsRef.current))
      updateEntry(entry.id, { content, tags: [...new Set([...detectedTags])] }).catch(() => {})
    }
  }, [entry.id])

  const handleChange = useCallback((e) => {
    const ta     = e.target
    const newVal = ta.value
    const cursor = ta.selectionStart
    segsRef.current = reconcile(segsRef.current, newVal)
    // Live tag detection as user types
    setTags(extractTags(newVal))
    save()

    if (skipNextRef.current) {
      skipNextRef.current = false
      setQuery(null)
      return
    }

    const before = newVal.slice(0, cursor)
    const atIdx  = before.lastIndexOf('@')
    if (atIdx >= 0) {
      const frag = before.slice(atIdx + 1)
      const alreadyUsed = lastInsertEndRef.current > 0 && atIdx < lastInsertEndRef.current
      if (!frag.includes('\n') && !alreadyUsed) {
        anchorRef.current = atIdx
        setQuery(frag)
        return
      }
    }
    setQuery(null)
  }, [save])

  const doInsert = useCallback((obj) => {
    const ta = taRef.current
    if (!ta) return
    const anchor = anchorRef.current
    if (anchor < 0) return
    const cursor = ta.selectionStart
    const before = ta.value.slice(0, anchor)
    const after  = ta.value.slice(cursor)
    const token  = `@${obj.title}`
    const newVal = before + token + ' ' + after

    const beforeSegs = reconcile(segsRef.current, before)
    segsRef.current = [
      ...beforeSegs,
      { type:'mention', val: obj.title, id: obj.id },
      { type:'text', val: ' ' + after }
    ]

    ta.value = newVal
    const newPos = anchor + token.length + 1
    ta.setSelectionRange(newPos, newPos)
    ta.focus()

    skipNextRef.current      = true
    anchorRef.current        = -1
    lastInsertEndRef.current = newPos
    setQuery(null)
    setResults([])
    save()
  }, [save])

  const doCreate = useCallback(async (name, type) => {
    if (!name.trim()) return
    try {
      const obj = await createObject({ type, title: name.trim() })
      doInsert(obj)
    } catch {}
  }, [doInsert])

  const applyTemplate = useCallback((tpl) => {
    const ta = taRef.current
    if (!ta) return
    const current = ta.value
    const newVal = current ? current + '\n\n' + tpl.text : tpl.text
    ta.value = newVal
    segsRef.current = [{ type: 'text', val: newVal }]
    ta.focus()
    ta.setSelectionRange(newVal.length, newVal.length)
    setShowTemplates(false)
    save()
  }, [save])

  const handleTimeChange = useCallback(async () => {
    if (!timeValue) return
    // Cancel any pending content-save debounce so it doesn't overwrite our time change
    clearTimeout(saveTimer.current)
    try {
      const content = toMd(segsRef.current)
      const detectedTags = extractTags(toDisplay(segsRef.current))
      const saved = await updateEntry(entry.id, {
        content,
        tags: [...new Set([...detectedTags])],
        // Send local datetime string directly so backend can extract the correct
        // local date (YYYY-MM-DD). Converting to UTC first risks shifting the day
        // for entries created near midnight in the user's timezone.
        created_at: timeValue  // "YYYY-MM-DDTHH:mm" local time
      })
      // Re-sync timeValue from response so display stays correct
      if (saved.created_at) {
        try {
          const dt = parseISO(saved.created_at)
          setTimeValue(format(dt, "yyyy-MM-dd'T'HH:mm"))
        } catch {}
      }
      setTags(saved.tags || [])
      onSave(saved)
      setShowTimeEdit(false)
    } catch {}
  }, [entry.id, timeValue, onSave])

  const handleKeyDown = useCallback((e) => {
    if (query !== null) {
      if (e.key === 'ArrowDown') {
        e.preventDefault(); setSelIdx(i => Math.min(i + 1, results.length))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault(); setSelIdx(i => Math.max(i - 1, 0))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        if (selIdx < results.length) doInsert(results[selIdx])
        else if (query.trim()) doCreate(query.trim(), createType)
      } else if (e.key === 'Escape') {
        setQuery(null)
      }
      return
    }
    if (e.key === 'Escape') onClose()
  }, [query, results, selIdx, doInsert, doCreate, createType, onClose])

  return (
    <div className={styles.editor}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <button className={styles.doneBtn} onClick={onClose}><CheckIcon /> Done</button>
          <button
            className={styles.toolBtn}
            onClick={() => setShowTemplates(v => !v)}
            title="Insert template"
          >
            <TemplateIcon /> Templates
          </button>
          <button
            className={styles.toolBtn}
            onClick={() => setShowTimeEdit(v => !v)}
            title="Edit time"
          >
            <ClockIcon />
          </button>
        </div>
        <button className={styles.delBtn} onClick={onDelete}><TrashIcon /></button>
      </div>

      {/* Template picker */}
      {showTemplates && (
        <div className={styles.templatePicker}>
          {TEMPLATES.map((tpl, i) => (
            <button key={i} className={styles.templateBtn} onClick={() => applyTemplate(tpl)}>
              {tpl.label}
            </button>
          ))}
        </div>
      )}

      {/* Time editor */}
      {showTimeEdit && (
        <div className={styles.timeEditor}>
          <span className={styles.timeLabel}>Entry time:</span>
          <input
            type="datetime-local"
            className={styles.timeInput}
            value={timeValue}
            onChange={e => setTimeValue(e.target.value)}
          />
          <button className={styles.timeSaveBtn} onClick={handleTimeChange}>Save</button>
          <button className={styles.timeCancelBtn} onClick={() => setShowTimeEdit(false)}>Cancel</button>
        </div>
      )}

      <div className={styles.body}>
        <textarea
          ref={taRef}
          className={styles.ta}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder="Start writing... (type @ to link objects, # to add tags)"
          spellCheck={false}
          defaultValue=""
        />

        {/* Live tag pills */}
        {tags.length > 0 && (
          <div className={styles.tagRow}>
            {tags.map(t => <span key={t} className={styles.tagPill}>#{t}</span>)}
          </div>
        )}

        {/* Mention popup */}
        {query !== null && (
          <div className={styles.popup}>
            <div className={styles.popupHint}>↑↓ navigate · Enter select · Esc close</div>
            {results.length === 0 && query.length > 0 && (
              <div className={styles.popupEmpty}>No objects match "{query}"</div>
            )}
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
            {query.trim().length > 0 && (
              <div className={`${styles.createSection} ${selIdx === results.length ? styles.active : ''}`}
                onMouseEnter={() => setSelIdx(results.length)}>
                <div className={styles.createTop}>
                  <span className={styles.createPlus}>＋</span>
                  <span className={styles.createLabel}>Create "{query.trim()}" as:</span>
                </div>
                <div className={styles.typeRow}>
                  {TYPE_NAMES.map(t => (
                    <button key={t}
                      className={`${styles.typeBtn} ${createType === t ? styles.typeBtnActive : ''}`}
                      onMouseDown={e => { e.preventDefault(); setCreateType(t) }}>
                      {TYPE_EMOJI[t]} {t.charAt(0) + t.slice(1).toLowerCase()}
                    </button>
                  ))}
                </div>
                <button className={styles.createConfirm}
                  onMouseDown={e => { e.preventDefault(); doCreate(query.trim(), createType) }}>
                  Create and Link
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function CheckIcon()    { return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg> }
function TrashIcon()    { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg> }
function TemplateIcon() { return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg> }
function ClockIcon()    { return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> }
