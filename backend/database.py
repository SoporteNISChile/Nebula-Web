import aiosqlite
from config import get_config

_db_path: str = ""


def get_db_path() -> str:
    global _db_path
    if not _db_path:
        _db_path = get_config()["database"]["path"]
    return _db_path


async def init_db() -> None:
    async with aiosqlite.connect(get_db_path()) as db:
        await db.execute("""
            CREATE TABLE IF NOT EXISTS audit_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ts TEXT DEFAULT (datetime('now')),
                actor TEXT NOT NULL,
                action TEXT NOT NULL,
                target TEXT,
                detail TEXT,
                ip TEXT
            )
        """)
        await db.execute("CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log(ts)")
        await db.execute("CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_log(actor)")
        await db.execute("""
            CREATE TABLE IF NOT EXISTS users (
                username TEXT PRIMARY KEY,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'admin',
                created_at TEXT DEFAULT (datetime('now'))
            )
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS handshake_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ts TEXT NOT NULL,
                cert_name TEXT NOT NULL,
                vpn_addr TEXT,
                remote_addr TEXT,
                fingerprint TEXT,
                direction TEXT
            )
        """)
        await db.execute("CREATE INDEX IF NOT EXISTS idx_he_cert ON handshake_events(cert_name)")
        await db.execute("CREATE INDEX IF NOT EXISTS idx_he_ts ON handshake_events(ts)")
        await db.execute("""
            CREATE TABLE IF NOT EXISTS groups (
                name TEXT PRIMARY KEY,
                color TEXT NOT NULL DEFAULT '#6366f1',
                created_at TEXT DEFAULT (datetime('now'))
            )
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS cert_meta (
                cert_name TEXT PRIMARY KEY,
                display_name TEXT,
                revoked INTEGER DEFAULT 0
            )
        """)
        # migrations for new columns
        for col_sql in [
            "ALTER TABLE cert_meta ADD COLUMN revoked INTEGER DEFAULT 0",
            "ALTER TABLE cert_meta ADD COLUMN groups TEXT DEFAULT '[]'",
        ]:
            try:
                await db.execute(col_sql)
            except Exception:
                pass
        await db.execute("""
            CREATE TABLE IF NOT EXISTS alerts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ts TEXT DEFAULT (datetime('now')),
                cert_name TEXT NOT NULL,
                display_name TEXT,
                groups TEXT,
                ip TEXT,
                event TEXT NOT NULL,
                slack_sent INTEGER DEFAULT 0
            )
        """)
        await db.execute("CREATE INDEX IF NOT EXISTS idx_alerts_ts ON alerts(ts)")
        await db.execute("CREATE INDEX IF NOT EXISTS idx_alerts_cert ON alerts(cert_name)")
        await db.execute("""
            CREATE TABLE IF NOT EXISTS monitor_state (
                cert_name TEXT PRIMARY KEY,
                state TEXT NOT NULL,
                updated_at TEXT DEFAULT (datetime('now'))
            )
        """)
        await db.commit()


async def insert_alert(cert_name: str, display_name: str, groups: list, ip: str, event: str, slack_sent: bool = False) -> int:
    import json
    async with aiosqlite.connect(get_db_path()) as db:
        cur = await db.execute(
            "INSERT INTO alerts (cert_name, display_name, groups, ip, event, slack_sent) VALUES (?,?,?,?,?,?)",
            (cert_name, display_name, json.dumps(groups), ip, event, 1 if slack_sent else 0),
        )
        await db.commit()
        return cur.lastrowid


async def get_monitor_state() -> dict[str, str]:
    """Load persisted node states: {cert_name: 'active' | 'disconnected' | 'offline'}."""
    async with aiosqlite.connect(get_db_path()) as db:
        cur = await db.execute("SELECT cert_name, state FROM monitor_state")
        rows = await cur.fetchall()
        return {r[0]: r[1] for r in rows}


async def set_monitor_state(cert_name: str, state: str) -> None:
    async with aiosqlite.connect(get_db_path()) as db:
        await db.execute(
            "INSERT INTO monitor_state (cert_name, state, updated_at) VALUES (?,?,datetime('now')) "
            "ON CONFLICT(cert_name) DO UPDATE SET state=excluded.state, updated_at=excluded.updated_at",
            (cert_name, state),
        )
        await db.commit()


async def get_last_alert_ts(cert_name: str, event: str) -> str | None:
    """Timestamp (UTC 'YYYY-MM-DD HH:MM:SS') of the most recent alert of the given event for a node."""
    async with aiosqlite.connect(get_db_path()) as db:
        cur = await db.execute(
            "SELECT ts FROM alerts WHERE cert_name=? AND event=? ORDER BY ts DESC LIMIT 1",
            (cert_name, event),
        )
        row = await cur.fetchone()
        return row[0] if row else None


