import React, { useState, useEffect, useRef, useCallback } from 'react'
import { updateEntry, mentionSearch, createObject } from '../../api'
import { useNavigate } from 'react-router-dom'
import MentionPopup from './MentionPopup'
import styles from './DiaryEditor.module.css'

// Parse markdown content into a list of segments for rendering
// Returns: Array of { type: 'text'|'mention', value, objectId?, name? }
function parseSegments(md) {
  const segments = []
  const re = /@\[([^\]]+)\]\(([^)]+)\)/g
  let last = 0, m
  while ((m = re.exec(md)) !== null) {
    if (m.index > last) segments.push({ type: 'text', value: md.slice(last, m.index) })
    segments.push({ type: 'mention', value: `@${m[1]}`, name: m[1], objectId: m[2] })
    last = m.index + m[0].length
  }
  if (last < md.length) segments.push({ type: 'text', value: md.slice(last) })
  return segments
}

// Convert segment list back to markdown string
function segmentsToMd(segments) {
  return segments.map(s =>
    s.type === 'mention' ? `@[${s.name}](${s.objectId})` : s.value
  ).join('')
}

// Convert segment list to plain display string
function segmentsToDisplay(segments) {
  return segments.map(s => s.value).join('')
}

export default function DiaryEditor({ entry, onSave, onClose, onDelete }) {
  // segments is the ground truth — markdown structured as typed segments
  const segmentsRef       = useRef([])
  const [displayText, setDisplayText] = useState('')
  const [mentionQuery, setMentionQuery]     = useState(null)
  const [mentionAnchor, setMentionAnchor]   = useState(0)   // char index in displayText
  const [mentionResults, setMentionResults] = useState([])
  const [popupAbove, setPopupAbove]         = useState(false)

  const textareaRef = useRef(null)
  const wrapRef     = useRef(null)
  const saveTimer   = useRef(null)
  const navigate    = useNavigate()

  // ── Mount: parse existing markdown ──────────────────────────────────────
  useEffect(() => {
    const segs = parseSegments(entry.content || '')
    segmentsRef.current = segs
    setDisplayText(segmentsToDisplay(segs))
    setTimeout(() => {
      const ta = textareaRef.current
      if (!ta) return
      ta.focus()
      ta.setSelectionRange(ta.value.length, ta.value.length)
      adjustPopupPosition()
    }, 60)
  }, [entry.id])

  // ── Mention search ────────────────────────────────────────────────────────
  useEffect(() => {
    if (mentionQuery === null) { setMentionResults([]); return }
    mentionSearch(mentionQuery).then(setMentionResults).catch(() => setMentionResults([]))
  }, [mentionQuery])

  // ── Auto-save ─────────────────────────────────────────────────────────────
  const triggerSave = useCallback(() => {
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      try {
        const md = segmentsToMd(segmentsRef.current)
        const saved = await updateEntry(entry.id, { content: md })
        onSave(saved)
      } catch { /* silent */ }
    }, 600)
  }, [entry.id, onSave])

  useEffect(() => {
    return () => {
      clearTimeout(saveTimer.current)
      const md = segmentsToMd(segmentsRef.current)
      updateEntry(entry.id, { content: md }).catch(() => {})
    }
  }, [entry.id])

  // ── Detect popup position relative to viewport ───────────────────────────
  const adjustPopupPosition = useCallback(() => {
    const ta = textareaRef.current
    const wrap = wrapRef.current
    if (!ta || !wrap) return
    const rect = wrap.getBoundingClientRect()
    // If bottom half of screen, show popup above textarea
    setPopupAbove(rect.top > window.innerHeight / 2)
  }, [])

  // ── onChange: rebuild segments keeping mention tokens intact ─────────────
  const handleChange = useCallback((e) => {
    const newDisplay = e.target.value
    const cursor = e.target.selectionStart

    // Diff old display vs new display to figure out what changed
    // Strategy: rebuild segments by matching display spans to old segments
    const oldDisplay = segmentsToDisplay(segmentsRef.current)
    const newSegs = reconcileSegments(segmentsRef.current, oldDisplay, newDisplay)
    segmentsRef.current = newSegs
    setDisplayText(newDisplay)
    triggerSave()

    // Detect @ for mention popup
    const textBefore = newDisplay.slice(0, cursor)
    const atIdx = textBefore.lastIndexOf('@')
    if (atIdx >= 0) {
      const fragment = textBefore.slice(atIdx + 1)
      if (!fragment.includes(' ') && !fragment.includes('\n') && fragment.length <= 50) {
        setMentionAnchor(atIdx)
        setMentionQuery(fragment)
        adjustPopupPosition()
        return
      }
    }
    setMentionQuery(null)
  }, [triggerSave, adjustPopupPosition])

  // ── Insert mention at @ position ──────────────────────────────────────────
  const insertMention = useCallback((obj) => {
    const ta = textareaRef.current
    if (!ta) return

    const cursor = ta.selectionStart
    const before = displayText.slice(0, mentionAnchor)  // text before @
    const after  = displayText.slice(cursor)             // text after current cursor

    // Build new segments:
    // 1. Re-parse the "before" text using existing segments up to mentionAnchor
    const beforeSegs = reconcileSegments(segmentsRef.current, segmentsToDisplay(segmentsRef.current), before)
    // 2. Add the new mention segment
    const mentionSeg = { type: 'mention', value: `@${obj.title}`, name: obj.title, objectId: obj.id }
    // 3. Parse the "after" text as plain text (no existing mentions expected there)
    const afterSegs  = after ? [{ type: 'text', value: after }] : []

    const newSegs = [...beforeSegs, mentionSeg, { type: 'text', value: ' ' }, ...afterSegs]
    segmentsRef.current = newSegs

    const newDisplay = segmentsToDisplay(newSegs)
    setDisplayText(newDisplay)
    setMentionQuery(null)
    setMentionResults([])
    triggerSave()

    const newPos = before.length + obj.title.length + 2 // "@" + name + " "
    setTimeout(() => {
      ta.focus()
      ta.setSelectionRange(newPos, newPos)
    }, 0)
  }, [displayText, mentionAnchor, triggerSave])

  const handleCreateAndInsert = useCallback(async (name, type) => {
    try {
      const obj = await createObject({ type, title: name })
      insertMention(obj)
    } catch { /* silent */ }
  }, [insertMention])

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Escape') {
      if (mentionQuery !== null) setMentionQuery(null)
      else onClose()
    }
  }, [mentionQuery, onClose])

  // ── Render: rich display using contenteditable-like overlay ──────────────
  // We use a transparent textarea on top of a rendered div.
  // The div shows colored mentions; the textarea captures input.
  const rendered = renderSegments(segmentsRef.current, mentionQuery, mentionAnchor, displayText, navigate)

  return (
    <div className={styles.editor}>
      <div className={styles.editorHeader}>
        <button className={styles.closeBtn} onClick={onClose}>
          <CheckIcon /> <span>Done</span>
        </button>
        <button className={styles.deleteBtn} onClick={onDelete}>
          <TrashIcon />
        </button>
      </div>

      <div className={styles.editorBody} ref={wrapRef}>
        {/* Rendered rich text behind the textarea */}
        <div className={styles.richLayer} aria-hidden="true">
          {rendered}
          {/* invisible trailing char to keep height */}
          <span className={styles.ghost}> </span>
        </div>

        {/* Transparent textarea on top */}
        <textarea
          ref={textareaRef}
          className={styles.textarea}
          value={displayText}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onScroll={e => {
            // Sync scroll between textarea and rich layer
            const overlay = e.target.previousSibling
            if (overlay) overlay.scrollTop = e.target.scrollTop
          }}
          placeholder="Start writing... (type @ to link an object)"
          spellCheck={false}
        />

        {mentionQuery !== null && (
          <MentionPopup
            query={mentionQuery}
            results={mentionResults}
            onSelect={insertMention}
            onCreate={handleCreateAndInsert}
            onDismiss={() => setMentionQuery(null)}
            above={popupAbove}
          />
        )}
      </div>
    </div>
  )
}

