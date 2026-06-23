import React, { useState, useEffect, useRef, useCallback } from 'react'
import { format, startOfWeek, addDays, subWeeks, addWeeks, parseISO, isToday } from 'date-fns'
import toast from 'react-hot-toast'
import {
  getProjects, createProject, updateProject, deleteProject,
  getTasks, createTask, deleteTask,
  getRunning, startTimer, stopTimer,
  getEntries, updateTimeEntry, deleteTimeEntry,
  getReport, exportCSV,
  fmtDuration, fmtHours
} from '../../api_time'
import styles from './TimePage.module.css'

const COLORS = ['#3dbfa0','#4caf78','#c97c4e','#5b8def','#9b6fd4','#e07070','#e0c040','#60b8d4']

export default function TimePage() {
  const [tab, setTab]               = useState('dashboard')  // dashboard | projects | report
  const [projects, setProjects]     = useState([])
  const [tasks, setTasks]           = useState([])
  const [running, setRunning]       = useState(null)
  const [elapsed, setElapsed]       = useState(0)
  const [entries, setEntries]       = useState([])
  const [weekStart, setWeekStart]   = useState(startOfWeek(new Date(), { weekStartsOn: 1 }))
  const [report, setReport]         = useState(null)
  const [selProject, setSelProject] = useState('')
  const [selTask, setSelTask]       = useState('')
  const [description, setDesc]      = useState('')
  const [showAddProj, setShowAddProj] = useState(false)
  const [newProjName, setNewProjName] = useState('')
  const [newProjColor, setNewProjColor] = useState(COLORS[0])
  const [newProjClient, setNewProjClient] = useState('')
  const [editEntry, setEditEntry]   = useState(null)
  const tickRef = useRef(null)

  // Load projects + running on mount
  useEffect(() => { loadAll() }, [])

  const loadAll = useCallback(async () => {
    try {
      const [p, r] = await Promise.all([getProjects(), getRunning()])
      setProjects(p)
      if (p.length && !selProject) setSelProject(p[0].id)
      if (r) { setRunning(r); setElapsed(r.duration || 0) }
      else   { setRunning(null); setElapsed(0) }
    } catch {}
  }, [selProject])

  // Load tasks when project changes
  useEffect(() => {
    if (!selProject) return
    getTasks(selProject).then(setTasks).catch(() => {})
  }, [selProject])

  // Load week entries
  const loadWeekEntries = useCallback(async () => {
    const from = format(weekStart, 'yyyy-MM-dd')
    const to   = format(addDays(weekStart, 6), 'yyyy-MM-dd')
    try { setEntries(await getEntries({ from_date: from, to_date: to })) } catch {}
  }, [weekStart])

  useEffect(() => { loadWeekEntries() }, [loadWeekEntries])

  // Load report
  const loadReport = useCallback(async () => {
    const from = format(weekStart, 'yyyy-MM-dd')
    const to   = format(addDays(weekStart, 6), 'yyyy-MM-dd')
    try { setReport(await getReport(from, to)) } catch {}
  }, [weekStart])

  useEffect(() => { if (tab === 'report') loadReport() }, [tab, loadReport])

  // Live tick
  useEffect(() => {
    if (running) {
      tickRef.current = setInterval(() => setElapsed(s => s + 1), 1000)
    } else {
      clearInterval(tickRef.current)
    }
    return () => clearInterval(tickRef.current)
  }, [running])

  const handleStart = async () => {
    if (!selProject) { toast.error('Select a project first'); return }
    try {
      const e = await startTimer({ project_id: selProject, task_id: selTask, description })
      setRunning(e); setElapsed(0)
      toast.success('Timer started')
    } catch { toast.error('Failed to start') }
  }

  const handleStop = async () => {
    try {
      await stopTimer()
      setRunning(null); setElapsed(0)
      loadWeekEntries()
      toast.success('Timer stopped')
    } catch { toast.error('Failed to stop') }
  }

  const handleAddProject = async () => {
    if (!newProjName.trim()) return
    try {
      const p = await createProject({ name: newProjName.trim(), color: newProjColor, client: newProjClient })
      setProjects(prev => [...prev, p])
      setSelProject(p.id)
      setShowAddProj(false); setNewProjName(''); setNewProjClient('')
      toast.success('Project created')
    } catch { toast.error('Failed') }
  }

  const handleDeleteProject = async (id) => {
    if (!window.confirm('Delete project and all its time entries?')) return
    try {
      await deleteProject(id)
      setProjects(prev => prev.filter(p => p.id !== id))
      if (selProject === id) setSelProject(projects.find(p => p.id !== id)?.id || '')
      loadWeekEntries()
    } catch { toast.error('Failed') }
  }

  const handleDeleteEntry = async (id) => {
    try {
      await deleteTimeEntry(id)
      setEntries(prev => prev.filter(e => e.id !== id))
    } catch { toast.error('Failed') }
  }

  const handleSaveEntry = async () => {
    if (!editEntry) return
    try {
      const updated = await updateTimeEntry(editEntry.id, {
        description: editEntry.description,
        project_id:  editEntry.project_id,
        start_time:  editEntry.start_time,
        end_time:    editEntry.end_time,
      })
      setEntries(prev => prev.map(e => e.id === updated.id ? updated : e))
      setEditEntry(null)
      toast.success('Updated')
    } catch { toast.error('Failed') }
  }

  // Daily totals for week
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
  const dailyTotals = weekDays.map(d => {
    const dayStr = format(d, 'yyyy-MM-dd')
    const secs = entries.filter(e => e.start_time?.startsWith(dayStr)).reduce((s, e) => s + (e.duration || 0), 0)
    return { date: d, dayStr, secs }
  })
  const weekTotal = dailyTotals.reduce((s, d) => s + d.secs, 0)

  const projMap = Object.fromEntries(projects.map(p => [p.id, p]))

  const TAB_ITEMS = [
    { id: 'dashboard', label: 'Dashboard', icon: '⏱' },
    { id: 'projects',  label: 'Projects',  icon: '📁' },
    { id: 'report',    label: 'Reports',   icon: '📊' },
  ]

  return (
    <div className={styles.page}>

      {/* ── Tab bar ── */}
      <div className={styles.tabs}>
        {TAB_ITEMS.map(t => (
          <button key={t.id}
            className={`${styles.tab} ${tab === t.id ? styles.tabActive : ''}`}
            onClick={() => setTab(t.id)}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* ══════════════════ DASHBOARD ══════════════════ */}
      {tab === 'dashboard' && (
        <div className={styles.dashboard}>

          {/* Timer control card */}
          <div className={styles.timerCard}>
            <div className={styles.timerTop}>
              <div className={styles.timerControls}>
                <select className={styles.projSelect}
                  value={selProject} onChange={e => setSelProject(e.target.value)}>
                  {projects.length === 0 && <option value="">No projects yet</option>}
                  {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                {tasks.length > 0 && (
                  <select className={styles.projSelect}
                    value={selTask} onChange={e => setSelTask(e.target.value)}>
                    <option value="">No task</option>
                    {tasks.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                )}
                <input className={styles.descInput}
                  placeholder="What are you working on?"
                  value={description} onChange={e => setDesc(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && !running && handleStart()}
                />
              </div>

              <div className={styles.timerRight}>
                <div className={styles.liveTimer}>{fmtDuration(elapsed)}</div>
                {running ? (
                  <button className={`${styles.startBtn} ${styles.stopBtn}`} onClick={handleStop}>
                    <StopIcon /> Stop
                  </button>
                ) : (
                  <button className={styles.startBtn} onClick={handleStart}>
                    <PlayIcon /> Start
                  </button>
                )}
              </div>
            </div>

            {running && (
              <div className={styles.runningBanner}>
                <span className={styles.runningDot} />
                Running — {projMap[running.project_id]?.name || 'Unknown project'}
                {running.description ? ` · ${running.description}` : ''}
              </div>
            )}
          </div>

          {/* Week navigation + daily totals */}
          <div className={styles.weekHeader}>
            <button className={styles.weekNav} onClick={() => setWeekStart(subWeeks(weekStart, 1))}>‹</button>
            <span className={styles.weekLabel}>
              {format(weekStart, 'd MMM')} – {format(addDays(weekStart, 6), 'd MMM yyyy')}
              <span className={styles.weekTotal}>{fmtHours(weekTotal)} total</span>
            </span>
            <button className={styles.weekNav} onClick={() => setWeekStart(addWeeks(weekStart, 1))}>›</button>
            <button className={styles.todayBtn} onClick={() => setWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }))}>Today</button>
          </div>

          {/* Daily columns */}
          <div className={styles.weekGrid}>
            {dailyTotals.map(({ date: d, dayStr, secs }) => {
              const dayEntries = entries.filter(e => e.start_time?.startsWith(dayStr))
              const today = isToday(d)
              return (
                <div key={dayStr} className={`${styles.dayCol} ${today ? styles.dayColToday : ''}`}>
                  <div className={styles.dayHead}>
                    <span className={styles.dayName}>{format(d, 'EEE')}</span>
                    <span className={styles.dayNum}>{format(d, 'd')}</span>
                    <span className={styles.dayTotal}>{secs > 0 ? fmtHours(secs) : ''}</span>
                  </div>
                  <div className={styles.dayEntries}>
                    {dayEntries.length === 0 && (
                      <div className={styles.dayEmpty}>—</div>
                    )}
                    {dayEntries.map(e => {
                      const proj = projMap[e.project_id]
                      return (
                        <div key={e.id} className={styles.entryBlock}
                          style={{ borderLeft: `3px solid ${proj?.color || '#888'}` }}>
                          <div className={styles.entryBlockTop}>
                            <span className={styles.entryProj}>{proj?.name || '?'}</span>
                            <span className={styles.entryDur}>{fmtHours(e.duration)}</span>
                          </div>
                          {e.description && <div className={styles.entryDesc}>{e.description}</div>}
                          <div className={styles.entryTime}>
                            {e.start_time ? format(parseISO(e.start_time), 'HH:mm') : ''}
                            {e.end_time   ? ` – ${format(parseISO(e.end_time), 'HH:mm')}` : ''}
                          </div>
                          <div className={styles.entryActions}>
                            <button onClick={() => setEditEntry({...e})} className={styles.entryBtn}>Edit</button>
                            <button onClick={() => handleDeleteEntry(e.id)} className={`${styles.entryBtn} ${styles.entryBtnDel}`}>×</button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Edit entry modal */}
          {editEntry && (
            <div className={styles.modalOverlay} onClick={() => setEditEntry(null)}>
              <div className={styles.modal} onClick={e => e.stopPropagation()}>
                <h3 className={styles.modalTitle}>Edit Time Entry</h3>
                <div className={styles.formRow}>
                  <label className={styles.formLabel}>Project</label>
                  <select className={styles.formInput}
                    value={editEntry.project_id}
                    onChange={e => setEditEntry({...editEntry, project_id: e.target.value})}>
                    {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
                <div className={styles.formRow}>
                  <label className={styles.formLabel}>Description</label>
                  <input className={styles.formInput}
                    value={editEntry.description}
                    onChange={e => setEditEntry({...editEntry, description: e.target.value})}
                  />
                </div>
                <div className={styles.formRow}>
                  <label className={styles.formLabel}>Start</label>
                  <input type="datetime-local" className={styles.formInput}
                    value={editEntry.start_time ? editEntry.start_time.replace('Z','').slice(0,16) : ''}
                    onChange={e => setEditEntry({...editEntry, start_time: e.target.value + ':00Z'})}
                  />
                </div>
                <div className={styles.formRow}>
                  <label className={styles.formLabel}>End</label>
                  <input type="datetime-local" className={styles.formInput}
                    value={editEntry.end_time ? editEntry.end_time.replace('Z','').slice(0,16) : ''}
                    onChange={e => setEditEntry({...editEntry, end_time: e.target.value + ':00Z'})}
                  />
                </div>
                <div className={styles.modalActions}>
                  <button className="btn btn-secondary" onClick={() => setEditEntry(null)}>Cancel</button>
                  <button className="btn btn-primary" onClick={handleSaveEntry}>Save</button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ══════════════════ PROJECTS ══════════════════ */}
      {tab === 'projects' && (
        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>Projects</h2>
            <button className="btn btn-primary" onClick={() => setShowAddProj(true)}>+ New Project</button>
          </div>

          {showAddProj && (
            <div className={styles.addProjCard}>
              <input className={styles.formInput} placeholder="Project name"
                value={newProjName} onChange={e => setNewProjName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAddProject()} autoFocus />
              <input className={styles.formInput} placeholder="Client (optional)"
                value={newProjClient} onChange={e => setNewProjClient(e.target.value)} />
              <div className={styles.colorRow}>
                {COLORS.map(c => (
                  <button key={c} className={`${styles.colorDot} ${newProjColor === c ? styles.colorDotActive : ''}`}
                    style={{ background: c }} onClick={() => setNewProjColor(c)} />
                ))}
              </div>
              <div className={styles.modalActions}>
                <button className="btn btn-secondary" onClick={() => setShowAddProj(false)}>Cancel</button>
                <button className="btn btn-primary" onClick={handleAddProject}>Create</button>
              </div>
            </div>
          )}

          <div className={styles.projList}>
            {projects.length === 0 && <div className={styles.empty}>No projects yet. Create one to start tracking.</div>}
            {projects.map(p => (
              <div key={p.id} className={styles.projRow}>
                <span className={styles.projDot} style={{ background: p.color }} />
                <div className={styles.projInfo}>
                  <span className={styles.projName}>{p.name}</span>
                  {p.client && <span className={styles.projClient}>{p.client}</span>}
                </div>
                <div className={styles.projWeekTotal}>
                  {fmtHours(entries.filter(e => e.project_id === p.id).reduce((s, e) => s + (e.duration||0), 0))} this week
                </div>
                <button className={styles.entryBtn} onClick={() => setSelProject(p.id) || setTab('dashboard')}>
                  Track
                </button>
                <button className={`${styles.entryBtn} ${styles.entryBtnDel}`}
                  onClick={() => handleDeleteProject(p.id)}>Delete</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ══════════════════ REPORTS ══════════════════ */}
      {tab === 'report' && (
        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>Report</h2>
            <div style={{ display:'flex', gap:8 }}>
              <button className="btn btn-secondary"
                onClick={() => exportCSV(format(weekStart,'yyyy-MM-dd'), format(addDays(weekStart,6),'yyyy-MM-dd'))}>
                ↓ Export CSV
              </button>
            </div>
          </div>

          <div className={styles.weekHeader} style={{ marginBottom: 16 }}>
            <button className={styles.weekNav} onClick={() => setWeekStart(subWeeks(weekStart, 1))}>‹</button>
            <span className={styles.weekLabel}>
              {format(weekStart, 'd MMM')} – {format(addDays(weekStart, 6), 'd MMM yyyy')}
            </span>
            <button className={styles.weekNav} onClick={() => setWeekStart(addWeeks(weekStart, 1))}>›</button>
          </div>

          {report ? (
            <>
              {/* Summary cards */}
              <div className={styles.summaryCards}>
                <div className={styles.summaryCard}>
                  <div className={styles.summaryVal}>{fmtHours(report.total_seconds)}</div>
                  <div className={styles.summaryLabel}>Total this week</div>
                </div>
                <div className={styles.summaryCard}>
                  <div className={styles.summaryVal}>
                    {report.daily.length > 0 ? fmtHours(report.total_seconds / Math.max(1, report.daily.filter(d=>d.seconds>0).length)) : '0h'}
                  </div>
                  <div className={styles.summaryLabel}>Avg per active day</div>
                </div>
                <div className={styles.summaryCard}>
                  <div className={styles.summaryVal}>{report.by_project.length}</div>
                  <div className={styles.summaryLabel}>Projects worked</div>
                </div>
              </div>

              {/* Stacked bar chart */}
              <div className={styles.chartSection}>
                <div className={styles.chartTitle}>Daily breakdown</div>
                <BarChart daily={report.daily} byProject={report.by_project} weekDays={weekDays} entries={entries} projMap={projMap} />
              </div>

              {/* Per-project breakdown */}
              <div className={styles.chartSection}>
                <div className={styles.chartTitle}>By project</div>
                {report.by_project.map(p => {
                  const pct = report.total_seconds > 0 ? (p.seconds / report.total_seconds) * 100 : 0
                  return (
                    <div key={p.project_id} className={styles.projBar}>
                      <div className={styles.projBarName}>{p.name}</div>
                      <div className={styles.projBarTrack}>
                        <div className={styles.projBarFill} style={{ width: `${pct}%`, background: p.color }} />
                      </div>
                      <div className={styles.projBarHours}>{fmtHours(p.seconds)}</div>
                    </div>
                  )
                })}
              </div>
            </>
          ) : (
            <div className={styles.empty}>Loading report…</div>
          )}
        </div>
      )}
    </div>
  )
}

function BarChart({ daily, byProject, weekDays, entries, projMap }) {
  const maxSecs = Math.max(...daily.map(d => d.seconds), 1)
  return (
    <div style={{ display:'flex', gap:6, alignItems:'flex-end', height:120, marginTop:8 }}>
      {weekDays.map(d => {
        const dayStr = format(d, 'yyyy-MM-dd')
        const dayEntry = daily.find(x => x.date === dayStr)
        const secs = dayEntry?.seconds || 0
        const heightPct = (secs / maxSecs) * 100
        const dayEnts = entries.filter(e => e.start_time?.startsWith(dayStr))
        const today = isToday(d)
        return (
          <div key={dayStr} style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', gap:4 }}>
            <div style={{ fontSize:10, color:'var(--text-muted)' }}>{secs > 0 ? fmtHours(secs) : ''}</div>
            <div style={{ width:'100%', flex:1, display:'flex', flexDirection:'column', justifyContent:'flex-end' }}>
              {secs > 0 && (
                <div style={{ width:'100%', height:`${heightPct}%`, minHeight:4, borderRadius:4, overflow:'hidden', display:'flex', flexDirection:'column-reverse' }}>
                  {dayEnts.map((e,i) => {
                    const proj = projMap[e.project_id]
                    const pct = (e.duration / secs) * 100
                    return <div key={e.id} style={{ width:'100%', height:`${pct}%`, background: proj?.color || '#888', minHeight:2 }} />
                  })}
                </div>
              )}
              {secs === 0 && <div style={{ width:'100%', height:4, background:'var(--bg-card)', borderRadius:4 }} />}
            </div>
            <div style={{ fontSize:10, color: today ? 'var(--accent-teal)' : 'var(--text-muted)', fontWeight: today ? 700 : 400 }}>
              {format(d, 'EEE')}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function PlayIcon() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg> }
function StopIcon() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="3" width="18" height="18" rx="2"/></svg> }
