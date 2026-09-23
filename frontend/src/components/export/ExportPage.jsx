import React, { useState, useEffect, useRef, lazy, Suspense } from 'react'
import { getExportStatus, runBackup, downloadBackup, importBackup, importCapacities, deleteAllData,
         listCalendarFeeds, createCalendarFeed, syncCalendarFeed, deleteCalendarFeed,
         getSettings, setAutoTagEnabled, setAutoTaskEnabled, connectTelegram, disconnectTelegram } from '../../api'
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

  // ── Automation tab state (auto-tag + Telegram) ──
  const [settings, setSettings] = useState(null)
  const [savingAutoTag, setSavingAutoTag] = useState(false)
  const [botToken, setBotToken] = useState('')
  const [connectingBot, setConnectingBot] = useState(false)

  useEffect(() => {
    if (settingsTab === 'automation') {
      getSettings().then(setSettings).catch(() => {})
    }
  }, [settingsTab])

  const handleToggleAutoTag = async () => {
    setSavingAutoTag(true)
    try {
      const next = !settings.auto_tag_enabled
      await setAutoTagEnabled(next)
      setSettings(s => ({ ...s, auto_tag_enabled: next }))
      toast.success(next ? 'Auto-tag automation turned on' : 'Auto-tag automation turned off')
    } catch { toast.error('Failed to update') }
    finally { setSavingAutoTag(false) }
  }

  const [savingAutoTask, setSavingAutoTask] = useState(false)
  const handleToggleAutoTask = async () => {
    setSavingAutoTask(true)
    try {
      const next = !settings.auto_task_enabled
      await setAutoTaskEnabled(next)
      setSettings(s => ({ ...s, auto_task_enabled: next }))
      toast.success(next ? 'Automatic task creation turned on' : 'Automatic task creation turned off')
    } catch { toast.error('Failed to update') }
    finally { setSavingAutoTask(false) }
  }

  const handleConnectTelegram = async (e) => {
    e.preventDefault()
    if (!botToken.trim()) { toast.error('Paste your bot token first'); return }
    setConnectingBot(true)
    try {
      const res = await connectTelegram(botToken.trim())
      setSettings(s => ({ ...s, telegram_connected: true, telegram_linked: false }))
      setBotToken('')
      toast.success(`Connected to @${res.bot_username} — now send it any message to link your chat`)
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Invalid bot token')
    } finally { setConnectingBot(false) }
  }

  const handleDisconnectTelegram = async () => {
    if (!window.confirm('Disconnect this Telegram bot? Messages will stop being added to your diary.')) return
    try {
      await disconnectTelegram()
      setSettings(s => ({ ...s, telegram_connected: false, telegram_linked: false }))
      toast.success('Telegram disconnected')
    } catch { toast.error('Failed to disconnect') }
  }

  // ── Calendars tab state ──
  const [feeds, setFeeds] = useState([])
  const [feedName, setFeedName] = useState('')
  const [feedUrl, setFeedUrl] = useState('')
  const [addingFeed, setAddingFeed] = useState(false)
  const [syncingFeedId, setSyncingFeedId] = useState(null)

  useEffect(() => {
    if (settingsTab === 'calendars') {
      listCalendarFeeds().then(setFeeds).catch(() => {})
    }
  }, [settingsTab])

  const handleAddFeed = async (e) => {
    e.preventDefault()
    if (!feedUrl.trim()) { toast.error('Feed URL required'); return }
    setAddingFeed(true)
    try {
      const feed = await createCalendarFeed({ name: feedName.trim() || 'Calendar', url: feedUrl.trim() })
      setFeeds(prev => [...prev, feed])
      setFeedName(''); setFeedUrl('')
      if (feed.last_error) toast.error(`Added, but sync failed: ${feed.last_error}`)
      else toast.success(`"${feed.name}" connected and synced`)
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Failed to add calendar')
    } finally { setAddingFeed(false) }
  }

  const handleSyncFeed = async (id) => {
    setSyncingFeedId(id)
    try {
      const updated = await syncCalendarFeed(id)
      setFeeds(prev => prev.map(f => f.id === id ? updated : f))
      if (updated.last_error) toast.error(updated.last_error)
      else toast.success('Synced')
    } catch { toast.error('Sync failed') }
    finally { setSyncingFeedId(null) }
  }

  const handleDeleteFeed = async (id) => {
    if (!window.confirm('Remove this calendar? Its events will be deleted from Headspace (the source calendar is untouched).')) return
    setFeeds(prev => prev.filter(f => f.id !== id))
    try { await deleteCalendarFeed(id) } catch { toast.error('Failed to remove calendar') }
  }
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

  const [justExported, setJustExported] = useState(false)

  const handleExport = async () => {
    setLoading(true)
    try {
      const result = await runBackup()
      setStatus(await getExportStatus())
      toast.success(`Exported ${result.entries} entries, ${result.objects} objects, ${result.board_boxes ?? 0} board boxes`)
      setJustExported(true)
      setTimeout(() => setJustExported(false), 2500)
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
      const parts = [`${result.entries_imported} entries`, `${result.objects_imported} objects`]
      if (result.board_boxes_imported)   parts.push(`${result.board_boxes_imported} board boxes`)
      if (result.habits_imported)        parts.push(`${result.habits_imported} habits`)
      if (result.time_entries_imported)  parts.push(`${result.time_entries_imported} time entries`)
      toast.success(`Imported ${parts.join(', ')}`)
      e.target.value = ''
      setTimeout(() => window.location.reload(), 1200)
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
    { id: 'automation', label: '🤖 Automation' },
    { id: 'calendars', label: '📅 Calendars' },
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

      {/* ── Automation tab ── */}
      {settingsTab === 'automation' && (
        <div className={styles.tabContent}>

          <div className={styles.card}>
            <div className={styles.cardTitle}>Auto-tag Automatically</div>
            <p className={styles.cardDesc}>
              When on, anything you write — diary entries, object notes, Recordings — gets scanned
              5 minutes after you stop editing it, and any plain-text mentions of objects that already
              exist get linked automatically, exactly like the manual 🏷️ Auto-tag button. It never creates
              new objects. When off, tagging only happens when you press the button yourself.
              Calendar events are always auto-tagged live — no toggle needed for those.
            </p>
            {settings && (
              <button
                className={`${styles.toggleSwitch} ${settings.auto_tag_enabled ? styles.toggleOn : ''}`}
                onClick={handleToggleAutoTag}
                disabled={savingAutoTag}
              >
                <span className={styles.toggleKnob} />
              </button>
            )}
          </div>

          <div className={styles.card}>
            <div className={styles.cardTitle}>Automatic Task Creation</div>
            <p className={styles.cardDesc}>
              When on, diary entries are scanned once (5 minutes after you stop editing) by your local
              Ollama model for sentences like "I need to…" or "I'm planning to…", and each one becomes
              a task on the Tasks tab, rewritten as a short title — e.g. "I need to Contact XYZ" →
              "Contact XYZ". Once an entry has been scanned, it won't be scanned again automatically,
              even if you edit it later — use the ✅ Create Task button on that entry to force a rescan.
            </p>
            {settings && (
              <button
                className={`${styles.toggleSwitch} ${settings.auto_task_enabled ? styles.toggleOn : ''}`}
                onClick={handleToggleAutoTask}
                disabled={savingAutoTask}
              >
                <span className={styles.toggleKnob} />
              </button>
            )}
          </div>

          <div className={styles.card}>
            <div className={styles.cardTitle}>Telegram Bot</div>
            <p className={styles.cardDesc}>
              Text a private Telegram bot and it shows up as a timestamped diary entry — handy for
              quick notes on the go. Each account connects its own bot, so your messages only ever
              reach your own diary.
            </p>

            {!settings?.telegram_connected && (
              <>
                <ol className={styles.steps}>
                  <li>In Telegram, message <strong>@BotFather</strong> and send <code>/newbot</code>.</li>
                  <li>Follow the prompts to name your bot — BotFather gives you a token like <code>123456:ABC-def...</code>.</li>
                  <li>Paste that token below.</li>
                </ol>
                <form onSubmit={handleConnectTelegram} style={{ display:'flex', gap:8 }}>
                  <input
                    className={styles.confirmInput}
                    placeholder="Paste bot token from BotFather"
                    value={botToken}
                    onChange={e => setBotToken(e.target.value)}
                  />
                  <button className="btn btn-primary" type="submit" disabled={connectingBot}>
                    {connectingBot ? 'Connecting…' : 'Connect'}
                  </button>
                </form>
              </>
            )}

            {settings?.telegram_connected && (
              <>
                <p className={styles.cardDesc}>
                  {settings.telegram_linked
                    ? '✅ Bot connected and linked to your Telegram chat. Send it a message any time.'
                    : '⏳ Bot connected — now open Telegram and send your bot any message (even just "hi") to finish linking.'}
                </p>
                <div className={styles.btnRow}>
                  <button className="btn btn-secondary" onClick={handleDisconnectTelegram}>Disconnect</button>
                </div>
              </>
            )}
          </div>

        </div>
      )}

      {/* ── Calendars tab ── */}
      {settingsTab === 'calendars' && (
        <div className={styles.tabContent}>

          <div className={styles.card}>
            <div className={styles.cardTitle}>Connect a Calendar</div>
            <p className={styles.cardDesc}>
              Paste a Google Calendar or Outlook Calendar "Secret address in iCal format" (.ics) link.
              Headspace polls it every 30 minutes and shows today's events at the top of your Diary — one-way,
              read-only. Editing an event in Google/Outlook updates here automatically; nothing goes the other way.
            </p>
            <form onSubmit={handleAddFeed} style={{ display:'flex', flexDirection:'column', gap:10 }}>
              <input
                className={styles.confirmInput}
                placeholder="Name (e.g. Work Google Calendar)"
                value={feedName}
                onChange={e => setFeedName(e.target.value)}
              />
              <input
                className={styles.confirmInput}
                placeholder="https://calendar.google.com/calendar/ical/.../basic.ics"
                value={feedUrl}
                onChange={e => setFeedUrl(e.target.value)}
              />
              <div className={styles.btnRow}>
                <button className="btn btn-primary" type="submit" disabled={addingFeed}>
                  {addingFeed ? 'Connecting…' : '+ Connect Calendar'}
                </button>
              </div>
            </form>
          </div>

          <div className={styles.card}>
            <div className={styles.cardTitle}>Connected Calendars</div>
            {feeds.length === 0 && <p className={styles.cardDesc}>No calendars connected yet.</p>}
            <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
              {feeds.map(f => (
                <div key={f.id} style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 0', borderBottom:'1px solid var(--divider)' }}>
                  <span style={{ width:10, height:10, borderRadius:'50%', background:f.color, flexShrink:0 }} />
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:13, fontWeight:600 }}>{f.name}</div>
                    <div style={{ fontSize:11, color: f.last_error ? 'var(--accent-red)' : 'var(--text-muted)' }}>
                      {f.last_error ? f.last_error : f.last_synced_at ? `Last synced ${new Date(f.last_synced_at).toLocaleString()}` : 'Not synced yet'}
                    </div>
                  </div>
                  <button className="btn btn-secondary" onClick={() => handleSyncFeed(f.id)} disabled={syncingFeedId === f.id}>
                    {syncingFeedId === f.id ? 'Syncing…' : 'Sync now'}
                  </button>
                  <button className="btn btn-secondary" onClick={() => handleDeleteFeed(f.id)}>Remove</button>
                </div>
              ))}
            </div>
          </div>

          <div className={styles.card}>
            <div className={styles.cardTitle}>How to get your .ics link</div>
            <p className={styles.cardDesc}><strong>Google Calendar:</strong> Settings → select your calendar under "Settings for my calendars" → "Integrate calendar" → copy "Secret address in iCal format".</p>
            <p className={styles.cardDesc}><strong>Outlook:</strong> Settings → Calendar → Shared calendars → "Publish a calendar" → select ICS format → copy the link.</p>
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
              Exports all diary entries, objects, board boxes, habits, and time entries immediately.
            </p>
            <div className={styles.btnRow}>
              <button className="btn btn-primary" onClick={handleExport} disabled={loading}>
                {loading ? 'Exporting...' : justExported ? '✓ Exported' : 'Export Now'}
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
