import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import {
  format, startOfWeek, addDays, addWeeks, subWeeks,
  parseISO, isToday, isSameDay, getDaysInMonth,
  startOfMonth, getDay, addMonths, subMonths
} from 'date-fns'
import toast from 'react-hot-toast'
import {
  getDatesWithEntries, getEntriesForDate,
  createEntry, deleteEntry, globalSearch
} from '../../api'
import DiaryEntryCard from './DiaryEntryCard'
import DiaryEditor from './DiaryEditor'
import SearchResultsList from '../SearchResultsList'
import styles from './DiaryPage.module.css'

export default function DiaryPage() {
  const [selectedDate, setSelectedDate]         = useState(new Date())
  const [weekStart, setWeekStart]               = useState(startOfWeek(new Date(), { weekStartsOn: 1 }))
  const [datesWithEntries, setDatesWithEntries] = useState(new Set())
  const [entries, setEntries]                   = useState([])
  const [editingId, setEditingId]               = useState(null)
  const [searchQuery, setSearchQuery]           = useState('')
  const [searchResults, setSearchResults]       = useState([])
  const [searching, setSearching]               = useState(false)
  const [showCal, setShowCal]                   = useState(false)
  const [calMonth, setCalMonth]                 = useState(new Date())
  const calRef      = useRef(null)
  const searchTimer = useRef(null)
  const navigate    = useNavigate()
  const location    = useLocation()

  // Handle backlink navigation
  useEffect(() => {
    if (location.state?.targetDate) {
      const t = parseISO(location.state.targetDate)
      goToDate(t)
      window.history.replaceState({}, '')
    }
  }, [location.state])

  useEffect(() => {
    getDatesWithEntries().then(d => setDatesWithEntries(new Set(d))).catch(() => {})
  }, [entries])

  useEffect(() => {
    getEntriesForDate(format(selectedDate, 'yyyy-MM-dd'))
      .then(d => { setEntries(d); setEditingId(null) })
      .catch(() => setEntries([]))
  }, [selectedDate])

  useEffect(() => {
    clearTimeout(searchTimer.current)
    if (!searchQuery.trim()) { setSearchResults([]); setSearching(false); return }
    setSearching(true)
    searchTimer.current = setTimeout(async () => {
      try { setSearchResults(await globalSearch(searchQuery.trim())) }
      finally { setSearching(false) }
    }, 250)
  }, [searchQuery])

  // Close mini cal on outside click
  useEffect(() => {
    const h = (e) => { if (calRef.current && !calRef.current.contains(e.target)) setShowCal(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const goToDate = useCallback((date) => {
    setSelectedDate(date)
    setWeekStart(startOfWeek(date, { weekStartsOn: 1 }))
    setEditingId(null)
    setCalMonth(date)
  }, [])

  const goToToday = useCallback(() => goToDate(new Date()), [goToDate])

  // Listen for Today button click from sidebar
  useEffect(() => {
    const handler = () => goToToday()
    window.addEventListener('goto-today', handler)
    return () => window.removeEventListener('goto-today', handler)
  }, [goToToday])

  const handleAddEntry = useCallback(async () => {
    try {
      const e = await createEntry(format(selectedDate, 'yyyy-MM-dd'))
      setEntries(prev => [...prev, e])
      setEditingId(e.id)
    } catch { toast.error('Failed to create entry') }
  }, [selectedDate])

  const handleDelete = useCallback(async (id) => {
    await deleteEntry(id)
    setEntries(prev => prev.filter(e => e.id !== id))
    if (editingId === id) setEditingId(null)
  }, [editingId])

  const handleSaved = useCallback((updated) => {
    setEntries(prev => prev.map(e => e.id === updated.id ? updated : e))
  }, [])

  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
  const isSelectedToday = isToday(selectedDate)

  return (
    <div className={styles.page}>

      {/* Search bar */}
      <div className={styles.searchBar}>
        <SearchIcon />
        <input
          className={styles.searchInput}
          placeholder="Search diary and objects..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          onKeyDown={e => e.key === 'Escape' && setSearchQuery('')}
        />
        {searchQuery && (
          <button className={styles.clearBtn} onClick={() => setSearchQuery('')}><XIcon /></button>
        )}
      </div>
      <div className={styles.divider} />

      {searchQuery ? (
        <SearchResultsList
          results={searchResults} loading={searching} query={searchQuery}
          onDiaryClick={r => { goToDate(parseISO(r.date)); setSearchQuery('') }}
          onObjectClick={r => { setSearchQuery(''); navigate(`/objects/${r.id}`) }}
        />
      ) : (
        <div className={styles.content}>

          {/* Week strip row */}
          <div className={styles.weekNav}>
            {/* Today button */}
            <button className={styles.todayBtn} onClick={goToToday} title="Go to today">
              Today
            </button>

            <button className={styles.arrowBtn} onClick={() => setWeekStart(w => subWeeks(w, 1))}><ChevronL /></button>

            <div className={styles.weekDays}>
              {weekDays.map(day => {
                const ds = format(day, 'yyyy-MM-dd')
                const sel = isSameDay(day, selectedDate)
                const tod = isToday(day)
                return (
                  <button
                    key={ds}
                    className={`${styles.dayBtn} ${sel ? styles.sel : ''} ${tod && !sel ? styles.tod : ''}`}
                    onClick={() => goToDate(day)}
                  >
                    <span className={styles.dayName}>{format(day, 'EEE').toUpperCase()}</span>
                    <span className={styles.dayNum}>{format(day, 'd')}</span>
                    {datesWithEntries.has(ds) && !sel && <span className={styles.dot} />}
                  </button>
                )
              })}
            </div>

            <button className={styles.arrowBtn} onClick={() => setWeekStart(w => addWeeks(w, 1))}><ChevronR /></button>

            {/* Mini calendar toggle */}
            <div className={styles.calWrap} ref={calRef}>
              <button className={styles.calBtn} onClick={() => { setShowCal(v => !v); setCalMonth(selectedDate) }} title="Pick date">
                <CalIcon />
              </button>
              {showCal && (
                <MiniCal
                  month={calMonth}
                  selected={selectedDate}
                  datesWithEntries={datesWithEntries}
                  onSelect={d => { goToDate(d); setShowCal(false) }}
                  onMonthChange={setCalMonth}
                />
              )}
            </div>
          </div>

          {/* Date header — NO duplicate Today text */}
          <div className={styles.dateHeader}>
            <div className={styles.dateRow1}>
              {/* Show day name (green) OR the red Today badge — never both */}
              {isSelectedToday ? (
                <span className={styles.todayBadge}>Today</span>
              ) : (
                <span className={styles.dayLabel}>{format(selectedDate, 'EEEE')}</span>
              )}
            </div>
            <div className={styles.dateRow2}>
              <h2 className={styles.dateFull}>{format(selectedDate, 'd MMMM, yyyy')}</h2>
              <span className={styles.weekNum}>Week {format(selectedDate, 'w')}</span>
            </div>
          </div>

          <div className={styles.divider} />

          {/* Entries */}
          <div className={styles.list}>
            {entries.map(entry =>
              editingId === entry.id
                ? <DiaryEditor key={entry.id} entry={entry} onSave={handleSaved} onClose={() => setEditingId(null)} onDelete={() => handleDelete(entry.id)} />
                : <DiaryEntryCard key={entry.id} entry={entry} onClick={() => setEditingId(entry.id)} onDelete={() => handleDelete(entry.id)} />
            )}
            <button className={styles.addBtn} onClick={handleAddEntry}>
              <PlusIcon /> Daily Note
            </button>
          </div>

        </div>
      )}
    </div>
  )
}

// ── Mini Calendar ─────────────────────────────────────────────────────────────
function MiniCal({ month, selected, datesWithEntries, onSelect, onMonthChange }) {
  const firstDay  = startOfMonth(month)
  const totalDays = getDaysInMonth(month)
  // weekday of first day (Mon=0)
  const startOffset = (getDay(firstDay) + 6) % 7

  const cells = []
  for (let i = 0; i < startOffset; i++) cells.push(null)
  for (let d = 1; d <= totalDays; d++) cells.push(new Date(month.getFullYear(), month.getMonth(), d))

  return (
    <div className={styles.miniCal}>
      <div className={styles.miniCalHeader}>
        <button onMouseDown={e => { e.preventDefault(); onMonthChange(subMonths(month, 1)) }}><ChevronL /></button>
        <span>{format(month, 'MMMM yyyy')}</span>
        <button onMouseDown={e => { e.preventDefault(); onMonthChange(addMonths(month, 1)) }}><ChevronR /></button>
      </div>
      <div className={styles.miniCalGrid}>
        {['M','T','W','T','F','S','S'].map((d,i) => <span key={i} className={styles.miniCalDow}>{d}</span>)}
        {cells.map((day, i) => {
          if (!day) return <span key={`e${i}`} />
          const ds  = format(day, 'yyyy-MM-dd')
          const sel = isSameDay(day, selected)
          const tod = isToday(day)
          const dot = datesWithEntries.has(ds)
          return (
            <button
              key={ds}
              className={`${styles.miniCalDay} ${sel ? styles.miniCalSel : ''} ${tod && !sel ? styles.miniCalTod : ''}`}
              onMouseDown={e => { e.preventDefault(); onSelect(day) }}
            >
              {day.getDate()}
              {dot && <span className={styles.miniCalDot} />}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/* Icons */
function SearchIcon() { return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg> }
function XIcon()      { return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> }
function ChevronL()   { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg> }
function ChevronR()   { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg> }
function PlusIcon()   { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> }
function CalIcon()    { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg> }
