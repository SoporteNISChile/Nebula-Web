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
        await db.commit()


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


async def get_last_seen_map() -> dict:
    """Returns {cert_name: last_ts_str} for all known certs."""
    async with aiosqlite.connect(get_db_path()) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            "SELECT cert_name, MAX(ts) as last_ts FROM handshake_events GROUP BY cert_name"
        )
        rows = await cursor.fetchall()
        return {r["cert_name"]: r["last_ts"] for r in rows}
