import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { listObjects, createObject, deleteObject, listObjectTypes, createObjectType } from '../../api'
import toast from 'react-hot-toast'
import styles from './ObjectsPage.module.css'

export default function ObjectsPage() {
  const [objects, setObjects]       = useState([])
  const [types, setTypes]           = useState([])
  const [filter, setFilter]         = useState(null)
  const [showCreate, setShowCreate] = useState(false)
  const [newTitle, setNewTitle]     = useState('')
  const [newType, setNewType]       = useState('PERSON')
  const [showNewType, setShowNewType] = useState(false)
  const [newTypeLabel, setNewTypeLabel] = useState('')
  const [newTypeIcon, setNewTypeIcon]   = useState('📄')
  const navigate                    = useNavigate()

  const loadTypes = () => listObjectTypes().then(setTypes).catch(() => {})

  useEffect(() => { loadTypes() }, [])

  useEffect(() => {
    listObjects(filter).then(setObjects).catch(() => {})
  }, [filter])

  const handleCreate = async () => {
    if (!newTitle.trim()) return
    try {
      const obj = await createObject({ type: newType, title: newTitle.trim() })
      setShowCreate(false)
      setNewTitle('')
      navigate(`/objects/${obj.id}`)
    } catch {
      toast.error('Failed to create object')
    }
  }

  const handleCreateType = async () => {
    if (!newTypeLabel.trim()) return
    try {
      const t = await createObjectType({ label: newTypeLabel.trim(), icon: newTypeIcon })
      setTypes(prev => [...prev, t])
      setNewType(t.key)
      setNewTypeLabel(''); setNewTypeIcon('📄'); setShowNewType(false)
      toast.success(`"${t.label}" object type created`)
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Failed to create object type')
    }
  }

  const typeMeta = (key) => types.find(t => t.key === key)

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Objects</h1>
        <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
          <PlusIcon /> New
        </button>
      </div>

      {/* Type filter chips */}
      <div className={styles.chips}>
        <button
          className={`${styles.chip} ${filter === null ? styles.chipActive : ''}`}
          onClick={() => setFilter(null)}
        >
          All
        </button>
        {types.map(t => (
          <button
            key={t.key}
            className={`${styles.chip} ${filter === t.key ? styles.chipActive : ''}`}
            onClick={() => setFilter(t.key)}
          >
            <span>{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>

      <div className={styles.divider} />

      {/* Object list */}
      <div className={styles.list}>
        {objects.length === 0 && (
          <div className="empty-state">No objects yet. Tap New to create one.</div>
        )}
        {objects.map(obj => (
          <button
            key={obj.id}
            className={styles.objRow}
            onClick={() => navigate(`/objects/${obj.id}`)}
          >
            <span className={styles.objEmoji}>
              {typeMeta(obj.type)?.icon ?? '📄'}
            </span>
            <div className={styles.objInfo}>
              <span className={styles.objTitle}>{obj.title}</span>
              <span className={styles.objType}>{typeMeta(obj.type)?.label ?? obj.type}</span>
              {obj.description && (
                <span className={styles.objDesc}>{obj.description.slice(0, 80)}</span>
              )}
              {obj.tags?.length > 0 && (
                <span className={styles.objTags}>
                  {obj.tags.map(t => `#${t}`).join('  ')}
                </span>
              )}
            </div>
            <ChevronRight />
          </button>
        ))}
      </div>

      {/* Create modal */}
      {showCreate && (
        <div className={styles.modalOverlay} onClick={() => setShowCreate(false)}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <h2 className={styles.modalTitle}>New Object</h2>

            <div className={styles.typeGrid}>
              {types.map(t => (
                <button
                  key={t.key}
                  className={`${styles.typeOption} ${newType === t.key ? styles.typeOptionActive : ''}`}
                  onClick={() => setNewType(t.key)}
                >
                  <span>{t.icon}</span>
                  <span>{t.label}</span>
                </button>
              ))}
              <button
                className={styles.typeOption}
                onClick={() => setShowNewType(v => !v)}
              >
                <span>➕</span>
                <span>New Type</span>
              </button>
            </div>

            {showNewType && (
              <div className={styles.newTypeRow}>
                <input
                  className={styles.newTypeIconInput}
                  value={newTypeIcon}
                  onChange={e => setNewTypeIcon(e.target.value.slice(0, 4))}
                  maxLength={4}
                />
                <input
                  className={styles.nameInput}
                  placeholder="Type name, e.g. Recipe"
                  value={newTypeLabel}
                  onChange={e => setNewTypeLabel(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleCreateType()}
                />
                <button className="btn btn-secondary" onClick={handleCreateType}>Add</button>
              </div>
            )}

            <input
              className={styles.nameInput}
              placeholder="Name"
              value={newTitle}
              onChange={e => setNewTitle(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCreate()}
              autoFocus
            />

            <div className={styles.modalActions}>
              <button className="btn btn-secondary" onClick={() => setShowCreate(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleCreate}>Create</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function PlusIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
}
function ChevronRight() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
}
