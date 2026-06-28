import React from 'react'

/**
 * renderRichContent — parses diary/object content and renders:
 *   @[Name](id)   → teal span, click navigates to object page (stopPropagation)
 *   @Name         → teal span, no navigation (no id available)
 *   https://...   → real <a> link, opens new tab (stopPropagation)
 *   #tag          → teal span, click calls onTagClick (stopPropagation)
 *   plain text    → <span>
 *
 * All interactive elements call e.stopPropagation() so parent card
 * onClick handlers are never triggered when a link/tag is clicked.
 */
export function renderRichContent(text, { navigate, onTagClick } = {}) {
  if (!text || !text.trim()) return null

  // One combined regex — order matters (structured @[...] before plain @)
  const RE = /@\[([^\]]+)\]\(([^)]+)\)|https?:\/\/[^\s<>"')\]]+|@([A-Za-z]\w{0,60}(?:\s[A-Z]\w{0,30})?)|#([a-zA-Z][a-zA-Z0-9_-]{0,39})/g

  const parts = []
  let last = 0, key = 0, m
  RE.lastIndex = 0

  while ((m = RE.exec(text)) !== null) {
    // Text before this match
    if (m.index > last) {
      parts.push(<span key={key++}>{text.slice(last, m.index)}</span>)
    }

    const full = m[0]

    if (m[1] !== undefined) {
      // @[Name](id) — structured mention with object id
      const name  = m[1]
      const objId = m[2]
      parts.push(
        <span
          key={key++}
          onClick={e => { e.stopPropagation(); e.preventDefault(); navigate?.(`/objects/${objId}`) }}
          style={{
            color: 'var(--accent-teal)',
            fontWeight: 600,
            cursor: navigate ? 'pointer' : 'default',
            textDecoration: 'underline',
            textDecorationColor: 'color-mix(in srgb, var(--accent-teal) 40%, transparent)',
            textUnderlineOffset: '2px',
          }}
        >
          {name}
        </span>
      )

    } else if (full.startsWith('http')) {
      // URL
      let display = full.replace(/^https?:\/\/(www\.)?/, '')
      if (display.length > 50) display = display.slice(0, 47) + '…'
      parts.push(
        <a
          key={key++}
          href={full}
          target="_blank"
          rel="noopener noreferrer"
          onClick={e => e.stopPropagation()}
          style={{
            color: 'var(--accent-teal)',
            textDecoration: 'underline',
            textUnderlineOffset: '2px',
            wordBreak: 'break-all',
            cursor: 'pointer',
          }}
        >
          {display}
        </a>
      )

    } else if (m[3] !== undefined) {
      // @Name — plain mention (no id, can't navigate)
      parts.push(
        <span key={key++} style={{ color: 'var(--accent-teal)', fontWeight: 600 }}>
          {full}
        </span>
      )

    } else if (m[4] !== undefined) {
      // #tag
      const tagName = m[4]
      parts.push(
        <span
          key={key++}
          onClick={e => { e.stopPropagation(); onTagClick?.(tagName) }}
          style={{
            color: 'var(--accent-teal)',
            fontWeight: 500,
            cursor: onTagClick ? 'pointer' : 'default',
          }}
        >
          {full}
        </span>
      )
    }

    last = m.index + full.length
  }

  if (last < text.length) {
    parts.push(<span key={key++}>{text.slice(last)}</span>)
  }

  return parts.length > 0 ? parts : null
}