async def get_alerts(limit: int = 200, cert_name: str = None) -> list[dict]:
    import json
    async with aiosqlite.connect(get_db_path()) as db:
        db.row_factory = aiosqlite.Row
        if cert_name:
            cur = await db.execute(
                "SELECT * FROM alerts WHERE cert_name=? ORDER BY ts DESC LIMIT ?",
                (cert_name, limit),
            )
        else:
            cur = await db.execute(
                "SELECT * FROM alerts ORDER BY ts DESC LIMIT ?", (limit,)
            )
        rows = await cur.fetchall()
        result = []
        for r in rows:
            d = dict(r)
            try:
                d["groups"] = json.loads(d.get("groups") or "[]")
            except Exception:
                d["groups"] = []
            result.append(d)
        return result


async def insert_handshake(ts: str, cert_name: str, vpn_addr: str, remote_addr: str, fingerprint: str, direction: str) -> None:
    async with aiosqlite.connect(get_db_path()) as db:
        await db.execute(
            "INSERT INTO handshake_events (ts, cert_name, vpn_addr, remote_addr, fingerprint, direction) VALUES (?,?,?,?,?,?)",
            (ts, cert_name, vpn_addr, remote_addr, fingerprint, direction),
        )
        await db.commit()


async def get_handshake_history(cert_name: str = None, limit: int = 200) -> list:
    async with aiosqlite.connect(get_db_path()) as db:
        db.row_factory = aiosqlite.Row
        if cert_name:
            cursor = await db.execute(
                "SELECT * FROM handshake_events WHERE cert_name=? ORDER BY ts DESC LIMIT ?",
                (cert_name, limit),
            )
        else:
            cursor = await db.execute(
                "SELECT * FROM handshake_events ORDER BY ts DESC LIMIT ?",
                (limit,),
            )
        rows = await cursor.fetchall()
        return [dict(r) for r in rows]


async def get_duplicate_alerts(minutes: int = 15) -> dict[str, list[str]]:
    """
    Returns {cert_name: [ip1, ip2, ...]} for certs seen connecting from
    2+ distinct underlay IPs in the last N minutes — indicates shared/cloned cert.
    """
    async with aiosqlite.connect(get_db_path()) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            """
            SELECT cert_name, remote_addr
            FROM handshake_events
            WHERE ts >= datetime('now', ?)
              AND remote_addr != ''
            GROUP BY cert_name, remote_addr
            """,
            (f"-{minutes} minutes",),
        )
        rows = await cursor.fetchall()

    from collections import defaultdict
    by_cert: dict[str, set] = defaultdict(set)
    for r in rows:
        raw = r["remote_addr"] or ""
        ip = raw.rsplit(":", 1)[0].strip("[]")  # strip port + IPv6 brackets
        if ip:
            by_cert[r["cert_name"]].add(ip)

    return {name: sorted(ips) for name, ips in by_cert.items() if len(ips) >= 2}


async def get_all_groups() -> list[dict]:
    async with aiosqlite.connect(get_db_path()) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute("SELECT name, color FROM groups ORDER BY name")
        return [dict(r) for r in await cursor.fetchall()]


async def upsert_group(name: str, color: str) -> None:
    async with aiosqlite.connect(get_db_path()) as db:
        await db.execute(
            "INSERT INTO groups (name, color) VALUES (?,?) ON CONFLICT(name) DO UPDATE SET color=excluded.color",
            (name, color),
        )
        await db.commit()


async def delete_group(name: str) -> bool:
    async with aiosqlite.connect(get_db_path()) as db:
        cur = await db.execute("DELETE FROM groups WHERE name=?", (name,))
        await db.commit()
        return cur.rowcount > 0


async def get_group_colors() -> dict[str, str]:
    """Returns {group_name: color}."""
    groups = await get_all_groups()
    return {g["name"]: g["color"] for g in groups}


async def get_cert_display_name(cert_name: str) -> str | None:
    async with aiosqlite.connect(get_db_path()) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute("SELECT display_name FROM cert_meta WHERE cert_name=?", (cert_name,))
        row = await cur.fetchone()
        return row["display_name"] if row else None


async def set_cert_display_name(cert_name: str, display_name: str | None) -> None:
    async with aiosqlite.connect(get_db_path()) as db:
        await db.execute(
            "INSERT INTO cert_meta (cert_name, display_name) VALUES (?,?) "
            "ON CONFLICT(cert_name) DO UPDATE SET display_name=excluded.display_name",
            (cert_name, display_name or None),
        )
        await db.commit()


async def set_cert_revoked(cert_name: str, revoked: bool) -> None:
    async with aiosqlite.connect(get_db_path()) as db:
        await db.execute(
            "INSERT INTO cert_meta (cert_name, revoked) VALUES (?,?) "
            "ON CONFLICT(cert_name) DO UPDATE SET revoked=excluded.revoked",
            (cert_name, 1 if revoked else 0),
        )
        await db.commit()


