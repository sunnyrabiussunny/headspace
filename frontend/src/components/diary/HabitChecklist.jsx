import React, { useState, useEffect, useCallback } from 'react'
import { listHabits, getCompletions, toggleHabit, createHabit, updateHabit, deleteHabit } from '../../api'
import styles from './HabitChecklist.module.css'

const ICONS = ['✓','🌅','☀️','🌤','🌇','🌙','💧','📖','🏃','🤝','🧘','🥗','💊','✍️','🎯','🎸','🛌','🚶','🙏','❤️']

export default function HabitChecklist({ date }) {
  const [habits,     setHabits]     = useState([])
  const [completed,  setCompleted]  = useState(new Set())
  const [showManage, setShowManage] = useState(false)
  const [newTitle,   setNewTitle]   = useState('')
  const [newIcon,    setNewIcon]    = useState('✓')
  const [editing,    setEditing]    = useState(null)  // {id, title, icon}
  const [loading,    setLoading]    = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [h, c] = await Promise.all([listHabits(), getCompletions(date)])
      setHabits(h)
      setCompleted(new Set(c.completed))
    } catch {}
    finally { setLoading(false) }
  }, [date])

  useEffect(() => { load() }, [load])

  const handleToggle = async (habitId) => {
    // Optimistic update
    setCompleted(prev => {
      const next = new Set(prev)
      if (next.has(habitId)) next.delete(habitId)
      else next.add(habitId)
      return next
    })
    // Optimistically update health to green if completing today
    const today = new Date().toISOString().slice(0, 10)
    if (date === today) {
      setHabits(prev => prev.map(h =>
        h.id === habitId ? { ...h, health: !completed.has(habitId) ? 'green' : h.health } : h
      ))
    }
    try {
      await toggleHabit(habitId, date)
    } catch {
      // Revert on error
      setCompleted(prev => {
        const next = new Set(prev)
        if (next.has(habitId)) next.delete(habitId)
        else next.add(habitId)
        return next
      })
    }
  }

  const handleAdd = async () => {
    if (!newTitle.trim() || habits.length >= 15) return
    try {
      const h = await createHabit({ title: newTitle.trim(), icon: newIcon, sort_order: habits.length })
      setHabits(prev => [...prev, h])
      setNewTitle(''); setNewIcon('✓')
    } catch {}
  }

  const handleUpdate = async () => {
    if (!editing || !editing.title.trim()) return
    try {
      const h = await updateHabit(editing.id, { title: editing.title.trim(), icon: editing.icon })
      setHabits(prev => prev.map(x => x.id === h.id ? h : x))
      setEditing(null)
    } catch {}
  }

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this habit and all its history?')) return
    try {
      await deleteHabit(id)
      setHabits(prev => prev.filter(h => h.id !== id))
    } catch {}
  }

  const healthColor = (h) => {
    if (h.health === 'green') return 'var(--accent-green, #4caf78)'
    if (h.health === 'yellow') return '#e0c040'
    return 'var(--accent-red, #c0392b)'
  }

  if (loading) return null

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <span className={styles.title}>Habits</span>
        <button className={styles.manageBtn} onClick={() => setShowManage(v => !v)}>
          {showManage ? 'Done' : '⚙ Manage'}
        </button>
      </div>

      {/* Habit cards — horizontal wrapping row */}
      <div className={styles.grid}>
        {habits.map(h => {
          const done = completed.has(h.id)
          return (
            <button
              key={h.id}
              className={`${styles.card} ${done ? styles.cardDone : styles.cardTodo}`}
              onClick={() => handleToggle(h.id)}
            >
              {/* Health indicator dot */}
              <span className={styles.healthDot} style={{ background: healthColor(h) }} />

              {/* Circular checkbox */}
              <span className={`${styles.check} ${done ? styles.checkDone : ''}`}>
                {done && <span className={styles.checkMark}>✓</span>}
              </span>

              {/* Icon */}
              <span className={styles.icon}>{h.icon}</span>

              {/* Title */}
              <span className={styles.label}>{h.title}</span>
            </button>
          )
        })}
      </div>

      {/* Manage panel */}
      {showManage && (
        <div className={styles.managePanel}>
          <div className={styles.managePanelTitle}>Manage Habits ({habits.length}/15)</div>

          {/* Existing habits */}
          {habits.map(h => (
            <div key={h.id} className={styles.manageRow}>
              {editing?.id === h.id ? (
                <>
                  <select className={styles.iconPicker}
                    value={editing.icon}
                    onChange={e => setEditing({...editing, icon: e.target.value})}>
                    {ICONS.map(ic => <option key={ic} value={ic}>{ic}</option>)}
                  </select>
                  <input className={styles.editInput}
                    value={editing.title}
                    onChange={e => setEditing({...editing, title: e.target.value})}
                    onKeyDown={e => { if (e.key === 'Enter') handleUpdate(); if (e.key === 'Escape') setEditing(null) }}
                    autoFocus
                  />
                  <button className={styles.saveBtn} onClick={handleUpdate}>Save</button>
                  <button className={styles.cancelBtn} onClick={() => setEditing(null)}>×</button>
                </>
              ) : (
                <>
                  <span className={styles.manageIcon}>{h.icon}</span>
                  <span className={styles.manageTitle}>{h.title}</span>
                  <span className={styles.manageHealth} style={{ color: healthColor(h) }}>●</span>
                  <button className={styles.editBtn}
                    onClick={() => setEditing({ id: h.id, title: h.title, icon: h.icon })}>
                    Edit
                  </button>
                  <button className={styles.delBtn} onClick={() => handleDelete(h.id)}>×</button>
                </>
              )}
            </div>
          ))}

          {/* Add new habit */}
          {habits.length < 15 && (
            <div className={styles.addRow}>
              <select className={styles.iconPicker}
                value={newIcon} onChange={e => setNewIcon(e.target.value)}>
                {ICONS.map(ic => <option key={ic} value={ic}>{ic}</option>)}
              </select>
              <input className={styles.editInput}
                placeholder="New habit name..."
                value={newTitle}
                onChange={e => setNewTitle(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAdd()}
              />
              <button className={styles.saveBtn} onClick={handleAdd}
                disabled={!newTitle.trim()}>
                + Add
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
