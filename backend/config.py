import os
import secrets
import yaml
from pathlib import Path
from typing import Optional


CONFIG_PATH = os.environ.get("NEBULA_WEB_CONFIG", "./nebula-web.config.yml")

_defaults = {
    "nebula": {
        "config_path": "/etc/nebula/config.yml",
        "certs_dir": "/etc/nebula",
        "service_name": "nebula",
        "nebula_cert_binary": "/usr/local/bin/nebula-cert",
        "nebula_binary": "/usr/local/bin/nebula",
        "use_sudo": False,
        "ca_key_path": "/etc/nebula/ca.key",
        "ca_cert_path": "/etc/nebula/ca.crt",
    },
    "server": {
        "port": 3000,
        "host": "0.0.0.0",
        "allowed_origins": ["http://localhost:3000"],
    },
    "auth": {
        "username": "admin",
        "password_hash": "",
        "jwt_secret": "",
        "token_expiry": 86400,
    },
    "database": {"path": "./nebula-web.db"},
    "logs": {
        "max_lines": 1000,
        "active_threshold_seconds": 300,
    },
}


def _deep_merge(base: dict, override: dict) -> dict:
    result = base.copy()
    for key, val in override.items():
        if key in result and isinstance(result[key], dict) and isinstance(val, dict):
            result[key] = _deep_merge(result[key], val)
        else:
            result[key] = val
    return result


def load_config() -> dict:
    cfg = _defaults.copy()
    path = Path(CONFIG_PATH)
    if path.exists():
        with open(path) as f:
            user_cfg = yaml.safe_load(f) or {}
        cfg = _deep_merge(cfg, user_cfg)

    if not cfg["auth"]["jwt_secret"]:
        cfg["auth"]["jwt_secret"] = secrets.token_hex(32)

    return cfg


def save_config(cfg: dict) -> None:
    with open(CONFIG_PATH, "w") as f:
        yaml.dump(cfg, f, default_flow_style=False, allow_unicode=True)


def is_setup_complete(cfg: dict) -> bool:
    return bool(cfg["auth"].get("password_hash"))


_cfg: Optional[dict] = None


def get_config() -> dict:
    global _cfg
    if _cfg is None:
        _cfg = load_config()
    return _cfg


def reload_config() -> dict:
    global _cfg
    _cfg = load_config()
    return _cfg
