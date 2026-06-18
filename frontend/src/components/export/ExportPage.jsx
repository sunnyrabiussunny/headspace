import React, { useState, useEffect, useRef } from 'react'
import { getExportStatus, runBackup, downloadBackup, importBackup, importCapacities } from '../../api'
import axios from 'axios'
import toast from 'react-hot-toast'
import styles from './ExportPage.module.css'

export default function ExportPage() {
  const [status, setStatus]       = useState(null)
  const [loading, setLoading]     = useState(false)
  const fileRef                   = useRef(null)
  const capFileRef                = useRef(null)

  useEffect(() => {
    getExportStatus().then(setStatus).catch(() => {})
    // Auto-backup check: if no backup in 3 days, run silently
    getExportStatus().then(s => {
      if (!s.last_backup || s.last_backup === 'Never') return
      const last = new Date(s.last_backup)
      const diffDays = (Date.now() - last.getTime()) / (1000 * 60 * 60 * 24)
      if (diffDays >= 3) {
        runBackup().catch(() => {})
      }
    }).catch(() => {})
  }, [])

  const handleExport = async () => {
    setLoading(true)
    try {
      const result = await runBackup()
      setStatus(await getExportStatus())
      toast.success(`Exported ${result.entries} entries and ${result.objects} objects`)
    } catch {
      toast.error('Export failed')
    } finally {
      setLoading(false)
    }
  }

  const handleDownload = () => {
    downloadBackup()
    toast.success('Downloading backup zip...')
  }

  const handleCapacitiesImport = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setLoading(true)
    try {
      const result = await importCapacities(file)
      toast.success(`Capacities import: ${result.entries_imported} entries, ${result.objects_imported} objects`)
      e.target.value = ''
    } catch {
      toast.error('Capacities import failed')
    } finally {
      setLoading(false)
    }
  }

  const handleCleanupJunkTags = async () => {
    if (!window.confirm('This will delete all junk tags imported from Capacities markdown headings (tags starting with - or containing --). Continue?')) return
    setLoading(true)
    try {
      const result = await axios.delete('/api/export/cleanup-junk-tags')
      toast.success(`Cleaned ${result.data.cleaned_entries} entries and ${result.data.cleaned_objects} objects`)
    } catch {
      toast.error('Cleanup failed')
    } finally {
      setLoading(false)
    }
  }

  const handleCleanupDateObjects = async () => {
    if (!window.confirm('This will delete all objects whose title is a date (YYYY-MM-DD) — the ones wrongly imported as objects instead of diary entries. Continue?')) return
    setLoading(true)
    try {
      const result = await axios.delete('/api/export/cleanup-date-objects')
      toast.success(`Cleaned up ${result.data.deleted_date_objects} wrongly-imported date objects`)
    } catch {
      toast.error('Cleanup failed')
    } finally {
      setLoading(false)
    }
  }

  const handleImport = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setLoading(true)
    try {
      const result = await importBackup(file)
      toast.success(`Imported ${result.entries_imported} entries and ${result.objects_imported} objects`)
      e.target.value = ''
    } catch {
      toast.error('Import failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Export</h1>
        <p className={styles.subtitle}>
          All data saved as Markdown and JSON. Sync the backup folder with Syncthing to keep copies anywhere.
        </p>
      </div>

      {/* Status card */}
      <div className={styles.card}>
        <div className={styles.cardTitle}>
          <ClockIcon /> Auto-backup every 3 days
        </div>
        <div className={styles.stat}>
          <span className={styles.statLabel}>Last backup</span>
          <span className={styles.statValue}>{status?.last_backup || 'Never'}</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statLabel}>Entries</span>
          <span className={styles.statValue}>{status?.entries_count ?? '—'}</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statLabel}>Objects</span>
          <span className={styles.statValue}>{status?.objects_count ?? '—'}</span>
        </div>
        <div className={styles.pathRow}>
          <FolderIcon />
          <span className={styles.path}>{status?.backup_dir || '/app/data/backups'}</span>
        </div>
      </div>

      {/* Export now card */}
      <div className={styles.card}>
        <div className={styles.cardTitle}>Export Now</div>
        <p className={styles.cardDesc}>
          Exports all diary entries and objects immediately. Replaces the previous backup.
        </p>
        <div className={styles.btnRow}>
          <button
            className="btn btn-primary"
            onClick={handleExport}
            disabled={loading}
          >
            {loading ? 'Exporting...' : 'Export Now'}
          </button>
          <button className="btn btn-secondary" onClick={handleDownload}>
            <DownloadIcon /> Download Zip
          </button>
        </div>
      </div>

      {/* Capacities import card */}
      <div className={styles.card}>
        <div className={styles.cardTitle}>Import from Capacities</div>
        <p className={styles.cardDesc}>
          Moving from Capacities? Export your data from Capacities and upload it here. Supported formats:
        </p>
        <ul className={styles.importList}>
          <li><strong>Zip export</strong> — the full export zip from Capacities (recommended). Contains all your daily notes and objects as Markdown files, organised in folders by type.</li>
          <li><strong>Single .md file</strong> — any individual Markdown file exported from Capacities.</li>
          <li><strong>Single .csv file</strong> — a collection or database exported as CSV.</li>
        </ul>
        <p className={styles.importNote}>
          To export from Capacities: open the app → Settings → Export → choose Markdown export → download the zip.
        </p>
        <input
          type="file"
          accept=".zip,.md,.csv"
          ref={capFileRef}
          style={{ display: 'none' }}
          onChange={handleCapacitiesImport}
        />
        <button
          className="btn btn-secondary"
          onClick={() => capFileRef.current?.click()}
          disabled={loading}
        >
          <UploadIcon /> Upload Capacities Export
        </button>
      </div>

      {/* Cleanup junk tags */}
      <div className={styles.card}>
        <div className={styles.cardTitle}>Clean Up Junk Tags</div>
        <p className={styles.cardDesc}>
          If your Tags page shows garbage like <code>#-artemis---llm</code> or <code>#-background</code> from a Capacities import, click below to remove them all from the database permanently.
        </p>
        <button
          className="btn btn-danger"
          onClick={handleCleanupJunkTags}
          disabled={loading}
        >
          🧹 Remove Junk Tags
        </button>
      </div>

      {/* Cleanup wrongly-imported date objects */}
      <div className={styles.card}>
        <div className={styles.cardTitle}>Fix Wrongly Imported Capacities Entries</div>
        <p className={styles.cardDesc}>
          If your calendar entries were imported as objects (titled "2024-06-15" etc.) instead of diary entries, click below to delete them all at once. Then re-upload your Capacities export — the import now correctly detects date-named files as diary entries.
        </p>
        <button
          className="btn btn-danger"
          onClick={handleCleanupDateObjects}
          disabled={loading}
        >
          🗑️ Delete All Date-Named Objects
        </button>
      </div>

      {/* Headspace import card */}
      <div className={styles.card}>
        <div className={styles.cardTitle}>Import Headspace Backup</div>
        <p className={styles.cardDesc}>
          Upload a backup zip or a JSON file to restore entries and objects.
        </p>
        <input
          type="file"
          accept=".zip,.json"
          ref={fileRef}
          style={{ display: 'none' }}
          onChange={handleImport}
        />
        <button
          className="btn btn-secondary"
          onClick={() => fileRef.current?.click()}
          disabled={loading}
        >
          <UploadIcon /> Choose File
        </button>
      </div>

      {/* Syncthing guide */}
      <div className={styles.card}>
        <div className={styles.cardTitle}>Syncthing Setup</div>
        <ol className={styles.steps}>
          <li>Install Syncthing on your phone and computer.</li>
          <li>Add the backup folder shown above as a shared folder in Syncthing.</li>
          <li>Connect to your computer and sync.</li>
          <li>Your data is always open Markdown and JSON — no lock-in.</li>
        </ol>
      </div>
    </div>
  )
}

function ClockIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
}
function FolderIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
}
function DownloadIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
}
function UploadIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
}
