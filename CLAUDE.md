# Nebula-Web — Instrucciones para Claude

## Regla obligatoria: GitHub siempre actualizado

**Cada cambio de código debe subirse a GitHub (`git commit` + `git push origin main`) como paso final, sin que el usuario lo pida.** El repositorio remoto es https://github.com/SoporteNISChile/Nebula-Web y debe reflejar siempre lo que corre en producción.

- Commits sin firma GPG (`git commit --no-gpg-sign`) — no hay TTY para la passphrase.
- Nunca commitear secretos: passwords van por variable de entorno (ver `deploy.sh`, usa `SSHPASS`).

## Flujo de deploy a producción

1. Frontend: `cd frontend && npm run build` (build desde `frontend/`, no desde la raíz).
2. Transferir archivos con `scp` + `sshpass -f <archivo-password>` a `nis@10.120.0.1`:
   - Frontend: `/opt/nebula-web/frontend/dist/` (index.html + assets con hash nuevo)
   - Backend: `/opt/nebula-web/backend/` (misma estructura: raíz, `lib/`, `routers/`)
3. Reiniciar: `sudo -n systemctl restart nebula-web` (usuario `nis` tiene sudo sin password para systemctl).
4. Verificar: `systemctl is-active nebula-web` y HTTP 200 en puerto 3000.
5. **Commit + push a GitHub.**

No tocar en el servidor: `nebula-web.config.yml`, `nebula-web.db`, `nebula.db`.

## Datos del proyecto

- Backend: FastAPI (Python) en puerto 3000, servicio systemd `nebula-web`.
- Frontend: React + Vite + Tailwind, servido por el backend desde `frontend/dist/`.
- DB: SQLite en `/opt/nebula-web/nebula-web.db` (sin `sqlite3` CLI en el servidor; usar `/opt/nebula-web/venv/bin/python3`).
- Alertas: monitor en `backend/lib/monitor.py`, grupos monitoreados en `nebula-web.config.yml` (`alerts.monitor_groups`), estado persistido en tabla `monitor_state`.
