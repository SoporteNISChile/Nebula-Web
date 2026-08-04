#!/usr/bin/env bash
set -e
BASE="$(cd "$(dirname "$0")" && pwd)"
SERVER="nis@10.120.0.1"

# Password comes from the SSHPASS environment variable (used by sshpass -e).
# Usage: SSHPASS='<password>' ./deploy.sh
if [ -z "$SSHPASS" ]; then
  echo "ERROR: set the SSHPASS environment variable first: SSHPASS='<password>' ./deploy.sh" >&2
  exit 1
fi
export SSHPASS

SCP="sshpass -e scp -o StrictHostKeyChecking=no"
SSH="sshpass -e ssh -o StrictHostKeyChecking=no $SERVER"

echo "==> Syncing backend..."
$SCP "$BASE/backend/database.py"        "$SERVER:/opt/nebula-web/backend/"
$SCP "$BASE/backend/main.py"            "$SERVER:/opt/nebula-web/backend/"
$SCP "$BASE/backend/lib/monitor.py"     "$SERVER:/opt/nebula-web/backend/lib/"
$SCP "$BASE/backend/routers/alerts.py"  "$SERVER:/opt/nebula-web/backend/routers/"
$SCP "$BASE/backend/routers/service.py" "$SERVER:/opt/nebula-web/backend/routers/"

echo "==> Syncing frontend dist..."
sshpass -e rsync -az --delete -e "ssh -o StrictHostKeyChecking=no" \
  "$BASE/frontend/dist/" "$SERVER:/opt/nebula-web/frontend/dist/"

echo "==> Installing aiohttp..."
$SSH "sudo -S /opt/nebula-web/venv/bin/pip install aiohttp --quiet" <<< "$SSHPASS"

echo "==> Restarting service..."
$SSH "sudo -S systemctl restart nebula-web" <<< "$SSHPASS"

sleep 2
echo "==> Status:"
$SSH "sudo -S systemctl is-active nebula-web" <<< "$SSHPASS"
