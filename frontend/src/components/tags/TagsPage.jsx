import React, { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { listTags, renameTag, deleteTag, getAllEntries } from '../../api'
import styles from './TagsPage.module.css'

export default function TagsPage() {
  const [tags, setTags]           = useState([])
  const [loading, setLoading]     = useState(true)
  const [renaming, setRenaming]   = useState(null)  // tag name being renamed
  const [newName, setNewName]     = useState('')
  const [confirmDel, setConfirmDel] = useState(null)
  const navigate = useNavigate()

  const load = useCallback(async () => {
    setLoading(true)
    try { setTags(await listTags()) }
    catch { toast.error('Failed to load tags') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const handleRename = async (oldName) => {
    if (!newName.trim() || newName.trim() === oldName) { setRenaming(null); return }
    try {
      await renameTag(oldName, newName.trim())
      toast.success(`Renamed #${oldName} → #${newName.trim()}`)
      setRenaming(null)
      setNewName('')
      load()
    } catch { toast.error('Failed to rename') }
  }

  const handleDelete = async (name) => {
    try {
      await deleteTag(name)
      toast.success(`Deleted #${name}`)
      setConfirmDel(null)
      load()
    } catch { toast.error('Failed to delete') }
  }

  const totalTags = tags.length
  const totalUses = tags.reduce((s, t) => s + t.total, 0)

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Tags</h1>
        <div className={styles.stats}>
          <span className={styles.stat}>{totalTags} tags</span>
          <span className={styles.statSep}>·</span>
          <span className={styles.stat}>{totalUses} uses</span>
        </div>
      </div>

      <p className={styles.subtitle}>All tags used across diary entries and objects. Rename or delete globally.</p>

      <div className={styles.divider} />

      {loading ? (
        <div className={styles.empty}>Loading...</div>
      ) : tags.length === 0 ? (
        <div className={styles.empty}>
          No tags yet. Write <code>#tagname</code> in any diary entry to create one.
        </div>
      ) : (
        <div className={styles.list}>
          {tags.map(tag => (
            <div key={tag.name} className={styles.row}>
              {renaming === tag.name ? (
                <div className={styles.renameRow}>
                  <span className={styles.tagHash}>#</span>
                  <input
                    className={styles.renameInput}
                    value={newName}
                    onChange={e => setNewName(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') handleRename(tag.name)
                      if (e.key === 'Escape') { setRenaming(null); setNewName('') }
                    }}
                    autoFocus
                    placeholder={tag.name}
                  />
                  <button className={styles.saveBtn} onClick={() => handleRename(tag.name)}>Save</button>
                  <button className={styles.cancelBtn} onClick={() => { setRenaming(null); setNewName('') }}>Cancel</button>
                </div>
              ) : (
                <>
                  <div className={styles.tagInfo}>
                    <span className={styles.tagName}>#{tag.name}</span>
                    <span className={styles.tagMeta}>
                      {tag.diary_count > 0 && <span>{tag.diary_count} diary</span>}
                      {tag.diary_count > 0 && tag.object_count > 0 && <span className={styles.dot}>·</span>}
                      {tag.object_count > 0 && <span>{tag.object_count} objects</span>}
                    </span>
                  </div>

                  <div className={styles.actions}>
                    <button
                      className={styles.actionBtn}
                      onClick={() => navigate(`/all?tag=${tag.name}`)}
                      title="View entries with this tag"
                    >
                      <EyeIcon />
                    </button>
                    <button
                      className={styles.actionBtn}
                      onClick={() => { setRenaming(tag.name); setNewName(tag.name) }}
                      title="Rename tag"
                    >
                      <EditIcon />
                    </button>
                    {confirmDel === tag.name ? (
                      <span className={styles.confirmRow}>
                        <span className={styles.confirmText}>Remove from all?</span>
                        <button className={styles.confirmYes} onClick={() => handleDelete(tag.name)}>Yes</button>
                        <button className={styles.cancelBtn} onClick={() => setConfirmDel(null)}>No</button>
                      </span>
                    ) : (
                      <button
                        className={`${styles.actionBtn} ${styles.deleteBtn}`}
                        onClick={() => setConfirmDel(tag.name)}
                        title="Delete tag globally"
                      >
                        <TrashIcon />
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function EyeIcon()  { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg> }
function EditIcon() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> }
function TrashIcon(){ return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg> }
