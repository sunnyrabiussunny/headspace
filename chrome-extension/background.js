// Background service worker — keeps track of running timer state
// and fires a notification every hour as a reminder

chrome.alarms.create('tick', { periodInMinutes: 60 })

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== 'tick') return
  const { running } = await chrome.storage.local.get('running')
  if (!running) return
  const elapsed = Math.round((Date.now() - new Date(running.start_time).getTime()) / 3600000)
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icon32.png',
    title: 'Headspace Timer Running',
    message: `Still tracking: ${running.description || running.project_name || 'Unknown project'} (${elapsed}h+)`
  })
})
