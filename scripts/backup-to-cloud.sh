#!/usr/bin/env bash
#
# Headspace — cloud backup script
#
# 1. Calls the Headspace backend to freshly export EVERY account's data
#    (diary, objects, board, habits, time tracker) to the local backups
#    folder.
# 2. Syncs that folder to a cloud remote (Google Drive, Box, Dropbox, S3,
#    etc.) using rclone.
#
# Intended to run on a schedule (cron or systemd timer) on the SAME host
# that runs `docker compose` for Headspace — see scripts/README.md for
# full setup steps, including how to create the rclone remote.

set -euo pipefail

# ── Config (edit these, or set as environment variables before running) ──
HEADSPACE_URL="${HEADSPACE_URL:-http://localhost:5151}"
CRON_SECRET="${CRON_SECRET:?Set CRON_SECRET to the same value as in docker-compose.yml}"
RCLONE_REMOTE="${RCLONE_REMOTE:?Set RCLONE_REMOTE, e.g. gdrive:HeadspaceBackups or box:HeadspaceBackups}"
BACKUP_DIR="${BACKUP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/data/backups}"
LOG_FILE="${LOG_FILE:-/tmp/headspace-cloud-backup.log}"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"; }

log "Starting Headspace cloud backup"

# 1. Trigger a fresh export for every account
RESPONSE=$(curl -sf -X POST "$HEADSPACE_URL/api/export/backup-all" \
  -H "X-Cron-Secret: $CRON_SECRET") || {
    log "ERROR: backup-all request failed. Is Headspace running at $HEADSPACE_URL, and does CRON_SECRET match docker-compose.yml?"
    exit 1
}
log "Export response: $RESPONSE"

# 2. Sync the local backup folder to the cloud remote
if ! command -v rclone >/dev/null 2>&1; then
  log "ERROR: rclone is not installed. See scripts/README.md for install steps."
  exit 1
fi

log "Syncing $BACKUP_DIR -> $RCLONE_REMOTE"
rclone sync "$BACKUP_DIR" "$RCLONE_REMOTE" \
  --create-empty-src-dirs \
  --log-file "$LOG_FILE" --log-level INFO

log "Cloud backup complete."
