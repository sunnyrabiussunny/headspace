import React, { useState, useEffect, useRef, lazy, Suspense } from 'react'
import { getExportStatus, runBackup, downloadBackup, importBackup, importCapacities, deleteAllData } from '../../api'
import { listUsers, createUser, changePassword } from '../../api_auth'
import toast from 'react-hot-toast'
import styles from './ExportPage.module.css'

// Lazy load GuidePage to avoid any circular import issues
const GuidePage = lazy(() => import('../guide/GuidePage'))

export default function ExportPage({ user }) {
  const [settingsTab, setSettingsTab] = useState('backup')
  const [status,      setStatus]      = useState(null)
  const [loading,     setLoading]     = useState(false)
  const [showDeleteAll, setShowDeleteAll]   = useState(false)
  const [deleteAllInput, setDeleteAllInput] = useState('')
  const fileRef    = useRef(null)
  const capFileRef = useRef(null)

  // ── Account tab state ──
  const [users, setUsers] = useState([])
  const [newUsername, setNewUsername] = useState('')
  const [newDisplayName, setNewDisplayName] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [creatingUser, setCreatingUser] = useState(false)
  const [curPw, setCurPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [changingPw, setChangingPw] = useState(false)

  useEffect(() => {
    getExportStatus().then(setStatus).catch(() => {})
  }, [])

  useEffect(() => {
    if (settingsTab === 'account') {
      listUsers().then(setUsers).catch(() => {})
    }
  }, [settingsTab])

  const handleCreateUser = async (e) => {
    e.preventDefault()
    if (!newUsername.trim() || newPassword.length < 4) {
      toast.error('Username required, password must be at least 4 characters')
      return
    }
    setCreatingUser(true)
    try {
      await createUser({ username: newUsername.trim(), password: newPassword, display_name: newDisplayName.trim() })
      toast.success(`Account "${newUsername.trim()}" created — they can log in now with their own separate data`)
      setNewUsername(''); setNewDisplayName(''); setNewPassword('')
      setUsers(await listUsers())
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Failed to create account')
    } finally { setCreatingUser(false) }
  }

  const handleChangePassword = async (e) => {
    e.preventDefault()
    if (newPw.length < 4) { toast.error('New password must be at least 4 characters'); return }
    setChangingPw(true)
    try {
      await changePassword({ current_password: curPw, new_password: newPw })
      toast.success('Password updated')
      setCurPw(''); setNewPw('')
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Failed to change password')
    } finally { setChangingPw(false) }
  }

  const handleExport = async () => {
    setLoading(true)
    try {
      const result = await runBackup()
      setStatus(await getExportStatus())
      toast.success(`Exported ${result.entries} entries and ${result.objects} objects`)
    } catch { toast.error('Export failed') }
    finally { setLoading(false) }
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
    } catch { toast.error('Capacities import failed') }
    finally { setLoading(false) }
  }

  const handleImport = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setLoading(true)
    try {
      const result = await importBackup(file)
      toast.success(`Imported ${result.entries_imported} entries and ${result.objects_imported} objects`)
      e.target.value = ''
    } catch { toast.error('Import failed') }
    finally { setLoading(false) }
  }

  const handleDeleteAll = async () => {
    if (deleteAllInput !== 'DELETEALL') {
      toast.error('Type DELETEALL exactly to confirm')
      return
    }
    setLoading(true)
    try {
      await deleteAllData()
      toast.success('All data deleted. Reloading…')
      setShowDeleteAll(false)
      setDeleteAllInput('')
      setTimeout(() => window.location.reload(), 1500)
    } catch { toast.error('Delete failed') }
    finally { setLoading(false) }
  }

  const TABS = [
    { id: 'account', label: '👤 Account' },
    { id: 'backup', label: '💾 Backup & Import' },
    { id: 'danger', label: '⚠️ Data Management' },
    { id: 'guide',  label: '📖 Guide' },
  ]

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Settings</h1>
        <p className={styles.subtitle}>Backup, import, data management and guide.</p>
      </div>

      <div className={styles.stabs}>
        {TABS.map(t => (
          <button key={t.id}
            className={`${styles.stab} ${settingsTab === t.id ? styles.stabActive : ''}`}
            onClick={() => setSettingsTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Guide tab ── */}
      {settingsTab === 'guide' && (
        <Suspense fallback={<div className={styles.loading}>Loading guide…</div>}>
          <GuidePage embedded />
        </Suspense>
      )}

      {/* ── Account tab ── */}
      {settingsTab === 'account' && (
        <div className={styles.tabContent}>

          <div className={styles.card}>
            <div className={styles.cardTitle}>Signed in as</div>
            <p className={styles.cardDesc}>
              <strong>{user?.display_name || user?.username}</strong> ({user?.username})
            </p>
          </div>

          <div className={styles.card}>
            <div className={styles.cardTitle}>Change Password</div>
            <form onSubmit={handleChangePassword} style={{ display:'flex', flexDirection:'column', gap:10 }}>
              <input
                className={styles.confirmInput}
                type="password"
                placeholder="Current password"
                value={curPw}
                onChange={e => setCurPw(e.target.value)}
              />
              <input
                className={styles.confirmInput}
                type="password"
                placeholder="New password (min 4 characters)"
                value={newPw}
                onChange={e => setNewPw(e.target.value)}
              />
              <div className={styles.btnRow}>
                <button className="btn btn-primary" type="submit" disabled={changingPw}>
                  {changingPw ? 'Saving…' : 'Update Password'}
                </button>
              </div>
            </form>
          </div>

          <div className={styles.card}>
            <div className={styles.cardTitle}>Add Another Account</div>
            <p className={styles.cardDesc}>
              Give someone else — a spouse, family member — their own login. Their diary, objects, board, habits, and time tracker are completely separate from yours; nobody else can see them.
            </p>
            <form onSubmit={handleCreateUser} style={{ display:'flex', flexDirection:'column', gap:10 }}>
              <input
                className={styles.confirmInput}
                placeholder="Username (e.g. wife)"
                value={newUsername}
                onChange={e => setNewUsername(e.target.value)}
                autoCapitalize="none"
              />
              <input
                className={styles.confirmInput}
                placeholder="Display name (optional)"
                value={newDisplayName}
                onChange={e => setNewDisplayName(e.target.value)}
              />
              <input
                className={styles.confirmInput}
                type="password"
                placeholder="Password (min 4 characters)"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
              />
              <div className={styles.btnRow}>
                <button className="btn btn-primary" type="submit" disabled={creatingUser}>
                  {creatingUser ? 'Creating…' : '+ Create Account'}
                </button>
              </div>
            </form>
          </div>

          <div className={styles.card}>
            <div className={styles.cardTitle}>Accounts on this server</div>
            <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
              {users.map(u => (
                <div key={u.id} style={{ display:'flex', justifyContent:'space-between', fontSize:13, padding:'6px 0', borderBottom:'1px solid var(--divider)' }}>
                  <span>{u.display_name || u.username}</span>
                  <span style={{ color:'var(--text-muted)' }}>@{u.username}{u.is_admin ? ' · admin' : ''}</span>
                </div>
              ))}
            </div>
          </div>

        </div>
      )}

      {/* ── Backup tab ── */}
      {settingsTab === 'backup' && (
        <div className={styles.tabContent}>

          <div className={styles.card}>
            <div className={styles.cardTitle}><ClockIcon /> Auto-backup status</div>
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

          <div className={styles.card}>
            <div className={styles.cardTitle}>Export Now</div>
            <p className={styles.cardDesc}>
              Exports all diary entries and objects immediately.
            </p>
            <div className={styles.btnRow}>
              <button className="btn btn-primary" onClick={handleExport} disabled={loading}>
                {loading ? 'Exporting...' : 'Export Now'}
              </button>
              <button className="btn btn-secondary" onClick={handleDownload}>
                <DownloadIcon /> Download Zip
              </button>
            </div>
          </div>

          <div className={styles.card}>
            <div className={styles.cardTitle}>Import Headspace Backup</div>
            <p className={styles.cardDesc}>
              Upload a previously downloaded backup zip to restore entries and objects.
            </p>
            <input type="file" accept=".zip,.json" ref={fileRef}
              style={{ display:'none' }} onChange={handleImport} />
            <button className="btn btn-secondary" onClick={() => fileRef.current?.click()} disabled={loading}>
              <UploadIcon /> Choose Backup File
            </button>
          </div>

          <div className={styles.card}>
            <div className={styles.cardTitle}>Import from Capacities</div>
            <p className={styles.cardDesc}>
              Moving from Capacities? Export from Capacities as Markdown zip (Settings → Export → Markdown) and upload here. Daily notes become diary entries, objects are mapped by folder type.
            </p>
            <input type="file" accept=".zip,.md,.csv" ref={capFileRef}
              style={{ display:'none' }} onChange={handleCapacitiesImport} />
            <button className="btn btn-secondary" onClick={() => capFileRef.current?.click()} disabled={loading}>
              <UploadIcon /> Upload Capacities Export
            </button>
          </div>

          <div className={styles.card}>
            <div className={styles.cardTitle}>☁️ Automatic Cloud Backup</div>
            <p className={styles.cardDesc}>
              Every account's backup folder can be synced automatically to Google Drive, Box, Dropbox, or S3
              using the included <code>scripts/backup-to-cloud.sh</code> script (powered by rclone) on a
              daily timer. See <code>scripts/README.md</code> in the project for setup steps.
            </p>
          </div>

          <div className={styles.card}>
            <div className={styles.cardTitle}>Syncthing Setup (alternative)</div>
            <p className={styles.cardDesc}>Each account's backup now lives in its own subfolder — sync the one for your account.</p>
            <ol className={styles.steps}>
              <li>Install Syncthing on your phone and computer.</li>
              <li>Add your account's backup folder shown above as a shared folder.</li>
              <li>Connect devices and sync automatically.</li>
              <li>Your data is open Markdown and JSON — no lock-in.</li>
            </ol>
          </div>

        </div>
      )}

      {/* ── Danger tab ── */}
      {settingsTab === 'danger' && (
        <div className={styles.tabContent}>

          <div className={styles.card} style={{ borderColor:'var(--accent-red,#b03030)' }}>
            <div className={styles.cardTitle} style={{ color:'var(--accent-red,#e05252)' }}>
              ⚠️ Delete All Data
            </div>
            <p className={styles.cardDesc}>
              Permanently deletes every diary entry, object, mention, board box, habit, and time log
              in <strong>your account only</strong> ({user?.username}) — other accounts on this server are untouched. This cannot be undone.
            </p>
            {!showDeleteAll ? (
              <button className="btn btn-danger" onClick={() => setShowDeleteAll(true)}>
                Delete Everything
              </button>
            ) : (
              <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                <p style={{ fontSize:12, color:'var(--accent-red,#e05252)', fontWeight:600 }}>
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
                <div style={{ display:'flex', gap:8 }}>
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

        </div>
      )}

    </div>
  )
}

/* ── Icons ── */
function ClockIcon()  { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> }
function FolderIcon() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg> }
function DownloadIcon(){ return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> }
function UploadIcon() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg> }
