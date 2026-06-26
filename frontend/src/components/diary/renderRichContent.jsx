import React from 'react'

/**
 * renderRichContent — shared renderer for diary entries everywhere they appear in read view.
 *
 * Handles in priority order (all matched in one pass):
 *   @[Name](objectId)   — structured mention from popup → teal, clickable, navigates to object
 *   @Word / @First Last — plain @mention typed manually → teal color, no navigation
 *   https://...         — URLs → real <a> tag, opens in new tab
 *   #tagname            — hashtags → teal, clickable, filters entries by tag
 */
export function renderRichContent(content, { navigate, onTagClick } = {}) {
  if (!content || !content.trim()) return null

  // Combined regex — order matters: structured mention first, then URL, then plain @, then #tag
  const combined = /@\[([^\]]+)\]\(([^)]+)\)|https?:\/\/[^\s\)\]"']+|@[a-zA-Z][\w ]{0,40}|#([a-zA-Z][a-zA-Z0-9_-]+)/g

  const parts = []
  let last = 0, m, key = 0
  combined.lastIndex = 0

  while ((m = combined.exec(content)) !== null) {
    // Plain text before match
    if (m.index > last) {
      parts.push(<span key={key++}>{content.slice(last, m.index)}</span>)
    }

    const full = m[0]

    if (full.startsWith('@[')) {
      // Structured mention: @[Name](id)
      const name  = m[1]
      const objId = m[2]
      parts.push(
        <span key={key++}
          style={{
            color: 'var(--accent-teal)',
            fontWeight: 600,
            cursor: navigate ? 'pointer' : 'default',
            borderBottom: '1px solid color-mix(in srgb, var(--accent-teal) 40%, transparent)',
          }}
          onClick={e => { e.stopPropagation(); navigate?.(`/objects/${objId}`) }}>
          {name}
        </span>
      )
    } else if (full.startsWith('http')) {
      // URL
      let display = full.replace(/^https?:\/\/(www\.)?/, '')
      if (display.length > 50) display = display.slice(0, 50) + '…'
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
      // Plain @Name typed manually — color it but can't navigate (no id)
      parts.push(
        <span key={key++}
          style={{ color: 'var(--accent-teal)', fontWeight: 600 }}>
          {full}
        </span>
      )
    } else if (full.startsWith('#')) {
      // #tag
      const tagName = m[3]
      parts.push(
        <span key={key++}
          style={{ color: 'var(--accent-teal)', fontWeight: 500, cursor: 'pointer' }}
          onClick={e => { e.stopPropagation(); onTagClick?.(tagName) }}>
          {full}
        </span>
      )
    }

    last = m.index + full.length
  }

  if (last < content.length) {
    parts.push(<span key={key++}>{content.slice(last)}</span>)
  }

  return parts.length > 0 ? parts : null
}