import React, { useState, useEffect } from 'react'
import { listActiveTasks, updateTask } from '../../api'
import styles from './PendingTasks.module.css'

export default function PendingTasks({ date }) {
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)

  const load = () => listActiveTasks(date).then(setTasks).catch(() => setTasks([])).finally(() => setLoading(false))
  useEffect(() => { load() }, [date])

  const handleCheck = async (task) => {
    setTasks(prev => prev.filter(t => t.id !== task.id))   // checking it off removes it from every day's view from now on
    try { await updateTask(task.id, { done: true }) } catch { load() }
  }

  if (loading || tasks.length === 0) return null

  return (
    <div className={styles.wrap}>
      <div className={styles.label}>Pending Tasks</div>
      {tasks.map(t => (
        <div key={t.id} className={styles.row}>
          <button className={styles.checkbox} onClick={() => handleCheck(t)} />
          <span className={styles.title}>{t.title}</span>
        </div>
      ))}
    </div>
  )
}
