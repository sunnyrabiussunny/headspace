import React from 'react'
import styles from './SearchResultsList.module.css'

const TYPE_EMOJI = { PERSON: '👤', PLACE: '📍', IDEA: '💡', ORGANIZATION: '🏢' }

export default function SearchResultsList({ results, loading, query, onDiaryClick, onObjectClick }) {
  if (loading) return <div className={styles.state}>Searching...</div>
  if (!results.length && query) return <div className={styles.state}>No results for "{query}"</div>

  return (
    <div className={styles.list}>
      {results.map(r => (
        <button
          key={r.id}
          className={styles.row}
          onClick={() => r.type === 'diary' ? onDiaryClick(r) : onObjectClick(r)}
        >
          <span className={styles.icon}>
            {r.type === 'diary' ? '📅' : (TYPE_EMOJI[r.object_type] || '📄')}
          </span>
          <div className={styles.info}>
            <div className={styles.title}>{r.title}</div>
            <div className={styles.preview}>{r.preview}</div>
          </div>
          <span className={styles.kind}>{r.type === 'diary' ? 'Diary' : r.object_type}</span>
        </button>
      ))}
    </div>
  )
}
