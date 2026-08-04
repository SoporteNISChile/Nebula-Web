from fastapi import APIRouter, HTTPException, Depends, Request
from pydantic import BaseModel

from auth import require_super_admin
from config import get_config
from database import log_audit
from lib.nebula import _run

router = APIRouter(prefix="/cli", tags=["cli"])

# Commands available via Nebula sshd, with their argument spec
COMMANDS = {
    "list-hostmap":           {"args": [], "description": "List all known hosts in the hostmap"},
    "list-pending-hostmap":   {"args": [], "description": "List hosts currently in handshake phase"},
    "list-lighthouse-addrmap":{"args": [], "description": "List all lighthouse address map entries"},
    "device-info":            {"args": [], "description": "Print network device information"},
    "print-relays":           {"args": [], "description": "Print all relay info"},
    "version":                {"args": [], "description": "Show Nebula version"},
    "print-tunnel":           {"args": ["vpn-ip"], "description": "Print details about a specific tunnel"},
    "close-tunnel":           {"args": ["vpn-ip"], "description": "Close the tunnel for a VPN IP"},
    "query-lighthouse":       {"args": ["vpn-ip"], "description": "Query lighthouses for a VPN IP"},
    "print-cert":             {"args": ["vpn-ip?"], "description": "Print certificate details (optional VPN IP)"},
    "log-level":              {"args": ["level?"], "description": "Get or set log level (debug/info/warning/error)"},
}


class RunCommandRequest(BaseModel):
    command: str
    args: list[str] = []


@router.get("/commands")
async def get_commands(_: dict = Depends(require_super_admin)):
    return {"commands": [{"name": k, **v} for k, v in COMMANDS.items()]}


@router.post("/run")
async def run_command(body: RunCommandRequest, request: Request, actor: dict = Depends(require_super_admin)):
    if body.command not in COMMANDS:
        raise HTTPException(status_code=400, detail=f"Unknown command: {body.command}")

    spec = COMMANDS[body.command]
    required_args = [a for a in spec["args"] if not a.endswith("?")]
    if len(body.args) < len(required_args):
        raise HTTPException(
            status_code=400,
            detail=f"Command '{body.command}' requires args: {', '.join(required_args)}"
        )

    cfg = get_config()
    sshd_cfg = cfg.get("nebula", {}).get("sshd", {})
    key_path = sshd_cfg.get("key_path", "/opt/nebula-web/nebula_mgmt_key")
    port = int(sshd_cfg.get("port", 2222))
    host = sshd_cfg.get("host", "127.0.0.1")
    user = sshd_cfg.get("user", "nebula")

    ssh_cmd = [
        "ssh",
        "-i", key_path,
        "-o", "StrictHostKeyChecking=no",
        "-o", "BatchMode=yes",
        "-o", "ConnectTimeout=5",
        "-p", str(port),
        f"{user}@{host}",
        body.command,
        *body.args,
    ]

    code, out, err = await _run(ssh_cmd)
    await log_audit(actor["username"], "cli.run", target=body.command,
                    detail=" ".join(body.args) if body.args else None,
                    ip=request.client.host)
    return {
        "command": body.command,
        "args": body.args,
        "exit_code": code,
        "output": out,
        "error": err if code != 0 else "",
    }
