import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import {
  format, startOfWeek, addDays, addWeeks, subWeeks,
  parseISO, isToday, isSameDay
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
  const [selectedDate, setSelectedDate]       = useState(new Date())
  const [weekStart, setWeekStart]             = useState(startOfWeek(new Date(), { weekStartsOn: 1 }))
  const [datesWithEntries, setDatesWithEntries] = useState(new Set())
  const [entries, setEntries]                 = useState([])
  const [editingId, setEditingId]             = useState(null)
  const [searchQuery, setSearchQuery]         = useState('')
  const [searchResults, setSearchResults]     = useState([])
  const [searching, setSearching]             = useState(false)
  const [showDatePicker, setShowDatePicker]   = useState(false)
  const [datePickerValue, setDatePickerValue] = useState('')
  const searchTimer   = useRef(null)
  const datePickerRef = useRef(null)
  const navigate      = useNavigate()
  const location      = useLocation()

  // Handle incoming targetDate from backlink navigation
  useEffect(() => {
    if (location.state?.targetDate) {
      const target = parseISO(location.state.targetDate)
      setSelectedDate(target)
      setWeekStart(startOfWeek(target, { weekStartsOn: 1 }))
      window.history.replaceState({}, '')
    }
  }, [location.state])

  // Load dot indicators
  useEffect(() => {
    getDatesWithEntries().then(dates => setDatesWithEntries(new Set(dates))).catch(() => {})
  }, [entries])

  // Load entries for selected date
  useEffect(() => {
    getEntriesForDate(format(selectedDate, 'yyyy-MM-dd'))
      .then(data => { setEntries(data); setEditingId(null) })
      .catch(() => setEntries([]))
  }, [selectedDate])

  // Search debounce
  useEffect(() => {
    clearTimeout(searchTimer.current)
    if (!searchQuery.trim()) { setSearchResults([]); setSearching(false); return }
    setSearching(true)
    searchTimer.current = setTimeout(async () => {
      try {
        const results = await globalSearch(searchQuery.trim())
        setSearchResults(results)
      } finally { setSearching(false) }
    }, 250)
  }, [searchQuery])

  // Close date picker on outside click
  useEffect(() => {
    const handler = (e) => {
      if (datePickerRef.current && !datePickerRef.current.contains(e.target)) {
        setShowDatePicker(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const goToDate = useCallback((date) => {
    setSelectedDate(date)
    setWeekStart(startOfWeek(date, { weekStartsOn: 1 }))
    setEditingId(null)
  }, [])

  const handleAddEntry = useCallback(async () => {
    try {
      const entry = await createEntry(format(selectedDate, 'yyyy-MM-dd'))
      setEntries(prev => [...prev, entry])
      setEditingId(entry.id)
    } catch { toast.error('Failed to create entry') }
  }, [selectedDate])

  const handleDelete = useCallback(async (id) => {
    await deleteEntry(id)
    setEntries(prev => prev.filter(e => e.id !== id))
    if (editingId === id) setEditingId(null)
  }, [editingId])

  const handleEntrySaved = useCallback((updated) => {
    setEntries(prev => prev.map(e => e.id === updated.id ? updated : e))
  }, [])

  const handleDatePickerSubmit = useCallback((e) => {
    e.preventDefault()
    if (!datePickerValue) return
    const parsed = parseISO(datePickerValue)
    if (!isNaN(parsed)) {
      goToDate(parsed)
      setShowDatePicker(false)
      setDatePickerValue('')
    }
  }, [datePickerValue, goToDate])

  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))

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
          <button className={styles.searchClear} onClick={() => setSearchQuery('')}>
            <XIcon />
          </button>
        )}
      </div>

      <div className={styles.divider} />

      {searchQuery ? (
        <SearchResultsList
          results={searchResults}
          loading={searching}
          query={searchQuery}
          onDiaryClick={(result) => {
            goToDate(parseISO(result.date))
            setSearchQuery('')
          }}
          onObjectClick={(result) => {
            setSearchQuery('')
            navigate(`/objects/${result.id}`)
          }}
        />
      ) : (
        <div className={styles.content}>

          {/* Week strip + calendar picker */}
          <div className={styles.weekNav}>
            <button className={styles.weekBtn} onClick={() => {
              const prev = subWeeks(weekStart, 1)
              setWeekStart(prev)
            }}>
              <ChevronLeft />
            </button>

            <div className={styles.weekDays}>
              {weekDays.map(day => {
                const dateStr  = format(day, 'yyyy-MM-dd')
                const isSelected = isSameDay(day, selectedDate)
                const todayFlag  = isToday(day)
                const hasDot     = datesWithEntries.has(dateStr) && !isSelected
                return (
                  <button
                    key={dateStr}
                    className={`${styles.dayBtn} ${isSelected ? styles.daySelected : ''} ${todayFlag && !isSelected ? styles.dayToday : ''}`}
                    onClick={() => goToDate(day)}
                  >
                    <span className={styles.dayName}>{format(day, 'EEE').toUpperCase()}</span>
                    <span className={styles.dayNum}>{format(day, 'd')}</span>
                    {hasDot && <span className={styles.dot} />}
                  </button>
                )
              })}
            </div>

            <button className={styles.weekBtn} onClick={() => {
              const next = addWeeks(weekStart, 1)
              setWeekStart(next)
            }}>
              <ChevronRight />
            </button>

            {/* Calendar picker trigger */}
            <div className={styles.calPickerWrap} ref={datePickerRef}>
              <button
                className={styles.calPickerBtn}
                onClick={() => setShowDatePicker(v => !v)}
                title="Jump to date"
              >
                <CalendarIcon />
              </button>
              {showDatePicker && (
                <div className={styles.calPickerDropdown}>
                  <p className={styles.calPickerLabel}>Jump to date</p>
                  <form onSubmit={handleDatePickerSubmit} className={styles.calPickerForm}>
                    <input
                      type="date"
                      className={styles.calPickerInput}
                      value={datePickerValue}
                      onChange={e => setDatePickerValue(e.target.value)}
                      autoFocus
                    />
                    <button type="submit" className={styles.calPickerGo}>Go</button>
                  </form>
                </div>
              )}
            </div>
          </div>

          {/* Date header — NO "Daily note" tab */}
          <div className={styles.dateHeader}>
            <div className={styles.dateRow}>
              <span className={styles.dayLabel} style={{ color: 'var(--accent-green)' }}>
                {isToday(selectedDate) ? 'Today' : format(selectedDate, 'EEEE')}
              </span>
              {isToday(selectedDate) && <span className={styles.todayBadge}>Today</span>}
            </div>
            <div className={styles.dateRow}>
              <h2 className={styles.dateFull}>{format(selectedDate, 'd MMMM, yyyy')}</h2>
              <span className={styles.weekNum}>Week {format(selectedDate, 'w')}</span>
            </div>
          </div>

          <div className={styles.divider} />

          {/* Entry list */}
          <div className={styles.entryList}>
            {entries.map(entry => (
              editingId === entry.id
                ? (
                  <DiaryEditor
                    key={entry.id}
                    entry={entry}
                    onSave={handleEntrySaved}
                    onClose={() => setEditingId(null)}
                    onDelete={() => handleDelete(entry.id)}
                  />
                )
                : (
                  <DiaryEntryCard
                    key={entry.id}
                    entry={entry}
                    onClick={() => setEditingId(entry.id)}
                    onDelete={() => handleDelete(entry.id)}
                  />
                )
            ))}

            <button className={styles.addEntryBtn} onClick={handleAddEntry}>
              <PlusIcon />
              <span>Daily Note</span>
            </button>
          </div>

        </div>
      )}
    </div>
  )
}

/* Icons */
function SearchIcon() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg> }
function XIcon() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> }
function ChevronLeft() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg> }
function ChevronRight() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg> }
function PlusIcon() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> }
function CalendarIcon() { return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg> }
