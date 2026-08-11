# Cloud Backup Setup (Google Drive / Box)

This backs up **every account's** data (diary, objects, board, habits, time
tracker) to a cloud drive on a schedule, so a server crash or disk failure
doesn't lose anything.

We use [rclone](https://rclone.org) rather than building Google Drive/Box
login directly into Headspace. Reasons:

- Headspace is self-hosted and single-tenant — there's no good place to
  safely store a Google/Box OAuth client secret per install, and Google's
  OAuth consent screen requires app review for anything beyond a handful
  of test users.
- rclone is a mature, widely-used tool that already speaks to Google
  Drive, Box, Dropbox, OneDrive, S3, and 40+ other backends, with a
  battle-tested auth flow.
- It runs as a normal cron job / systemd timer on your server — nothing
  inside the Headspace containers needs cloud credentials at all.

## 1. Install rclone

On the Ubuntu server that runs `docker compose` for Headspace:

```bash
curl https://rclone.org/install.sh | sudo bash
```

## 2. Create a remote (one-time, interactive)

```bash
rclone config
```

- Choose `n` for a new remote, name it e.g. `gdrive` (or `box`).
- Pick `drive` (Google Drive) or `box` from the storage list.
- Follow the prompts. For Google Drive, it opens a browser link for you to
  approve access — you can do this on your phone/laptop and paste the
  resulting code back into the SSH session if the server has no browser.
- When done, `rclone listremotes` should show `gdrive:` (or `box:`).

Test it:

```bash
rclone mkdir gdrive:HeadspaceBackups
rclone lsd gdrive:
```

## 3. Set a cron secret

In `docker-compose.yml`, add a `CRON_SECRET` to the backend service's
environment (pick any long random string):

```yaml
  backend:
    environment:
      - CRON_SECRET=some-long-random-string-here
```

Then `docker compose up -d` to apply it.

## 4. Configure and test the backup script

```bash
cd ~/headspace/scripts
export CRON_SECRET=some-long-random-string-here   # same value as above
export RCLONE_REMOTE=gdrive:HeadspaceBackups        # or box:HeadspaceBackups
./backup-to-cloud.sh
```

Check the log at `/tmp/headspace-cloud-backup.log`, and confirm files show
up with `rclone lsd gdrive:HeadspaceBackups`. You should see one subfolder
per account username, each containing `diary/`, `objects/`, `board/`,
`habits.json`, and `time.json`.

## 5. Automate it

**Option A — cron (simplest):**

```bash
crontab -e
```

Add a line (runs daily at 3:30am):

```
30 3 * * * CRON_SECRET=some-long-random-string-here RCLONE_REMOTE=gdrive:HeadspaceBackups /home/YOURUSER/headspace/scripts/backup-to-cloud.sh
```

**Option B — systemd timer (more robust, logs to journalctl):**

```bash
sudo cp headspace-backup.service /etc/systemd/system/
sudo cp headspace-backup.timer /etc/systemd/system/
sudo nano /etc/systemd/system/headspace-backup.service   # fill in your CRON_SECRET, RCLONE_REMOTE, and path
sudo systemctl daemon-reload
sudo systemctl enable --now headspace-backup.timer
sudo systemctl start headspace-backup.service   # run once now to test
journalctl -u headspace-backup.service -f       # watch logs
```

## Restoring from a cloud backup

1. Download the relevant account's folder from Google Drive/Box (or
   `rclone copy gdrive:HeadspaceBackups/yourusername ./restore`).
2. In Headspace, log into that account → Settings → Backup & Import →
   "Choose Backup File" (for the JSON files) — or, for a full restore
   after a total server rebuild, just copy the whole `data/` folder back
   before starting the containers.
