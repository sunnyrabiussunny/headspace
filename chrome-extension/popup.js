const DEFAULT_SERVER = 'http://192.168.10.103:5151'

let serverUrl = DEFAULT_SERVER
let projects  = []
let running   = null
let tickInterval = null

// ── Helpers ──────────────────────────────────────────────────────────────

const api = async (method, path, body) => {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
    mode: 'cors',
  }
  if (body) opts.body = JSON.stringify(body)
  let r
  try {
    r = await fetch(`${serverUrl}/api/time${path}`, opts)
  } catch (e) {
    throw new Error('fetch failed — server unreachable or CORS blocked')
  }
  if (!r.ok && r.status !== 204) throw new Error(`HTTP ${r.status}`)
  if (r.status === 204) return null
  return r.json()
}

const fmtDur = (secs) => {
  if (!secs || secs < 0) return '0:00:00'
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  const s = Math.floor(secs % 60)
  return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
}

const fmtH = (secs) => {
  const h = secs / 3600
  return h < 0.1 ? '<0.1h' : `${h.toFixed(1)}h`
}

const today = () => new Date().toISOString().slice(0, 10)

// ── DOM refs ──────────────────────────────────────────────────────────────

const $  = id => document.getElementById(id)
const statusBar     = $('statusBar')
const runningBanner = $('runningBanner')
const runningProject= $('runningProject')
const runningDesc   = $('runningDesc')
const liveTimer     = $('liveTimer')
const projectSelect = $('projectSelect')
const descInput     = $('descInput')
const startBtn      = $('startBtn')
const stopBtn       = $('stopBtn')
const entriesList   = $('entriesList')
const todayTotal    = $('todayTotal')
const serverUrlInput= $('serverUrl')
const saveSettings  = $('saveSettings')
const openDashBtn   = $('openDashBtn')

// ── Tick ──────────────────────────────────────────────────────────────────

function startTick() {
  clearInterval(tickInterval)
  if (!running) return
  const startMs = new Date(running.start_time).getTime()
  tickInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - startMs) / 1000)
    liveTimer.textContent = fmtDur(elapsed)
  }, 1000)
}

// ── Render ────────────────────────────────────────────────────────────────

function renderRunning() {
  if (running) {
    runningBanner.classList.remove('hidden')
    const proj = projects.find(p => p.id === running.project_id)
    runningProject.textContent = proj?.name || 'Unknown project'
    runningDesc.textContent    = running.description || ''
    const elapsed = Math.floor((Date.now() - new Date(running.start_time).getTime()) / 1000)
    liveTimer.textContent = fmtDur(elapsed)
    startTick()
    startBtn.classList.add('hidden')
    stopBtn.classList.remove('hidden')
  } else {
    runningBanner.classList.add('hidden')
    clearInterval(tickInterval)
    startBtn.classList.remove('hidden')
    stopBtn.classList.add('hidden')
  }
}

function renderProjects() {
  projectSelect.innerHTML = ''
  if (projects.length === 0) {
    projectSelect.innerHTML = '<option value="">No projects — create one in Headspace</option>'
    startBtn.disabled = true
    return
  }
  projects.forEach(p => {
    const opt = document.createElement('option')
    opt.value = p.id
    opt.textContent = p.name
    projectSelect.appendChild(opt)
  })
  startBtn.disabled = false
}

function renderEntries(entries) {
  entriesList.innerHTML = ''
  const todayEntries = entries.filter(e => e.start_time?.startsWith(today()))
  if (todayEntries.length === 0) {
    entriesList.innerHTML = '<div class="empty">No entries today</div>'
    todayTotal.textContent = ''
    return
  }
  const totalSecs = todayEntries.reduce((s, e) => s + (e.duration || 0), 0)
  todayTotal.textContent = fmtH(totalSecs)

  todayEntries.slice(0, 8).forEach(e => {
    const proj = projects.find(p => p.id === e.project_id)
    const row = document.createElement('div')
    row.className = 'entry-row'
    row.innerHTML = `
      <div class="entry-color" style="background:${proj?.color || '#888'}"></div>
      <div class="entry-info">
        <div class="entry-proj">${proj?.name || '?'}</div>
        ${e.description ? `<div class="entry-desc">${e.description}</div>` : ''}
        <div class="entry-time">
          ${e.start_time ? new Date(e.start_time).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : ''}
          ${e.end_time   ? ` – ${new Date(e.end_time).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}` : ''}
        </div>
      </div>
      <div class="entry-dur">${fmtH(e.duration || 0)}</div>
    `
    entriesList.appendChild(row)
  })
}

function setStatus(type, msg) {
  statusBar.className = `status-bar status-${type}`
  statusBar.textContent = msg
}

// ── Load ──────────────────────────────────────────────────────────────────

async function loadAll() {
  setStatus('checking', 'Connecting…')
  try {
    const [projs, run, entries] = await Promise.all([
      api('GET', '/projects'),
      api('GET', '/running'),
      api('GET', `/entries?from_date=${today()}&to_date=${today()}`)
    ])
    projects = projs
    running  = run
    renderProjects()
    renderRunning()
    renderEntries(entries)
    setStatus('ok', `Connected · ${serverUrl.replace('http://','').replace('https://','').split('/')[0]}`)
  } catch (err) {
    const msg = err.message || 'Network error'
    setStatus('error', `Cannot reach server — ${msg}`)
    entriesList.innerHTML = '<div class="empty">Check server URL in settings below</div>'
    startBtn.disabled = true
    console.error('Headspace connection error:', err)
  }
}

// ── Events ────────────────────────────────────────────────────────────────

startBtn.addEventListener('click', async () => {
  const pid = projectSelect.value
  if (!pid) return
  try {
    running = await api('POST', '/start', {
      project_id: pid,
      description: descInput.value.trim()
    })
    descInput.value = ''
    renderRunning()
    await loadAll()
  } catch { setStatus('error', 'Failed to start timer') }
})

stopBtn.addEventListener('click', async () => {
  try {
    await api('POST', '/stop')
    running = null
    renderRunning()
    await loadAll()
  } catch { setStatus('error', 'Failed to stop timer') }
})

openDashBtn.addEventListener('click', () => {
  chrome.tabs.create({ url: `${serverUrl}/time` })
})

saveSettings.addEventListener('click', async () => {
  const url = serverUrlInput.value.trim().replace(/\/$/, '')
  if (!url) return
  serverUrl = url
  await chrome.storage.local.set({ serverUrl: url })
  // Update manifest host_permissions programmatically not possible, but
  // user just needs to reload extension after changing URL in settings
  loadAll()
})

// ── Init ──────────────────────────────────────────────────────────────────

async function init() {
  const stored = await chrome.storage.local.get('serverUrl')
  if (stored.serverUrl) {
    serverUrl = stored.serverUrl
    serverUrlInput.value = stored.serverUrl
  } else {
    serverUrlInput.value = DEFAULT_SERVER
  }
  await loadAll()
}

init()
