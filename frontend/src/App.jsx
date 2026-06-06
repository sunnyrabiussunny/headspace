import React from 'react'
import { Routes, Route, NavLink, useNavigate } from 'react-router-dom'
import DiaryPage from './components/diary/DiaryPage'
import ObjectsPage from './components/objects/ObjectsPage'
import ObjectDetailPage from './components/objects/ObjectDetailPage'
import ExportPage from './components/export/ExportPage'
import styles from './App.module.css'

const NAV_ITEMS = [
  { to: '/',        label: 'Diary',   icon: CalIcon },
  { to: '/objects', label: 'Objects', icon: LayersIcon },
  { to: '/export',  label: 'Export',  icon: DownloadIcon },
]

export default function App() {
  return (
    <div className={styles.shell}>
      {/* ── Sidebar (desktop) / Bottom nav (mobile) ── */}
      <nav className={styles.sidebar}>
        <div className={styles.logo}>
          <span className={styles.logoMark}>H</span>
          <span className={styles.logoText}>headspace</span>
        </div>
        <div className={styles.navLinks}>
          {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `${styles.navItem} ${isActive ? styles.navActive : ''}`
              }
            >
              <Icon size={18} />
              <span>{label}</span>
            </NavLink>
          ))}
          <div style={{ height: 1, background: 'var(--divider)', margin: '8px 4px' }} />
          <button
            className={styles.navTodayBtn}
            onClick={() => window.dispatchEvent(new CustomEvent('goto-today'))}
          >
            <TodayIcon size={16} />
            <span>Today</span>
          </button>
        </div>
      </nav>

      {/* ── Mobile bottom nav ── */}
      <nav className={styles.bottomNav}>
        {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `${styles.bottomNavItem} ${isActive ? styles.bottomNavActive : ''}`
            }
          >
            <Icon size={20} />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>

      {/* ── Main content ── */}
      <main className={styles.main}>
        <Routes>
          <Route path="/"                  element={<DiaryPage />} />
          <Route path="/objects"           element={<ObjectsPage />} />
          <Route path="/objects/:id"       element={<ObjectDetailPage />} />
          <Route path="/export"            element={<ExportPage />} />
        </Routes>
      </main>
    </div>
  )
}

/* ── Inline SVG icons (no dep needed) ── */
function TodayIcon({ size = 16 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
}
function CalIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
    </svg>
  )
}
function LayersIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>
    </svg>
  )
}
function DownloadIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
    </svg>
  )
}
