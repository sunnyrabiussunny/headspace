import React from 'react'
import { useNavigate } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import { renderRichContent } from './renderRichContent'
import styles from './DiaryEntryCard.module.css'

export default function DiaryEntryCard({ entry, onClick, onDelete }) {
  const navigate = useNavigate()
  let time = ''
  try { if (entry.created_at) time = format(parseISO(entry.created_at), 'h:mm a') } catch {}

  const cleanTags = (entry.tags || []).filter(
    t => !t.startsWith('-') && !t.includes('--') && t.length < 40
  )

  return (
    <div className={styles.card}>
      {/* Header row — always opens editor on click */}
      <div className={styles.header}>
        <span className={styles.time}>{time}</span>
        <div className={styles.actions}>
          <button className={styles.editBtn} onClick={onClick} title="Edit">
            <EditIcon />
          </button>
          <button className={styles.delBtn} onClick={e => { e.stopPropagation(); onDelete() }} title="Delete">
            <TrashIcon />
          </button>
        </div>
      </div>

      {/* Content — NO onClick here at all. Links are real <a> tags. */}
      <div className={styles.content}>
        {entry.content
          ? entry.content.split('\n').map((line, i) => (
              <p key={i} className={styles.line}>
                {renderRichContent(line, {
                  navigate,
                  onTagClick: tag => navigate(`/all?tag=${encodeURIComponent(tag)}`)
                }) || (line ? <span>{line}</span> : <br />)}
              </p>
            ))
          : <span className={styles.empty} onClick={onClick} style={{ cursor:'pointer' }}>
              Tap to write...
            </span>
        }
      </div>

      {cleanTags.length > 0 && (
        <div className={styles.tags}>
          {cleanTags.map(t => (
            <span key={t} className="tag-pill" style={{ cursor:'pointer' }}
              onClick={() => navigate(`/all?tag=${encodeURIComponent(t)}`)}>
              #{t}
            </span>
          ))}
        </div>
      )}

      {/* Click-to-edit strip at the bottom */}
      <div className={styles.editStrip} onClick={onClick}>
        click to edit
      </div>
    </div>
  )
}

function EditIcon()  { return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> }
function TrashIcon() { return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg> }