async def set_cert_groups(cert_name: str, groups: list[str]) -> None:
    import json
    async with aiosqlite.connect(get_db_path()) as db:
        await db.execute(
            "INSERT INTO cert_meta (cert_name, groups) VALUES (?,?) "
            "ON CONFLICT(cert_name) DO UPDATE SET groups=excluded.groups",
            (cert_name, json.dumps(groups)),
        )
        await db.commit()


async def get_all_cert_meta() -> dict[str, dict]:
    """Returns {cert_name: {display_name, revoked, groups}} for all certs with metadata."""
    import json
    async with aiosqlite.connect(get_db_path()) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute("SELECT cert_name, display_name, revoked, groups FROM cert_meta")
        result = {}
        for r in await cur.fetchall():
            try:
                groups = json.loads(r["groups"] or "[]")
            except Exception:
                groups = []
            result[r["cert_name"]] = {
                "display_name": r["display_name"],
                "revoked": bool(r["revoked"]),
                "groups": groups,
            }
        return result


async def delete_cert_meta(cert_name: str) -> None:
    async with aiosqlite.connect(get_db_path()) as db:
        await db.execute("DELETE FROM cert_meta WHERE cert_name=?", (cert_name,))
        await db.commit()


async def log_audit(actor: str, action: str, target: str = None, detail: str = None, ip: str = None) -> None:
    import json as _json
    async with aiosqlite.connect(get_db_path()) as db:
        await db.execute(
            "INSERT INTO audit_log (actor, action, target, detail, ip) VALUES (?,?,?,?,?)",
            (actor, action, target, detail, ip),
        )
        await db.commit()


async def get_audit_log(limit: int = 200, actor: str = None, action_prefix: str = None) -> list[dict]:
    async with aiosqlite.connect(get_db_path()) as db:
        db.row_factory = aiosqlite.Row
        where, params = [], []
        if actor:
            where.append("actor=?"); params.append(actor)
        if action_prefix:
            where.append("action LIKE ?"); params.append(f"{action_prefix}%")
        sql = "SELECT * FROM audit_log"
        if where:
            sql += " WHERE " + " AND ".join(where)
        sql += " ORDER BY ts DESC LIMIT ?"
        params.append(limit)
        cur = await db.execute(sql, params)
        return [dict(r) for r in await cur.fetchall()]


async def get_all_users() -> list[dict]:
    async with aiosqlite.connect(get_db_path()) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute("SELECT username, role, created_at FROM users ORDER BY created_at")
        return [dict(r) for r in await cur.fetchall()]


async def get_user(username: str) -> dict | None:
    async with aiosqlite.connect(get_db_path()) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute("SELECT username, password_hash, role, created_at FROM users WHERE username=?", (username,))
        row = await cur.fetchone()
        return dict(row) if row else None


async def create_user(username: str, password_hash: str, role: str = "admin") -> None:
    async with aiosqlite.connect(get_db_path()) as db:
        await db.execute(
            "INSERT INTO users (username, password_hash, role) VALUES (?,?,?)",
            (username, password_hash, role),
        )
        await db.commit()


async def update_user(username: str, password_hash: str | None = None, role: str | None = None) -> bool:
    sets, vals = [], []
    if password_hash is not None:
        sets.append("password_hash=?"); vals.append(password_hash)
    if role is not None:
        sets.append("role=?"); vals.append(role)
    if not sets:
        return False
    vals.append(username)
    async with aiosqlite.connect(get_db_path()) as db:
        cur = await db.execute(f"UPDATE users SET {','.join(sets)} WHERE username=?", vals)
        await db.commit()
        return cur.rowcount > 0


async def delete_user(username: str) -> bool:
    async with aiosqlite.connect(get_db_path()) as db:
        cur = await db.execute("DELETE FROM users WHERE username=?", (username,))
        await db.commit()
        return cur.rowcount > 0


async def count_super_admins() -> int:
    async with aiosqlite.connect(get_db_path()) as db:
        cur = await db.execute("SELECT COUNT(*) FROM users WHERE role='super_admin'")
        row = await cur.fetchone()
        return row[0] if row else 0


async def migrate_config_admin(username: str, password_hash: str) -> None:
    """Migrate config-based admin to DB as super_admin (idempotent)."""
    async with aiosqlite.connect(get_db_path()) as db:
        cur = await db.execute("SELECT COUNT(*) FROM users")
        row = await cur.fetchone()
        if row and row[0] == 0:
            await db.execute(
                "INSERT INTO users (username, password_hash, role) VALUES (?,?,'super_admin')",
                (username, password_hash),
            )
            await db.commit()


async def get_last_seen_map() -> dict:
    """Returns {cert_name: last_ts_str} for all known certs."""
    async with aiosqlite.connect(get_db_path()) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            "SELECT cert_name, MAX(ts) as last_ts FROM handshake_events GROUP BY cert_name"
        )
        rows = await cursor.fetchall()
        return {r["cert_name"]: r["last_ts"] for r in rows}
