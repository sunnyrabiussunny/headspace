# Headspace Time Tracker — Chrome Extension

A minimal Chrome extension that connects to your self-hosted Headspace server
and lets you start/stop timers from any tab.

## Install (Windows Chrome, Self-Hosted)

1. Open Chrome and go to `chrome://extensions`
2. Enable **Developer mode** (toggle top-right)
3. Click **Load unpacked**
4. Select this `chrome-extension/` folder
5. The Headspace H icon appears in your toolbar — pin it

## First time setup

1. Click the extension icon
2. If it says "Cannot reach Headspace server", scroll to the bottom
3. Enter your server URL: `http://192.168.10.103:5151`
4. Click **Save** — it will reconnect automatically

## Usage

- **Start timer**: Pick a project, type what you're working on, click Start
- **Stop timer**: Click Stop (red button appears while timer is running)
- **View dashboard**: Click ↗ to open the full Time dashboard in a new tab
- Running timer stays visible as a green banner with live elapsed time

## Notes

- The extension communicates directly with `http://192.168.10.103:5151`
- Works on any Windows machine on the same local network as the Ubuntu server
- No internet connection required — fully local
- If you change the server URL in settings, reload the extension once from `chrome://extensions`
