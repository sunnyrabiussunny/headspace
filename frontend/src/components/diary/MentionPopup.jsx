import React, { useState, useEffect, useRef } from 'react'
import styles from './MentionPopup.module.css'

const TYPE_META = {
  PERSON:       { emoji: '👤', label: 'Person' },
  PLACE:        { emoji: '📍', label: 'Place' },
  IDEA:         { emoji: '💡', label: 'Idea' },
  ORGANIZATION: { emoji: '🏢', label: 'Org' },
}

const ALL_TYPES = ['PERSON', 'PLACE', 'IDEA', 'ORGANIZATION']

export default function MentionPopup({ query, results, onSelect, onCreate, onDismiss }) {
  const [createType, setCreateType] = useState('PERSON')
  const popupRef = useRef(null)

  // Close on outside click
  useEffect(() => {
    const handler = (e) => {
      if (popupRef.current && !popupRef.current.contains(e.target)) {
        onDismiss()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onDismiss])

  return (
    <div className={styles.popup} ref={popupRef}>
      <div className={styles.header}>
        Search any object or select a type
      </div>

      {/* Existing object results */}
      {results.length === 0 && query.length > 0 && (
        <div className={styles.empty}>No objects found for "{query}"</div>
      )}

      {results.map(obj => (
        <button
          key={obj.id}
          className={styles.row}
          onMouseDown={(e) => { e.preventDefault(); onSelect(obj) }}
        >
          <span className={styles.typeLabel}>
            {TYPE_META[obj.type]?.emoji} {TYPE_META[obj.type]?.label}
          </span>
          <span className={styles.title}>{obj.title}</span>
          <ChevronRight />
        </button>
      ))}

      {/* Create new */}
      {query.trim().length > 0 && (
        <div className={styles.createRow}>
          <span className={styles.createPlus}>+</span>
          <span className={styles.createName}>"{query}"</span>
          <div className={styles.typeButtons}>
            {ALL_TYPES.map(t => (
              <button
                key={t}
                className={`${styles.typeBtn} ${createType === t ? styles.typeBtnActive : ''}`}
                onMouseDown={(e) => { e.preventDefault(); setCreateType(t) }}
                title={TYPE_META[t].label}
              >
                {TYPE_META[t].emoji}
              </button>
            ))}
          </div>
          <button
            className={styles.createBtn}
            onMouseDown={(e) => { e.preventDefault(); onCreate(query.trim(), createType) }}
          >
            Create
          </button>
        </div>
      )}
    </div>
  )
}

function ChevronRight() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
}
