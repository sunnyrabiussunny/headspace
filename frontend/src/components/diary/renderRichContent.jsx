import React from 'react'

/**
 * renderRichContent
 * Renders a single line of diary content with rich formatting.
 * 
 * Token types (matched in priority order):
 *   @[Name](id)     → teal bold underlined span, onClick navigates to object
 *   https://...     → real <a> tag, opens new tab
 *   @Word           → teal bold (manually typed, no id to navigate to)
 *   #tag            → teal, onClick calls onTagClick
 */
export function renderRichContent(text, { navigate, onTagClick } = {}) {
  if (!text || !text.trim()) return null

  const RE = /@\[([^\]]+)\]\(([^)]+)\)|https?:\/\/[^\s\)\]"'<>]+|@[a-zA-Z]\w{0,39}|#([a-zA-Z][a-zA-Z0-9_-]+)/g
  const parts = []
  let last = 0, m, key = 0
  RE.lastIndex = 0

  while ((m = RE.exec(text)) !== null) {
    if (m.index > last) {
      parts.push(<span key={key++}>{text.slice(last, m.index)}</span>)
    }

    const full = m[0]

    if (full.startsWith('@[')) {
      // Structured @mention — ALWAYS navigable
      const name = m[1], objId = m[2]
      parts.push(
        <a key={key++}
          href={`/objects/${objId}`}
          style={{
            color: 'var(--accent-teal)',
            fontWeight: 600,
            textDecoration: 'underline',
            textUnderlineOffset: '2px',
            cursor: 'pointer',
          }}
          onClick={e => {
            e.preventDefault()
            e.stopPropagation()
            navigate?.(`/objects/${objId}`)
          }}>
          {name}
        </a>
      )
    } else if (full.startsWith('http')) {
      const display = full.replace(/^https?:\/\/(www\.)?/, '').slice(0, 50) + (full.length > 55 ? '…' : '')
      parts.push(
        <a key={key++}
          href={full}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            color: 'var(--accent-teal)',
            textDecoration: 'underline',
            textUnderlineOffset: '2px',
            wordBreak: 'break-all',
          }}
          onClick={e => e.stopPropagation()}>
          {display}
        </a>
      )
    } else if (full.startsWith('@')) {
      parts.push(
        <span key={key++} style={{ color: 'var(--accent-teal)', fontWeight: 600 }}>
          {full}
        </span>
      )
    } else if (full.startsWith('#')) {
      const tag = m[3]
      parts.push(
        <span key={key++}
          style={{ color: 'var(--accent-teal)', fontWeight: 500, cursor: 'pointer' }}
          onClick={e => { e.stopPropagation(); onTagClick?.(tag) }}>
          {full}
        </span>
      )
    }

    last = m.index + full.length
  }

  if (last < text.length) parts.push(<span key={key++}>{text.slice(last)}</span>)
  return parts.length ? parts : null
}
