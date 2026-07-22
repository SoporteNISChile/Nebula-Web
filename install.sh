#!/bin/bash
# Nebula Web installer — direct Python install (no Docker)
set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/nebula-web}"
SERVICE_USER="${SERVICE_USER:-nebula-web}"
PORT="${PORT:-3000}"

echo "=== Nebula Web Installer ==="
echo "Install dir: $INSTALL_DIR"

# Requirements
if ! command -v python3 &>/dev/null; then echo "ERROR: python3 required"; exit 1; fi
if ! command -v pip3 &>/dev/null && ! python3 -m pip --version &>/dev/null; then echo "ERROR: pip3 required"; exit 1; fi
if ! command -v node &>/dev/null; then echo "ERROR: node required for frontend build"; exit 1; fi
if ! command -v npm &>/dev/null; then echo "ERROR: npm required"; exit 1; fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Create install dir
sudo mkdir -p "$INSTALL_DIR"
sudo cp -r "$SCRIPT_DIR/backend" "$INSTALL_DIR/"
sudo cp -r "$SCRIPT_DIR/frontend" "$INSTALL_DIR/"

# Build frontend
echo "Building frontend..."
cd "$INSTALL_DIR/frontend"
sudo npm install --quiet
sudo npm run build

# Install Python deps
echo "Installing Python dependencies..."
cd "$INSTALL_DIR/backend"
sudo python3 -m pip install -r requirements.txt --quiet

# Create config if not exists
if [ ! -f "$INSTALL_DIR/backend/nebula-web.config.yml" ]; then
    sudo cp "$SCRIPT_DIR/nebula-web.config.example.yml" "$INSTALL_DIR/backend/nebula-web.config.yml"
    echo "Config created at $INSTALL_DIR/backend/nebula-web.config.yml — edit before starting."
fi

# Create service user
if ! id "$SERVICE_USER" &>/dev/null; then
    sudo useradd -r -s /bin/false -d "$INSTALL_DIR" "$SERVICE_USER"
fi
sudo chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR"

# Systemd service
cat <<EOF | sudo tee /etc/systemd/system/nebula-web.service > /dev/null
[Unit]
Description=Nebula Web - VPN Administration Interface
After=network.target nebula.service

[Service]
Type=simple
User=$SERVICE_USER
WorkingDirectory=$INSTALL_DIR/backend
ExecStart=python3 main.py
Restart=on-failure
RestartSec=5
Environment=NEBULA_WEB_CONFIG=$INSTALL_DIR/backend/nebula-web.config.yml

[Install]
WantedBy=multi-user.target
EOF

# Sudoers for service user (adjust paths as needed)
cat <<EOF | sudo tee /etc/sudoers.d/nebula-web > /dev/null
# Allow nebula-web to manage the nebula service and read its files
$SERVICE_USER ALL=(ALL) NOPASSWD: /usr/bin/systemctl start nebula, /usr/bin/systemctl stop nebula, /usr/bin/systemctl restart nebula, /usr/bin/systemctl reload nebula, /usr/bin/systemctl status nebula, /usr/bin/systemctl cat nebula
$SERVICE_USER ALL=(ALL) NOPASSWD: /usr/bin/journalctl -u nebula *
$SERVICE_USER ALL=(ALL) NOPASSWD: /usr/local/bin/nebula-cert *
EOF

sudo systemctl daemon-reload
sudo systemctl enable nebula-web
sudo systemctl start nebula-web

echo ""
echo "=== Installation complete ==="
echo "Service: nebula-web (systemd)"
echo "URL: http://$(hostname -I | awk '{print $1}'):$PORT"
echo ""
echo "First run: visit the URL and set your admin password."
echo "Logs: journalctl -u nebula-web -f"
