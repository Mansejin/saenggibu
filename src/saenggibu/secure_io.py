from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from . import datastore
from .data_crypto import decrypt_json, encrypt_data_enabled, encrypt_json


def _decode(raw: str) -> Any:
    data = json.loads(raw)
    if isinstance(data, dict) and data.get("__enc"):
        return decrypt_json(data)
    return data


def load_secure_json(path: Path) -> Any:
    return _decode(datastore.read_text(path))


def load_secure_json_file(path: Path) -> Any:
    """Read an uploaded file from local disk, bypassing the datastore."""
    return _decode(path.read_text(encoding="utf-8"))


def save_secure_json(path: Path, data: Any) -> None:
    payload = encrypt_json(data) if encrypt_data_enabled() else data
    datastore.write_text(path, json.dumps(payload, ensure_ascii=False, indent=2))
