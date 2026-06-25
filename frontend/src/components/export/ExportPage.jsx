import React, { useState, useEffect, useRef } from 'react'
import GuidePage from '../guide/GuidePage'
import { getExportStatus, runBackup, downloadBackup, importBackup, importCapacities } from '../../api'
import axios from 'axios'
import toast from 'react-hot-toast'
import styles from './ExportPage.module.css'

export default function ExportPage() {
  const [settingsTab, setSettingsTab] = useState('backup')
  const [status, setStatus]           = useState(null)
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

  const [deleteAllInput, setDeleteAllInput] = useState('')
  const [showDeleteAll, setShowDeleteAll]   = useState(false)

  const handleDeleteAll = async () => {
    if (deleteAllInput !== 'DELETEALL') {
      toast.error('Type DELETEALL exactly to confirm')
      return
    }
    setLoading(true)
    try {
      await axios.delete('/api/export/delete-all', { params: { confirm: 'DELETEALL' } })
      toast.success('All data deleted. Reloading…')
      setShowDeleteAll(false)
      setDeleteAllInput('')
      setTimeout(() => window.location.reload(), 1500)
    } catch {
      toast.error('Delete failed')
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

  const STABS = [
    { id: 'backup', label: '💾 Backup & Import' },
    { id: 'danger', label: '⚠️ Data Management' },
    { id: 'guide',  label: '📖 Guide' },
  ]

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Settings</h1>
        <p className={styles.subtitle}>
          Backup, import, data management and app guide.
        </p>
      </div>

      <div className={styles.stabs}>
        {STABS.map(t => (
          <button key={t.id}
            className={`${styles.stab} ${settingsTab === t.id ? styles.stabActive : ''}`}
            onClick={() => setSettingsTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {settingsTab === 'guide'  && <GuidePage embedded />}

      {settingsTab === 'backup' && (
        <div>
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
        </div>
      )}

      {settingsTab === 'danger' && (
        <div>
          {/* ── DANGER ZONE ── */}
      <div className={styles.card} style={{borderColor:'var(--accent-red, #b03030)'}}>
        <div className={styles.cardTitle} style={{color:'var(--accent-red, #e05252)'}}>
          ⚠️ Delete All Data
        </div>
        <p className={styles.cardDesc}>
          Permanently deletes every diary entry, object, mention, and time log from the database.
          This cannot be undone. The app will reload after deletion.
        </p>
        {!showDeleteAll ? (
          <button className="btn btn-danger" onClick={() => setShowDeleteAll(true)}>
            Delete Everything
          </button>
        ) : (
          <div style={{display:'flex',flexDirection:'column',gap:10}}>
            <p style={{fontSize:12,color:'var(--accent-red,#e05252)',fontWeight:600}}>
              Type DELETEALL to confirm:
            </p>
            <input
              className={styles.confirmInput}
              placeholder="DELETEALL"
              value={deleteAllInput}
              onChange={e => setDeleteAllInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleDeleteAll()}
              autoFocus
            />
            <div style={{display:'flex',gap:8}}>
              <button className="btn btn-danger"
                onClick={handleDeleteAll}
                disabled={deleteAllInput !== 'DELETEALL' || loading}>
                Confirm Delete All
              </button>
              <button className="btn btn-secondary"
                onClick={() => { setShowDeleteAll(false); setDeleteAllInput('') }}>
                Cancel
              </button>
            </div>
          </div>
        )}
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
      )}

    </div>
  )
}