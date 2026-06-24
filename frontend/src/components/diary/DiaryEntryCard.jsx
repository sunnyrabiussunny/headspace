import React from 'react'
import { useNavigate } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import styles from './DiaryEntryCard.module.css'

const MENTION_RE = /@\[([^\]]+)\]\(([^)]+)\)/g

function renderContent(content, navigate) {
  if (!content || !content.trim()) {
    return <span className={styles.empty}>Tap to write...</span>
  }
  const parts = []
  let last = 0
  MENTION_RE.lastIndex = 0
  let m
  while ((m = MENTION_RE.exec(content)) !== null) {
    if (m.index > last) parts.push(<span key={`t${last}`}>{content.slice(last, m.index)}</span>)
    const name = m[1], objId = m[2]
    parts.push(
      <span
        key={`m${m.index}`}
        className={styles.mentionLink}
        onClick={e => { e.stopPropagation(); navigate(`/objects/${objId}`) }}
      >{name}</span>
    )
    last = m.index + m[0].length
  }
  if (last < content.length) parts.push(<span key={`t${last}`}>{content.slice(last)}</span>)
  return parts
}

export default function DiaryEntryCard({ entry, onClick, onDelete }) {
  const navigate = useNavigate()
  const time = entry.created_at ? format(parseISO(entry.created_at), 'h:mm a') : ''

  return (
    <div className={styles.card} onClick={onClick}>
      <div className={styles.header}>
        <span className={styles.time}><CalIcon /> {time}</span>
        <button className={styles.delBtn}
          onClick={e => { e.stopPropagation(); onDelete() }}
          title="Delete">
          <TrashIcon />
        </button>
      </div>
      <p className={styles.preview}>
        {renderContent(entry.content, navigate)}
      </p>
      {entry.tags?.length > 0 && (
        <div className={styles.tags}>
          {entry.tags.map(t => (
            <span key={t} className="tag-pill"
              style={{ cursor:'pointer' }}
              onClick={e => { e.stopPropagation(); navigate(`/all?tag=${encodeURIComponent(t)}`) }}>
              #{t}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function CalIcon()   { return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg> }
function TrashIcon() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg> }
