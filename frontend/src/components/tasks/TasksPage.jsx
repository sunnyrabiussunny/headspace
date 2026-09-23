import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { listTasks, createTask, updateTask, deleteTask } from '../../api'
import toast from 'react-hot-toast'
import styles from './TasksPage.module.css'

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

export default function TasksPage() {
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)
  const [newTitle, setNewTitle] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)
  const navigate = useNavigate()

  const load = () => listTasks().then(setTasks).catch(() => {}).finally(() => setLoading(false))
  useEffect(() => { load() }, [])

  const handleAdd = async (e) => {
    e.preventDefault()
    const title = newTitle.trim()
    if (!title) return
    try {
      const task = await createTask(title)
      setTasks(prev => [task, ...prev])
      setNewTitle('')
    } catch { toast.error('Failed to add task') }
  }

  const handleToggle = async (task) => {
    setTasks(prev => prev.map(t => t.id === task.id ? { ...t, done: !t.done } : t))
    try { await updateTask(task.id, { done: !task.done }) }
    catch { toast.error('Failed to update'); load() }
  }

  const handleDelete = async (id) => {
    setTasks(prev => prev.filter(t => t.id !== id))
    setConfirmDeleteId(null)
    try { await deleteTask(id) } catch { toast.error('Failed to delete'); load() }
  }

  const undone = tasks.filter(t => !t.done)
  const done = tasks.filter(t => t.done)

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Tasks</h1>
      </div>

      <form className={styles.addRow} onSubmit={handleAdd}>
        <input
          className={styles.addInput}
          placeholder="Add a task…"
          value={newTitle}
          onChange={e => setNewTitle(e.target.value)}
        />
        <button className="btn btn-primary" type="submit">+ Create Task</button>
      </form>

      {loading && <div className={styles.empty}>Loading…</div>}
      {!loading && tasks.length === 0 && (
        <div className={styles.empty}>No tasks yet. Add one above, or write "I need to…" in a diary entry and use Create Task from this entry.</div>
      )}

      <div className={styles.list}>
        {[...undone, ...done].map(task => (
          <div key={task.id} className={`${styles.row} ${task.done ? styles.rowDone : ''}`}>
            <button className={`${styles.checkbox} ${task.done ? styles.checkboxDone : ''}`} onClick={() => handleToggle(task)} />
            <span
              className={styles.taskTitle}
              title={task.source_date ? `Created ${fmtDate(task.created_at)} — from diary entry on ${task.source_date}` : `Created ${fmtDate(task.created_at)}`}
              onClick={() => task.source_date && navigate('/', { state: { targetDate: task.source_date } })}
              style={task.source_date ? { cursor: 'pointer' } : undefined}
            >
              {task.title}
            </span>

            {confirmDeleteId === task.id ? (
              <span className={styles.confirmRow}>
                <button className={styles.confirmBtn} onClick={() => handleDelete(task.id)}>Delete</button>
                <button className={styles.cancelBtn} onClick={() => setConfirmDeleteId(null)}>Cancel</button>
              </span>
            ) : (
              <button className={styles.deleteBtn} onClick={() => setConfirmDeleteId(task.id)}>×</button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
