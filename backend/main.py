import asyncio
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

from config import get_config, is_setup_complete
from database import init_db
from lib.nebula import get_recent_handshakes
from database import insert_handshake
from routers import auth, nodes, logs, config_router, certs, service


async def _sync_handshakes_loop():
    """Background task: tail journalctl and persist handshake events to SQLite."""
    cfg = get_config()
    svc = cfg["nebula"]["service_name"]
    use_sudo = cfg["nebula"]["use_sudo"]

    cmd = ["journalctl", "-u", svc, "--no-pager", "--output=cat", "-f", "-n", "200"]
    if use_sudo:
        cmd = ["sudo", "-n"] + cmd

    while True:
        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            async for raw_bytes in proc.stdout:
                raw = raw_bytes.decode(errors="replace").rstrip()
                if "Handshake message" not in raw:
                    continue
                from lib.nebula import parse_log_line
                parsed = parse_log_line(raw)
                if not parsed:
                    continue
                fields = parsed.get("fields", {})
                cert_name = fields.get("certName")
                if cert_name:
                    await insert_handshake(
                        ts=parsed["time"],
                        cert_name=cert_name,
                        vpn_addr=fields.get("vpnAddrs", ""),
                        remote_addr=fields.get("from", ""),
                        fingerprint=fields.get("fingerprint", ""),
                        direction="received" if "received" in parsed["msg"].lower() else "sent",
                    )
        except Exception:
            await asyncio.sleep(5)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    task = asyncio.create_task(_sync_handshakes_loop())
    yield
    task.cancel()


def create_app() -> FastAPI:
    cfg = get_config()

    app = FastAPI(
        title="Nebula Web",
        description="Web interface for Nebula VPN administration",
        version="1.0.0",
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=cfg["server"]["allowed_origins"],
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "DELETE"],
        allow_headers=["Authorization", "Content-Type"],
    )

    class SecurityHeadersMiddleware(BaseHTTPMiddleware):
        async def dispatch(self, request: Request, call_next):
            response = await call_next(request)
            response.headers["X-Frame-Options"] = "DENY"
            response.headers["X-Content-Type-Options"] = "nosniff"
            response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
            response.headers["Permissions-Policy"] = "geolocation=(), camera=(), microphone=()"
            return response

    app.add_middleware(SecurityHeadersMiddleware)

    app.include_router(auth.router, prefix="/api")
    app.include_router(nodes.router, prefix="/api")
    app.include_router(logs.router, prefix="/api")
    app.include_router(config_router.router, prefix="/api")
    app.include_router(certs.router, prefix="/api")
    app.include_router(service.router, prefix="/api")

    @app.get("/api/health")
    async def health():
        setup = is_setup_complete(get_config())
        return {"status": "ok", "setup_complete": setup}

    # Serve React frontend in production
    frontend_dist = Path(__file__).parent.parent / "frontend" / "dist"
    if frontend_dist.exists():
        app.mount("/assets", StaticFiles(directory=str(frontend_dist / "assets")), name="assets")

        @app.get("/{full_path:path}")
        async def serve_spa(full_path: str):
            index = frontend_dist / "index.html"
            return FileResponse(str(index))

    return app


app = create_app()

if __name__ == "__main__":
    import uvicorn
    cfg = get_config()
    uvicorn.run(
        "main:app",
        host=cfg["server"]["host"],
        port=cfg["server"]["port"],
        reload=False,
    )
