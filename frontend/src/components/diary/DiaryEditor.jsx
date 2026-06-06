import React, { useState, useEffect, useRef, useCallback } from 'react'
import { updateEntry, mentionSearch, createObject } from '../../api'
import { useNavigate } from 'react-router-dom'
import MentionPopup from './MentionPopup'
import styles from './DiaryEditor.module.css'

export default function DiaryEditor({ entry, onSave, onClose, onDelete }) {
  const [blocks, setBlocks]               = useState([])   // { type:'text'|'mention', text, id, objectId }
  const [rawText, setRawText]             = useState('')    // what textarea shows
  const [mentionQuery, setMentionQuery]   = useState(null)
  const [mentionAnchor, setMentionAnchor] = useState(0)
  const [mentionResults, setMentionResults] = useState([])
  const textareaRef = useRef(null)
  const saveTimer   = useRef(null)
  const mdRef       = useRef(entry.content)
  const navigate    = useNavigate()

  // On mount — parse markdown into display text
  useEffect(() => {
    const display = mdToDisplay(entry.content)
    setRawText(display)
    mdRef.current = entry.content
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus()
        const len = textareaRef.current.value.length
        textareaRef.current.setSelectionRange(len, len)
      }
    }, 60)
  }, [entry.id])

  // Fetch mention suggestions
  useEffect(() => {
    if (mentionQuery === null) { setMentionResults([]); return }
    mentionSearch(mentionQuery)
      .then(setMentionResults)
      .catch(() => setMentionResults([]))
  }, [mentionQuery])

  const triggerSave = useCallback(() => {
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      try {
        const saved = await updateEntry(entry.id, { content: mdRef.current })
        onSave(saved)
      } catch { /* silent */ }
    }, 600)
  }, [entry.id, onSave])

  useEffect(() => {
    return () => {
      clearTimeout(saveTimer.current)
      updateEntry(entry.id, { content: mdRef.current }).catch(() => {})
    }
  }, [entry.id])

  const handleChange = useCallback((e) => {
    const value = e.target.value
    setRawText(value)

    // Rebuild markdown preserving existing @[Name](id) tokens
    // Strategy: rebuild from scratch using a mention registry built from current mdRef
    mdRef.current = rebuildMarkdown(value, mdRef.current)
    triggerSave()

    // Detect @ for mention popup — use actual cursor position
    const cursor = e.target.selectionStart
    const textBefore = value.slice(0, cursor)
    const atIdx = textBefore.lastIndexOf('@')

    if (atIdx >= 0) {
      const fragment = textBefore.slice(atIdx + 1)
      if (!fragment.includes(' ') && !fragment.includes('\n') && fragment.length <= 40) {
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
    const before = rawText.slice(0, mentionAnchor)
    const after  = rawText.slice(cursor)
    // Insert @Name in display, @[Name](id) in markdown
    const displayToken = `@${obj.title}`
    const mdToken      = `@[${obj.title}](${obj.id})`

    const newDisplay = before + displayToken + ' ' + after
    const newMd      = mdToDisplay(mdRef.current)
      // Replace the @query part in markdown with the full token
    const currentMdBefore = mdRef.current.slice(0, mentionAnchor)
    const currentMdAfter  = mdRef.current.slice(mentionAnchor + (cursor - mentionAnchor))
    mdRef.current = currentMdBefore + mdToken + ' ' + currentMdAfter

    setRawText(newDisplay)
    setMentionQuery(null)
    setMentionResults([])

    const newPos = before.length + displayToken.length + 1
    setTimeout(() => {
      ta.focus()
      ta.setSelectionRange(newPos, newPos)
    }, 0)
    triggerSave()
  }, [rawText, mentionAnchor, triggerSave])

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

  // Render the rich preview BELOW the textarea when not editing
  // Actually: we keep textarea for editing. The mention chips appear in the preview card.

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
          value={rawText}
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

// ── Helpers ───────────────────────────────────────────────────────────────────

function mdToDisplay(md) {
  return md.replace(/@\[([^\]]+)\]\([^)]+\)/g, (_, name) => `@${name}`)
}

function rebuildMarkdown(displayText, previousMd) {
  // Extract all known mention tokens from previous markdown
  const tokens = {}
  const re = /@\[([^\]]+)\]\(([^)]+)\)/g
  let m
  while ((m = re.exec(previousMd)) !== null) {
    tokens[m[1]] = m[2]  // name -> id
  }

  // Replace @Name in display text with @[Name](id) where we have a known mapping
  return displayText.replace(/@([\w\s\-\.]+)/g, (match, name) => {
    const trimmed = name.trimEnd()
    if (tokens[trimmed]) {
      return `@[${trimmed}](${tokens[trimmed]})` + name.slice(trimmed.length)
    }
    return match
  })
}

function CheckIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
}
function TrashIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
}
