import React, { useState, useEffect, useRef, useCallback } from 'react'
import { updateEntry, mentionSearch, createObject } from '../../api'
import MentionPopup from './MentionPopup'
import styles from './DiaryEditor.module.css'

export default function DiaryEditor({ entry, onSave, onClose, onDelete }) {
  const [displayText, setDisplayText]     = useState('')
  const [mentionQuery, setMentionQuery]   = useState(null)
  const [mentionAnchor, setMentionAnchor] = useState(0)
  const [mentionResults, setMentionResults] = useState([])
  const [popupPos, setPopupPos]           = useState({ top: 0, left: 0 })
  const textareaRef = useRef(null)
  const saveTimer   = useRef(null)
  const mdRef       = useRef(entry.content)
  // Map of display positions to mention tokens: { anchorPos: { display, id } }
  const mentionMap  = useRef({})

  // On mount: convert stored markdown to display text
  useEffect(() => {
    const { display, map } = markdownToDisplay(entry.content)
    setDisplayText(display)
    mdRef.current = entry.content
    mentionMap.current = map
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus()
        const len = textareaRef.current.value.length
        textareaRef.current.setSelectionRange(len, len)
      }
    }, 60)
  }, [entry.id])

  // Fetch mention suggestions whenever query changes
  useEffect(() => {
    if (mentionQuery === null) { setMentionResults([]); return }
    mentionSearch(mentionQuery)
      .then(setMentionResults)
      .catch(() => setMentionResults([]))
  }, [mentionQuery])

  // Auto-save 600ms after typing stops
  const triggerSave = useCallback(() => {
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      try {
        const saved = await updateEntry(entry.id, { content: mdRef.current })
        onSave(saved)
      } catch { /* silent */ }
    }, 600)
  }, [entry.id, onSave])

  // Flush on unmount
  useEffect(() => {
    return () => {
      clearTimeout(saveTimer.current)
      updateEntry(entry.id, { content: mdRef.current }).catch(() => {})
    }
  }, [entry.id])

  const handleChange = useCallback((e) => {
    const value = e.target.value
    setDisplayText(value)
    // Rebuild markdown from display text using mentionMap
    mdRef.current = displayToMarkdown(value, mentionMap.current)
    triggerSave()

    // Detect @ mention
    const cursor = e.target.selectionStart
    const textBefore = value.slice(0, cursor)
    const atIdx = textBefore.lastIndexOf('@')

    if (atIdx >= 0) {
      const fragment = textBefore.slice(atIdx + 1)
      // Only trigger if no space or newline after @
      if (!fragment.includes(' ') && !fragment.includes('\n')) {
        setMentionAnchor(atIdx)
        setMentionQuery(fragment)
        return
      }
    }
    setMentionQuery(null)
  }, [triggerSave])

  const insertMention = useCallback((obj) => {
    const ta = textareaRef.current
    if (!ta) return

    const cursor = ta.selectionStart
    const before = displayText.slice(0, mentionAnchor)
    const after  = displayText.slice(cursor)
    const displayMention = `@${obj.title}`
    const newDisplay = before + displayMention + ' ' + after

    // Store in mentionMap so we can rebuild markdown later
    mentionMap.current = {
      ...mentionMap.current,
      [mentionAnchor]: { display: obj.title, id: obj.id }
    }

    setDisplayText(newDisplay)
    mdRef.current = displayToMarkdown(newDisplay, mentionMap.current)
    setMentionQuery(null)
    setMentionResults([])

    // Move cursor to after the inserted mention
    const newPos = before.length + displayMention.length + 1
    setTimeout(() => {
      ta.focus()
      ta.setSelectionRange(newPos, newPos)
    }, 0)
    triggerSave()
  }, [displayText, mentionAnchor, triggerSave])

  const handleCreateAndInsert = useCallback(async (name, type) => {
    try {
      const obj = await createObject({ type, title: name })
      insertMention(obj)
    } catch { /* silent */ }
  }, [insertMention])

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Escape') {
      if (mentionQuery !== null) {
        setMentionQuery(null)
      } else {
        onClose()
      }
    }
  }, [mentionQuery, onClose])

  return (
    <div className={styles.editor}>
      <div className={styles.editorHeader}>
        <button className={styles.closeBtn} onClick={onClose} title="Done">
          <CheckIcon />
          <span style={{ fontSize: 12, marginLeft: 2 }}>Done</span>
        </button>
        <button className={styles.deleteBtn} onClick={onDelete} title="Delete">
          <TrashIcon />
        </button>
      </div>

      <div style={{ position: 'relative' }}>
        <textarea
          ref={textareaRef}
          className={styles.textarea}
          value={displayText}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder="Start writing... (type @ to link an object)"
          spellCheck
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
    </div>
  )
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function markdownToDisplay(content) {
  // Convert @[Name](id) -> @Name, build a position map
  const map = {}
  const display = content.replace(/@\[([^\]]+)\]\(([^)]+)\)/g, (match, name, id) => {
    return `@${name}`
  })
  return { display, map }
}

function displayToMarkdown(display, mentionMap) {
  // Simple approach: replace @Name with @[Name](id) using mentionMap
  // Walk mentionMap entries sorted by anchor position
  let result = display
  const entries = Object.entries(mentionMap).sort((a, b) => Number(b[0]) - Number(a[0]))
  for (const [_anchor, { display: name, id }] of entries) {
    // Replace first occurrence of @name that isn't already in markdown form
    const displayToken = `@${name}`
    const mdToken = `@[${name}](${id})`
    // Only replace if not already wrapped
    if (result.includes(displayToken) && !result.includes(mdToken)) {
      result = result.replace(displayToken, mdToken)
    }
  }
  return result
}

function CheckIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
}
function TrashIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
}
