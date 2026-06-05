#!/usr/bin/env bash
# Headspace — one-command Ubuntu installer
# Usage: sudo bash install.sh
# Port: 5151

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo ""
echo -e "${CYAN}  ██╗  ██╗███████╗ █████╗ ██████╗ ███████╗██████╗  █████╗  ██████╗███████╗${NC}"
echo -e "${CYAN}  ██║  ██║██╔════╝██╔══██╗██╔══██╗██╔════╝██╔══██╗██╔══██╗██╔════╝██╔════╝${NC}"
echo -e "${CYAN}  ███████║█████╗  ███████║██║  ██║███████╗██████╔╝███████║██║     █████╗  ${NC}"
echo -e "${CYAN}  ██╔══██║██╔══╝  ██╔══██║██║  ██║╚════██║██╔═══╝ ██╔══██║██║     ██╔══╝  ${NC}"
echo -e "${CYAN}  ██║  ██║███████╗██║  ██║██████╔╝███████║██║     ██║  ██║╚██████╗███████╗${NC}"
echo -e "${CYAN}  ╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝╚═════╝ ╚══════╝╚═╝     ╚═╝  ╚═╝ ╚═════╝╚══════╝${NC}"
echo ""
echo -e "${GREEN}Self-hosted personal knowledge and diary — port 5151${NC}"
echo ""

# ── Check root ──────────────────────────────────────────────────────────────
if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}Please run as root: sudo bash install.sh${NC}"
  exit 1
fi

# ── Install Docker if needed ────────────────────────────────────────────────
if ! command -v docker &>/dev/null; then
  echo -e "${YELLOW}Installing Docker...${NC}"
  curl -fsSL https://get.docker.com | sh
  systemctl enable docker
  systemctl start docker
  echo -e "${GREEN}Docker installed${NC}"
else
  echo -e "${GREEN}Docker already installed${NC}"
fi

# ── Install Docker Compose plugin if needed ─────────────────────────────────
if ! docker compose version &>/dev/null; then
  echo -e "${YELLOW}Installing Docker Compose plugin...${NC}"
  apt-get update -qq
  apt-get install -y docker-compose-plugin
fi

# ── Generate secret key ─────────────────────────────────────────────────────
SECRET_KEY=$(openssl rand -hex 32)

# ── Write .env ──────────────────────────────────────────────────────────────
cat > .env <<EOF
SECRET_KEY=${SECRET_KEY}
EOF
echo -e "${GREEN}.env created${NC}"

# ── Create data directory ───────────────────────────────────────────────────
mkdir -p ./data/backups
chmod 755 ./data

# ── Build and start ─────────────────────────────────────────────────────────
echo -e "${YELLOW}Building containers (first time takes 2-3 minutes)...${NC}"
docker compose build --no-cache

echo -e "${YELLOW}Starting Headspace...${NC}"
docker compose up -d

# ── Install as systemd service ──────────────────────────────────────────────
INSTALL_DIR=$(pwd)

cat > /etc/systemd/system/headspace.service <<EOF
[Unit]
Description=Headspace personal knowledge app
After=network.target docker.service
Requires=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=${INSTALL_DIR}
ExecStart=/usr/bin/docker compose up -d
ExecStop=/usr/bin/docker compose down
TimeoutStartSec=60

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable headspace

echo ""
echo -e "${GREEN}========================================================${NC}"
echo -e "${GREEN}  Headspace is running at:${NC}"
echo -e "${CYAN}  http://localhost:5151${NC}"
echo ""
echo -e "${GREEN}  To use from another device on your network:${NC}"
LOCAL_IP=$(hostname -I | awk '{print $1}')
echo -e "${CYAN}  http://${LOCAL_IP}:5151${NC}"
echo ""
echo -e "${GREEN}  Service installed — starts automatically on reboot.${NC}"
echo -e "${GREEN}  Manage: sudo systemctl start/stop/restart headspace${NC}"
echo -e "${GREEN}  Logs:   docker compose logs -f${NC}"
echo -e "${GREEN}========================================================${NC}"
echo ""