// ── Rich renderer ─────────────────────────────────────────────────────────────
function renderSegments(segments, mentionQuery, mentionAnchor, displayText, navigate) {
  const parts = []

  // If user is currently typing @query, highlight it live in the plain text segment
  let activeQueryHighlight = mentionQuery !== null ? {
    start: mentionAnchor,
    end: mentionAnchor + 1 + (mentionQuery?.length || 0),
  } : null

  let charPos = 0
  segments.forEach((seg, i) => {
    if (seg.type === 'mention') {
      parts.push(
        <span
          key={`m-${i}`}
          className={styles.mentionChip}
          onClick={() => navigate(`/objects/${seg.objectId}`)}
        >
          {seg.value}
        </span>
      )
      charPos += seg.value.length
    } else {
      // Plain text — check if activeQueryHighlight overlaps
      const segStart = charPos
      const segEnd   = charPos + seg.value.length

      if (activeQueryHighlight &&
          activeQueryHighlight.start < segEnd &&
          activeQueryHighlight.end > segStart) {
        // Split: before, @query highlight, after
        const hlStart = Math.max(0, activeQueryHighlight.start - segStart)
        const hlEnd   = Math.min(seg.value.length, activeQueryHighlight.end - segStart)
        if (hlStart > 0) parts.push(<span key={`t-${i}-a`}>{seg.value.slice(0, hlStart)}</span>)
        parts.push(
          <span key={`t-${i}-hl`} className={styles.atTyping}>
            {seg.value.slice(hlStart, hlEnd)}
          </span>
        )
        if (hlEnd < seg.value.length) parts.push(<span key={`t-${i}-b`}>{seg.value.slice(hlEnd)}</span>)
      } else {
        parts.push(<span key={`t-${i}`}>{seg.value}</span>)
      }
      charPos += seg.value.length
    }
  })

  return parts
}

