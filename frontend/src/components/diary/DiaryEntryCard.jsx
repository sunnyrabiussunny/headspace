import React from 'react'
import { format, parseISO } from 'date-fns'
import styles from './DiaryEntryCard.module.css'

const MENTION_RE = /@\[([^\]]+)\]\([^)]+\)/g

function renderPreview(content) {
  if (!content.trim()) return <span style={{ color: 'var(--text-muted)' }}>Tap to write...</span>
  const plain = content.replace(MENTION_RE, (_, name) => `@${name}`)
  return plain.slice(0, 300) + (plain.length > 300 ? '…' : '')
}

export default function DiaryEntryCard({ entry, onClick, onDelete }) {
  const time = entry.created_at
    ? format(parseISO(entry.created_at), 'h:mm a')
    : ''

  return (
    <div className={styles.card} onClick={onClick}>
      <div className={styles.header}>
        <span className={styles.time}>
          <CalIcon /> {time}
        </span>
        <button
          className={styles.moreBtn}
          onClick={e => { e.stopPropagation(); onDelete() }}
          title="Delete entry"
        >
          <TrashIcon />
        </button>
      </div>
      <p className={styles.preview}>{renderPreview(entry.content)}</p>
      {entry.tags?.length > 0 && (
        <div className={styles.tags}>
          {entry.tags.map(t => <span key={t} className="tag-pill">#{t}</span>)}
        </div>
      )}
    </div>
  )
}

function CalIcon() {
  return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
}
function TrashIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
}
