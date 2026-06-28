import React from 'react'
import { useNavigate } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import { renderRichContent } from './renderRichContent'
import styles from './DiaryEntryCard.module.css'

export default function DiaryEntryCard({ entry, onClick, onDelete }) {
  const navigate = useNavigate()
  const time = entry.created_at
    ? (() => { try { return format(parseISO(entry.created_at), 'h:mm a') } catch { return '' } })()
    : ''

  return (
    <div className={styles.card}>
      {/* Header — click opens editor */}
      <div className={styles.header} onClick={onClick} style={{ cursor:'pointer' }}>
        <span className={styles.time}><CalIcon /> {time}</span>
        <button className={styles.delBtn}
          onClick={e => { e.stopPropagation(); onDelete() }}
          title="Delete">
          <TrashIcon />
        </button>
      </div>

      {/* Content — rich rendering; mention/URL clicks propagate to their handlers,
          clicking blank text opens the editor */}
      <div className={styles.content} onClick={onClick}>
        {entry.content
          ? entry.content.split('\n').map((line, i) => (
              <p key={i} className={styles.line}>
                {renderRichContent(line, {
                  navigate,
                  onTagClick: (tag) => navigate(`/all?tag=${encodeURIComponent(tag)}`)
                }) || (line ? <span>{line}</span> : <br />)}
              </p>
            ))
          : <span className={styles.empty}>Tap to write...</span>
        }
      </div>

      {entry.tags?.length > 0 && (
        <div className={styles.tags}>
          {entry.tags
            .filter(t => !t.startsWith('-') && !t.includes('--') && t.length < 40)
            .map(t => (
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
