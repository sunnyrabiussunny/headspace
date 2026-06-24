import React, { useState, useEffect, useRef, useCallback } from 'react'
import { format, startOfWeek, addDays, subWeeks, addWeeks, parseISO, isToday } from 'date-fns'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import {
  getProjects, createProject, deleteProject,
  getTasks, createTask,
  getRunning, startTimer, stopTimer,
  getEntries, updateTimeEntry, deleteTimeEntry,
  getReport, exportCSV,
  fmtDuration, fmtHours
} from '../../api_time'
import { mentionSearch } from '../../api'
import styles from './TimePage.module.css'

const COLORS = ['#3dbfa0','#4caf78','#c97c4e','#5b8def','#9b6fd4','#e07070','#e0c040','#60b8d4']
const TAG_RE  = /#([a-zA-Z0-9_-]+)/g

// ── Smart description input with @mentions and #tags ──────────────────────
function SmartDescInput({ value, onChange, onSubmit, placeholder }) {
  const [query, setQuery]     = useState(null)
  const [results, setResults] = useState([])
  const [selIdx, setSelIdx]   = useState(0)
  const [anchor, setAnchor]   = useState(-1)
  const taRef = useRef(null)

  useEffect(() => {
    if (query === null) { setResults([]); return }
    mentionSearch(query).then(setResults).catch(() => {})
  }, [query])

  const handleChange = (e) => {
    const val = e.target.value
    onChange(val)
    const cursor = e.target.selectionStart
    const before = val.slice(0, cursor)
    const atIdx  = before.lastIndexOf('@')
    if (atIdx >= 0 && !before.slice(atIdx).includes(' ')) {
      setAnchor(atIdx)
      setQuery(before.slice(atIdx + 1))
    } else {
      setQuery(null)
    }
  }

  const insertMention = (obj) => {
    const ta = taRef.current
    if (!ta || anchor < 0) return
    const before = value.slice(0, anchor)
    const after  = value.slice(ta.selectionStart)
    const token  = `@[${obj.title}](${obj.id})`
    const newVal = before + token + ' ' + after
    onChange(newVal)
    setQuery(null)
    setTimeout(() => {
      const pos = before.length + token.length + 1
      ta.setSelectionRange(pos, pos)
      ta.focus()
    }, 0)
  }

  const handleKeyDown = (e) => {
    if (query !== null && results.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSelIdx(i => Math.min(i+1, results.length-1)) }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setSelIdx(i => Math.max(i-1, 0)) }
      if (e.key === 'Enter')     { e.preventDefault(); insertMention(results[selIdx]); return }
      if (e.key === 'Escape')    { setQuery(null); return }
    }
    if (e.key === 'Enter' && query === null) { e.preventDefault(); onSubmit?.() }
  }

  const TYPE_EMOJI = { PERSON:'👤', PLACE:'📍', IDEA:'💡', ORGANIZATION:'🏢', MEDIA:'🎬' }

  return (
    <div style={{ position:'relative', flex:1 }}>
      <input
        ref={taRef}
        className={styles.descInput}
        placeholder={placeholder || 'What are you working on? Use @ to link objects, # for tags'}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
      />
      {query !== null && (
        <div className={styles.mentionPopup}>
          {results.length === 0 && query && <div className={styles.mentionHint}>No objects found</div>}
          {results.map((r, i) => (
            <div key={r.id}
              className={`${styles.mentionRow} ${i === selIdx ? styles.mentionActive : ''}`}
              onMouseDown={e => { e.preventDefault(); insertMention(r) }}>
              <span>{TYPE_EMOJI[r.type] || '📄'}</span>
              <span>{r.title}</span>
              <span className={styles.mentionType}>{r.type}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Render description with @mention links ────────────────────────────────
function RichDesc({ text, navigate }) {
  if (!text) return null
  const MENTION_RE = /@\[([^\]]+)\]\(([^)]+)\)/g
  const parts = []; let last = 0, m
  MENTION_RE.lastIndex = 0
  while ((m = MENTION_RE.exec(text)) !== null) {
    if (m.index > last) parts.push(<span key={`t${last}`}>{text.slice(last, m.index)}</span>)
    parts.push(<span key={`m${m.index}`} className={styles.mentionLink}
      onClick={() => navigate(`/objects/${m[2]}`)}>{m[1]}</span>)
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push(<span key="end">{text.slice(last)}</span>)
  return <span>{parts}</span>
}

export default function TimePage() {
  const [tab, setTab]               = useState('dashboard')
  const [projects, setProjects]     = useState([])
  const [running, setRunning]       = useState(null)
  const [elapsed, setElapsed]       = useState(0)
  const [entries, setEntries]       = useState([])
  const [weekStart, setWeekStart]   = useState(startOfWeek(new Date(), { weekStartsOn: 1 }))
  const [report, setReport]         = useState(null)
  const [selProject, setSelProject] = useState('')
  const [description, setDesc]      = useState('')
  const [showAddProj, setShowAddProj] = useState(false)
  const [newProjName, setNewProjName] = useState('')
  const [newProjColor, setNewProjColor] = useState(COLORS[0])
  const [newProjClient, setNewProjClient] = useState('')
  const [editEntry, setEditEntry]   = useState(null)
  const [detailDay, setDetailDay]   = useState(null)  // for day detail modal
  const tickRef  = useRef(null)
  const navigate = useNavigate()

  useEffect(() => { loadAll() }, [])

  const loadAll = useCallback(async () => {
    try {
      const [p, r] = await Promise.all([getProjects(), getRunning()])
      setProjects(p)
      if (p.length && !selProject) setSelProject(p[0]?.id || '')
      if (r) { setRunning(r); setElapsed(r.duration || 0) }
      else   { setRunning(null); setElapsed(0) }
    } catch {}
  }, [selProject])

  const loadWeekEntries = useCallback(async () => {
    const from = format(weekStart, 'yyyy-MM-dd')
    const to   = format(addDays(weekStart, 6), 'yyyy-MM-dd')
    try { setEntries(await getEntries({ from_date: from, to_date: to })) } catch {}
  }, [weekStart])

  useEffect(() => { loadWeekEntries() }, [loadWeekEntries])

  const loadReport = useCallback(async () => {
    const from = format(weekStart, 'yyyy-MM-dd')
    const to   = format(addDays(weekStart, 6), 'yyyy-MM-dd')
    try { setReport(await getReport(from, to)) } catch {}
  }, [weekStart])

  useEffect(() => { if (tab === 'report') loadReport() }, [tab, loadReport])

  // Live tick
  useEffect(() => {
    if (running) {
      const startMs = new Date(running.start_time).getTime()
      tickRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - startMs) / 1000))
      }, 1000)
    } else {
      clearInterval(tickRef.current)
    }
    return () => clearInterval(tickRef.current)
  }, [running])

  const handleStart = async () => {
    if (!selProject) { toast.error('Select a project first'); return }
    try {
      const e = await startTimer({ project_id: selProject, description })
      setRunning(e); setElapsed(0); setDesc('')
      loadWeekEntries()
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
      await deleteTimeEntry(id); loadWeekEntries()
    } catch { toast.error('Failed') }
  }

  const handleSaveEntry = async () => {
    if (!editEntry) return
    try {
      await updateTimeEntry(editEntry.id, {
        description: editEntry.description,
        project_id:  editEntry.project_id,
        start_time:  editEntry.start_time,
        end_time:    editEntry.end_time,
      })
      loadWeekEntries(); setEditEntry(null)
      toast.success('Updated')
    } catch { toast.error('Failed') }
  }

  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
  const projMap  = Object.fromEntries(projects.map(p => [p.id, p]))

  // Group entries by project for a day — combined totals
  const getDayGroups = (dayStr) => {
    const dayEntries = entries.filter(e => e.start_time?.startsWith(dayStr))
    const groups = {}
    dayEntries.forEach(e => {
      if (!groups[e.project_id]) groups[e.project_id] = { project_id: e.project_id, total: 0, entries: [] }
      groups[e.project_id].total += (e.duration || 0)
      groups[e.project_id].entries.push(e)
    })
    return Object.values(groups).sort((a, b) => b.total - a.total)
  }

  const weekTotal = entries.reduce((s, e) => s + (e.duration || 0), 0)

  const TAB_ITEMS = [
    { id: 'dashboard', label: 'Dashboard', icon: '⏱' },
    { id: 'projects',  label: 'Projects',  icon: '📁' },
    { id: 'report',    label: 'Reports',   icon: '📊' },
  ]

  return (
    <div className={styles.page}>
      <div className={styles.tabs}>
        {TAB_ITEMS.map(t => (
          <button key={t.id}
            className={`${styles.tab} ${tab === t.id ? styles.tabActive : ''}`}
            onClick={() => setTab(t.id)}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* ══ DASHBOARD ══ */}
      {tab === 'dashboard' && (
        <div className={styles.dashboard}>

          {/* Timer card */}
          <div className={styles.timerCard}>
            <div className={styles.timerTop}>
              <div className={styles.timerControls}>
                <select className={styles.projSelect}
                  value={selProject} onChange={e => setSelProject(e.target.value)}>
                  {projects.length === 0 && <option value="">Create a project first</option>}
                  {projects.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.name}{p.client ? ` · ${p.client}` : ''}
                    </option>
                  ))}
                </select>
                <SmartDescInput
                  value={description}
                  onChange={setDesc}
                  onSubmit={!running ? handleStart : undefined}
                  placeholder="What are you working on? (@mention objects, #tags)"
                />
              </div>
              <div className={styles.timerRight}>
                <div className={`${styles.liveTimer} ${running ? styles.liveTimerRunning : ''}`}>
                  {fmtDuration(elapsed)}
                </div>
                {running ? (
                  <button className={`${styles.startBtn} ${styles.stopBtn}`} onClick={handleStop}>
                    <StopIcon /> Stop
                  </button>
                ) : (
                  <button className={styles.startBtn} onClick={handleStart}
                    disabled={!selProject}>
                    <PlayIcon /> Start
                  </button>
                )}
              </div>
            </div>
            {running && (
              <div className={styles.runningBanner}>
                <span className={styles.runningDot} />
                <span>
                  <strong>{projMap[running.project_id]?.name || 'Unknown'}</strong>
                  {running.description ? ` · ${running.description.replace(/@\[([^\]]+)\]\([^)]+\)/g, '@$1')}` : ''}
                </span>
              </div>
            )}
          </div>

          {/* Week nav */}
          <div className={styles.weekHeader}>
            <button className={styles.weekNav} onClick={() => setWeekStart(subWeeks(weekStart, 1))}>‹</button>
            <span className={styles.weekLabel}>
              {format(weekStart, 'd MMM')} – {format(addDays(weekStart, 6), 'd MMM yyyy')}
              {weekTotal > 0 && <span className={styles.weekTotal}>{fmtHours(weekTotal)}</span>}
            </span>
            <button className={styles.weekNav} onClick={() => setWeekStart(addWeeks(weekStart, 1))}>›</button>
            <button className={styles.todayBtn}
              onClick={() => setWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }))}>
              Today
            </button>
          </div>

          {/* Week grid — combined per-project per-day */}
          <div className={styles.weekGrid}>
            {weekDays.map(d => {
              const dayStr = format(d, 'yyyy-MM-dd')
              const groups = getDayGroups(dayStr)
              const dayTotal = groups.reduce((s, g) => s + g.total, 0)
              const today = isToday(d)
              return (
                <div key={dayStr} className={`${styles.dayCol} ${today ? styles.dayColToday : ''}`}>
                  <div className={styles.dayHead}>
                    <span className={styles.dayName}>{format(d, 'EEE')}</span>
                    <span className={`${styles.dayNum} ${today ? styles.dayNumToday : ''}`}>
                      {format(d, 'd')}
                    </span>
                    {dayTotal > 0 && <span className={styles.dayTotal}>{fmtHours(dayTotal)}</span>}
                  </div>
                  <div className={styles.dayEntries}>
                    {groups.length === 0 && <div className={styles.dayEmpty}>—</div>}
                    {groups.map(g => {
                      const proj = projMap[g.project_id]
                      return (
                        <div key={g.project_id} className={styles.groupBlock}
                          style={{ borderLeft: `3px solid ${proj?.color || '#888'}` }}
                          onClick={() => setDetailDay({ dayStr, groups, dayTotal })}>
                          <div className={styles.groupTop}>
                            <span className={styles.groupProj}
                              style={{ color: proj?.color || 'var(--text-primary)' }}>
                              {proj?.name || '?'}
                            </span>
                            <span className={styles.groupDur}>{fmtHours(g.total)}</span>
                          </div>
                          {g.entries.length > 1 && (
                            <div className={styles.groupSessions}>{g.entries.length} sessions</div>
                          )}
                          {g.entries.length === 1 && g.entries[0].description && (
                            <div className={styles.groupDesc}>
                              {g.entries[0].description.replace(/@\[([^\]]+)\]\([^)]+\)/g, '@$1').slice(0, 30)}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ══ PROJECTS ══ */}
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
                  <button key={c}
                    className={`${styles.colorDot} ${newProjColor === c ? styles.colorDotActive : ''}`}
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
            {projects.length === 0 && <div className={styles.empty}>No projects yet.</div>}
            {projects.map(p => {
              const weekSecs = entries.filter(e => e.project_id === p.id).reduce((s, e) => s + (e.duration||0), 0)
              return (
                <div key={p.id} className={styles.projRow}>
                  <span className={styles.projDot} style={{ background: p.color }} />
                  <div className={styles.projInfo}>
                    <span className={styles.projName}>{p.name}</span>
                    {p.client && <span className={styles.projClient}>{p.client}</span>}
                  </div>
                  <div className={styles.projWeekTotal}>{fmtHours(weekSecs)} this week</div>
                  <button className={styles.entryBtn}
                    onClick={() => { setSelProject(p.id); setTab('dashboard') }}>Track</button>
                  <button className={`${styles.entryBtn} ${styles.entryBtnDel}`}
                    onClick={() => handleDeleteProject(p.id)}>Delete</button>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ══ REPORTS ══ */}
      {tab === 'report' && (
        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>Report</h2>
            <button className="btn btn-secondary"
              onClick={() => exportCSV(format(weekStart,'yyyy-MM-dd'), format(addDays(weekStart,6),'yyyy-MM-dd'))}>
              ↓ Export CSV
            </button>
          </div>
          <div className={styles.weekHeader} style={{ marginBottom:16 }}>
            <button className={styles.weekNav} onClick={() => setWeekStart(subWeeks(weekStart,1))}>‹</button>
            <span className={styles.weekLabel}>
              {format(weekStart,'d MMM')} – {format(addDays(weekStart,6),'d MMM yyyy')}
            </span>
            <button className={styles.weekNav} onClick={() => setWeekStart(addWeeks(weekStart,1))}>›</button>
          </div>
          {report ? (
            <>
              <div className={styles.summaryCards}>
                <div className={styles.summaryCard}>
                  <div className={styles.summaryVal}>{fmtHours(report.total_seconds)}</div>
                  <div className={styles.summaryLabel}>Total this week</div>
                </div>
                <div className={styles.summaryCard}>
                  <div className={styles.summaryVal}>
                    {report.daily.filter(d=>d.seconds>0).length > 0
                      ? fmtHours(report.total_seconds / report.daily.filter(d=>d.seconds>0).length)
                      : '0h'}
                  </div>
                  <div className={styles.summaryLabel}>Avg per active day</div>
                </div>
                <div className={styles.summaryCard}>
                  <div className={styles.summaryVal}>{report.by_project.length}</div>
                  <div className={styles.summaryLabel}>Projects worked</div>
                </div>
              </div>
              <div className={styles.chartSection}>
                <div className={styles.chartTitle}>Daily breakdown</div>
                <BarChart daily={report.daily} weekDays={weekDays} entries={entries} projMap={projMap} />
              </div>
              <div className={styles.chartSection}>
                <div className={styles.chartTitle}>By project</div>
                {report.by_project.length === 0 && <div className={styles.empty}>No data this week</div>}
                {report.by_project.map(p => {
                  const pct = report.total_seconds > 0 ? (p.seconds/report.total_seconds)*100 : 0
                  return (
                    <div key={p.project_id} className={styles.projBar}>
                      <div className={styles.projBarName}>{p.name}</div>
                      <div className={styles.projBarTrack}>
                        <div className={styles.projBarFill} style={{ width:`${pct}%`, background:p.color }} />
                      </div>
                      <div className={styles.projBarHours}>{fmtHours(p.seconds)}</div>
                    </div>
                  )
                })}
              </div>
            </>
          ) : (
            <div className={styles.empty}>Loading…</div>
          )}
        </div>
      )}

      {/* ══ Day detail modal ══ */}
      {detailDay && (
        <div className={styles.modalOverlay} onClick={() => setDetailDay(null)}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <div className={styles.modalTitleRow}>
              <h3 className={styles.modalTitle}>
                {format(parseISO(detailDay.dayStr), 'EEEE, d MMMM yyyy')}
              </h3>
              <span className={styles.modalTotal}>{fmtHours(detailDay.dayTotal)}</span>
            </div>
            <div className={styles.detailList}>
              {detailDay.groups.map(g => {
                const proj = projMap[g.project_id]
                return (
                  <div key={g.project_id} className={styles.detailGroup}>
                    <div className={styles.detailGroupHeader}
                      style={{ color: proj?.color || 'var(--accent-teal)' }}>
                      <span>{proj?.name || 'Unknown'}</span>
                      <span className={styles.detailGroupTotal}>{fmtHours(g.total)}</span>
                    </div>
                    {g.entries.map(e => (
                      <div key={e.id} className={styles.detailEntry}>
                        <div className={styles.detailEntryTime}>
                          {e.start_time ? format(parseISO(e.start_time), 'HH:mm') : ''}
                          {e.end_time   ? ` → ${format(parseISO(e.end_time), 'HH:mm')}` : ' (running)'}
                        </div>
                        <div className={styles.detailEntryDesc}>
                          <RichDesc text={e.description} navigate={navigate} />
                        </div>
                        <div className={styles.detailEntryDur}>{fmtHours(e.duration)}</div>
                        <button className={styles.detailEditBtn}
                          onClick={() => { setEditEntry({...e}); setDetailDay(null) }}>Edit</button>
                        <button className={`${styles.detailEditBtn} ${styles.entryBtnDel}`}
                          onClick={async () => { await handleDeleteEntry(e.id); setDetailDay(null) }}>×</button>
                      </div>
                    ))}
                  </div>
                )
              })}
            </div>
            <div className={styles.modalActions}>
              <button className="btn btn-secondary" onClick={() => setDetailDay(null)}>Close</button>
              <button className="btn btn-primary"
                onClick={() => {
                  exportCSV(detailDay.dayStr, detailDay.dayStr)
                  setDetailDay(null)
                }}>
                ↓ Export this day
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══ Edit entry modal ══ */}
      {editEntry && (
        <div className={styles.modalOverlay} onClick={() => setEditEntry(null)}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <h3 className={styles.modalTitle}>Edit Time Entry</h3>
            <div className={styles.formRow}>
              <label className={styles.formLabel}>Project</label>
              <select className={styles.formInput} value={editEntry.project_id}
                onChange={e => setEditEntry({...editEntry, project_id: e.target.value})}>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div className={styles.formRow}>
              <label className={styles.formLabel}>Description</label>
              <input className={styles.formInput} value={editEntry.description || ''}
                onChange={e => setEditEntry({...editEntry, description: e.target.value})} />
            </div>
            <div className={styles.formRow}>
              <label className={styles.formLabel}>Start</label>
              <input type="datetime-local" className={styles.formInput}
                value={editEntry.start_time ? editEntry.start_time.replace('Z','').slice(0,16) : ''}
                onChange={e => setEditEntry({...editEntry, start_time: e.target.value+':00Z'})} />
            </div>
            <div className={styles.formRow}>
              <label className={styles.formLabel}>End</label>
              <input type="datetime-local" className={styles.formInput}
                value={editEntry.end_time ? editEntry.end_time.replace('Z','').slice(0,16) : ''}
                onChange={e => setEditEntry({...editEntry, end_time: e.target.value+':00Z'})} />
            </div>
            <div className={styles.modalActions}>
              <button className="btn btn-secondary" onClick={() => setEditEntry(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSaveEntry}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function BarChart({ daily, weekDays, entries, projMap }) {
  const maxSecs = Math.max(...weekDays.map(d => {
    const ds = format(d, 'yyyy-MM-dd')
    return (daily.find(x => x.date === ds)?.seconds || 0)
  }), 1)

  return (
    <div style={{ display:'flex', gap:6, alignItems:'flex-end', height:120, marginTop:8 }}>
      {weekDays.map(d => {
        const dayStr = format(d, 'yyyy-MM-dd')
        const secs   = daily.find(x => x.date === dayStr)?.seconds || 0
        const hPct   = (secs / maxSecs) * 100
        const today  = isToday(d)
        const dayEnts = entries.filter(e => e.start_time?.startsWith(dayStr))
        // Group by project for stacked bar
        const projSecs = {}
        dayEnts.forEach(e => { projSecs[e.project_id] = (projSecs[e.project_id]||0) + (e.duration||0) })

        return (
          <div key={dayStr} style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', gap:4 }}>
            <div style={{ fontSize:10, color:'var(--text-muted)', height:16 }}>
              {secs > 0 ? fmtHours(secs) : ''}
            </div>
            <div style={{ width:'100%', flex:1, display:'flex', flexDirection:'column', justifyContent:'flex-end' }}>
              {secs > 0 ? (
                <div style={{ width:'100%', height:`${hPct}%`, minHeight:4, borderRadius:4, overflow:'hidden', display:'flex', flexDirection:'column-reverse' }}>
                  {Object.entries(projSecs).map(([pid, s]) => (
                    <div key={pid} style={{
                      width:'100%', height:`${(s/secs)*100}%`,
                      background: projMap[pid]?.color || '#888', minHeight:2
                    }} />
                  ))}
                </div>
              ) : (
                <div style={{ width:'100%', height:4, background:'var(--bg-card)', borderRadius:4 }} />
              )}
            </div>
            <div style={{ fontSize:10, fontWeight: today?700:400,
              color: today ? 'var(--accent-teal)' : 'var(--text-muted)' }}>
              {format(d,'EEE')}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function PlayIcon() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg> }
function StopIcon() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="3" width="18" height="18" rx="2"/></svg> }
