# Headspace

Self-hosted personal knowledge management and diary. Runs on your own server. All data is yours — stored as Markdown and JSON files.

**Port: 5151**

---

## Features

- Diary with calendar week strip — write multiple entries per day
- Object system: Person, Place, Idea, Organization
- `@mention` linking with automatic backlinks
- Full-text search across diary and objects
- Auto-export every 3 days as Markdown and JSON
- Import/export backup zip
- Dark theme, responsive — works on desktop and mobile browser
- No cloud dependency, no account required

---

## Deploying to GitHub

### Step 1 — Fork or push to your GitHub

```bash
git clone https://github.com/sunnyrabiussunny/headspace.git
cd headspace
# Make any changes
git add .
git commit -m "Initial setup"
git push origin main
```

### Step 2 — On your server, pull and run

```bash
git clone https://github.com/sunnyrabiussunny/headspace.git
cd headspace
sudo bash install.sh
```

That is it. Headspace starts on port **5151** and runs as a background service that survives reboots.

---

## One-Command Install (Ubuntu/Debian)

For a full self-hosted install that runs as a background service:

```bash
git clone https://github.com/sunnyrabiussunny/headspace.git
cd headspace
sudo bash install.sh
```

The script:
1. Installs Docker if not already present
2. Generates a secret key
3. Builds the frontend and backend containers
4. Starts everything with Docker Compose
5. Installs a systemd service so Headspace starts on reboot

After install, open: **http://localhost:5151**

---

## Manual Docker Setup

If you want to run it without the install script:

```bash
git clone https://github.com/sunnyrabiussunny/headspace.git
cd headspace

# Create .env
echo "SECRET_KEY=$(openssl rand -hex 32)" > .env

# Build and start
docker compose up -d --build
```

Open: **http://localhost:5151**

---

## Bluehost Subdomain Setup

Bluehost shared hosting does not support Docker. Use this approach instead:

### Option A — VPS (recommended)

1. Get a small VPS (DigitalOcean, Hetzner, or Linode — from $4/month)
2. Point your subdomain DNS to the VPS IP (`A record: headspace.yourdomain.com -> VPS_IP`)
3. SSH into the VPS and run the one-command install above
4. Set up Nginx on the VPS to proxy port 5151:

```nginx
server {
    listen 80;
    server_name headspace.yourdomain.com;

    location / {
        proxy_pass http://127.0.0.1:5151;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

5. Get a free SSL certificate:

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d headspace.yourdomain.com
```

### Option B — Bluehost VPS or Dedicated plan

If you have a Bluehost VPS or Dedicated server (not shared hosting):

```bash
ssh your-bluehost-vps
git clone https://github.com/sunnyrabiussunny/headspace.git
cd headspace
sudo bash install.sh
```

Then configure Apache or Nginx on Bluehost to proxy to port 5151.

---

## Node.js Direct Run (without Docker)

If Docker is not available, you can run the backend and frontend separately.

### Requirements

```bash
# Ubuntu/Debian
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt install -y nodejs python3 python3-pip python3-venv

# macOS
brew install node python3

# Windows
# Download Node.js from https://nodejs.org
# Download Python from https://python.org
```

### Run the backend

```bash
cd headspace/backend
python3 -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
mkdir -p /tmp/headspace/data/backups
DATABASE_URL="sqlite+aiosqlite:////tmp/headspace/data/headspace.db" \
BACKUP_DIR="/tmp/headspace/data/backups" \
uvicorn main:app --host 0.0.0.0 --port 8000
```

### Run the frontend

```bash
cd headspace/frontend
npm install
npm run build
npx serve -s dist -l 5173
```

Then open: **http://localhost:5173**

---

## Update to Latest Version

```bash
cd headspace
git pull origin main
docker compose down
docker compose up -d --build
```

---

## Data and Backups

All data is stored in `./data/`:

```
data/
  headspace.db          # SQLite database (all entries and objects)
  backups/
    diary/
      2026-06-05.md     # Human-readable Markdown
      <uuid>.json       # Machine-readable for import
    objects/
      person_Name.md
      <uuid>.json
    backup_manifest.json
```

**To sync with Syncthing:**
1. Install Syncthing on your server and your other device
2. Share the `./data/backups/` folder
3. Syncthing keeps it in sync automatically

**To trigger a backup:**
- Go to the Export tab in the app and click "Export Now"
- Or it runs automatically every 3 days

**To restore from backup:**
- Go to Export tab and click "Choose File"
- Upload the backup zip

---

## Manage the Service

```bash
# Start
sudo systemctl start headspace

# Stop
sudo systemctl stop headspace

# Restart
sudo systemctl restart headspace

# View logs
docker compose -f /path/to/headspace/docker-compose.yml logs -f

# Check status
sudo systemctl status headspace
```

---

## Environment Variables

| Variable       | Default                                        | Description              |
|----------------|------------------------------------------------|--------------------------|
| `SECRET_KEY`   | random (set by install.sh)                     | Internal signing key     |
| `DATABASE_URL` | `sqlite:////app/data/headspace.db`             | Database location        |
| `BACKUP_DIR`   | `/app/data/backups`                            | Backup output folder     |

---

## Tech Stack

| Layer     | Technology              |
|-----------|-------------------------|
| Frontend  | React 18 + Vite         |
| Backend   | FastAPI (Python)        |
| Database  | SQLite via SQLAlchemy   |
| Container | Docker + Docker Compose |
| Proxy     | Nginx                   |

---

## License

MIT. Do whatever you want with it.

---

*Built by Sunny Rabius Sunny — github.com/sunnyrabiussunny*
