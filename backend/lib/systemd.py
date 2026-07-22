import asyncio
import re
from config import get_config


async def _run_systemctl(args: list[str]) -> tuple[int, str, str]:
    cfg = get_config()
    cmd = ["systemctl"] + args
    if cfg["nebula"]["use_sudo"]:
        cmd = ["sudo", "-n"] + cmd
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await proc.communicate()
    return proc.returncode, stdout.decode(errors="replace"), stderr.decode(errors="replace")


def _parse_systemctl_status(output: str) -> dict:
    result = {}
    for line in output.splitlines():
        line = line.strip()
        if line.startswith("Active:"):
            result["active"] = line[len("Active:"):].strip()
            result["running"] = "active (running)" in line
        elif line.startswith("Main PID:"):
            m = re.match(r"Main PID:\s+(\d+)", line)
            if m:
                result["pid"] = int(m.group(1))
        elif line.startswith("Memory:"):
            result["memory"] = line[len("Memory:"):].strip()
        elif line.startswith("CPU:"):
            result["cpu"] = line[len("CPU:"):].strip()
        elif line.startswith("Loaded:"):
            result["loaded"] = line[len("Loaded:"):].strip()
        elif "since" in line.lower() and "Active:" not in line:
            pass
    result.setdefault("running", False)
    return result


async def get_service_status(service_name: str) -> dict:
    code, out, err = await _run_systemctl(["status", service_name, "--no-pager", "-l"])
    info = _parse_systemctl_status(out)
    info["service_name"] = service_name
    info["exit_code"] = code
    info["raw"] = out
    return info


async def service_action(service_name: str, action: str) -> tuple[bool, str]:
    allowed = {"start", "stop", "restart", "reload"}
    if action not in allowed:
        return False, f"Unknown action: {action}"
    code, out, err = await _run_systemctl([action, service_name])
    if code != 0:
        return False, (err or out).strip()
    return True, f"Service {action} successful"


async def get_service_file(service_name: str) -> str:
    code, out, err = await _run_systemctl(["cat", service_name])
    if code != 0:
        return ""
    return out
