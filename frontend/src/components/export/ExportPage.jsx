import React, { useState, useEffect, useRef } from 'react'
import { getExportStatus, runBackup, downloadBackup, importBackup } from '../../api'
import toast from 'react-hot-toast'
import styles from './ExportPage.module.css'

export default function ExportPage() {
  const [status, setStatus]     = useState(null)
  const [loading, setLoading]   = useState(false)
  const fileRef                 = useRef(null)

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

      {/* Import card */}
      <div className={styles.card}>
        <div className={styles.cardTitle}>Import</div>
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