// ── Segment reconciler ────────────────────────────────────────────────────────
// Given old segments, old display string, and new display string,
// produce new segments preserving existing mention tokens.
function reconcileSegments(oldSegs, oldDisplay, newDisplay) {
  // Build a map: mention display position -> mention segment
  // from old display
  const mentionRanges = []
  let pos = 0
  for (const seg of oldSegs) {
    if (seg.type === 'mention') {
      mentionRanges.push({ start: pos, end: pos + seg.value.length, seg })
    }
    pos += seg.value.length
  }

  // Find which mention tokens still exist verbatim in the new display
  // by searching for each mention's display string
  const newSegs = []
  let cursor = 0
  const usedMentions = new Set()

  // Simple approach: scan new display for known @Name tokens in order
  for (const mr of mentionRanges) {
    const token = mr.seg.value  // e.g. "@Riyan Hoq"
    const idx   = newDisplay.indexOf(token, cursor)
    if (idx === -1 || usedMentions.has(mr.seg.objectId + idx)) continue

    // Text before this mention
    if (idx > cursor) {
      newSegs.push({ type: 'text', value: newDisplay.slice(cursor, idx) })
    }
    newSegs.push(mr.seg)
    cursor = idx + token.length
    usedMentions.add(mr.seg.objectId + idx)
  }

  // Remaining text after all mentions
  if (cursor < newDisplay.length) {
    newSegs.push({ type: 'text', value: newDisplay.slice(cursor) })
  }

  // If nothing matched (e.g. fresh entry with no old mentions), return plain text
  if (newSegs.length === 0) {
    return newDisplay ? [{ type: 'text', value: newDisplay }] : []
  }

  return newSegs
}

function CheckIcon() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
}
function TrashIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
}
