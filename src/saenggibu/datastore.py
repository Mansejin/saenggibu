"""Key-value storage for data/saenggibu: local disk by default, Upstash Redis on Vercel.

Callers keep using Path objects. With Redis, a path maps to a key relative to DATA_DIR,
and each directory keeps a set of its file names so listing works without SCAN.
"""

from __future__ import annotations

import fnmatch
import os
import shutil
from functools import lru_cache
from pathlib import Path

import httpx

from .config import DATA_DIR

KEY_PREFIX = "sgb:"
DIR_PREFIX = "sgb-dir:"


def _redis_credentials() -> tuple[str, str] | None:
    url = (os.getenv("KV_REST_API_URL") or os.getenv("UPSTASH_REDIS_REST_URL") or "").strip()
    token = (os.getenv("KV_REST_API_TOKEN") or os.getenv("UPSTASH_REDIS_REST_TOKEN") or "").strip()
    if url and token:
        return url.rstrip("/"), token
    return None


def using_redis() -> bool:
    return _redis_credentials() is not None


@lru_cache(maxsize=1)
def _client() -> httpx.Client:
    creds = _redis_credentials()
    assert creds is not None
    url, token = creds
    return httpx.Client(base_url=url, headers={"Authorization": f"Bearer {token}"}, timeout=15.0)


def _pipeline(*commands: list[str]) -> list[object]:
    response = _client().post("/pipeline", json=list(commands))
    response.raise_for_status()
    results: list[object] = []
    for item in response.json():
        if "error" in item:
            raise RuntimeError(f"Redis error: {item['error']}")
        results.append(item.get("result"))
    return results


def _rel(path: Path) -> str:
    try:
        return path.resolve().relative_to(DATA_DIR.resolve()).as_posix()
    except ValueError:
        return path.as_posix()


def _split(rel: str) -> tuple[str, str]:
    parent, _, name = rel.rpartition("/")
    return parent, name


def exists(path: Path) -> bool:
    if not using_redis():
        return path.exists()
    return bool(_pipeline(["EXISTS", KEY_PREFIX + _rel(path)])[0])


def read_text(path: Path) -> str:
    if not using_redis():
        return path.read_text(encoding="utf-8")
    value = _pipeline(["GET", KEY_PREFIX + _rel(path)])[0]
    if value is None:
        raise FileNotFoundError(str(path))
    return str(value)


def read_many(paths: list[Path]) -> dict[Path, str | None]:
    if not paths:
        return {}
    if not using_redis():
        result: dict[Path, str | None] = {}
        for path in paths:
            try:
                result[path] = path.read_text(encoding="utf-8")
            except OSError:
                result[path] = None
        return result
    values = _pipeline(["MGET", *(KEY_PREFIX + _rel(path) for path in paths)])[0] or []
    return {path: (None if value is None else str(value)) for path, value in zip(paths, values)}


def write_text(path: Path, text: str) -> None:
    if not using_redis():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
        return
    rel = _rel(path)
    parent, name = _split(rel)
    _pipeline(["SET", KEY_PREFIX + rel, text], ["SADD", DIR_PREFIX + parent, name])


def delete(path: Path) -> None:
    if not using_redis():
        path.unlink(missing_ok=True)
        return
    rel = _rel(path)
    parent, name = _split(rel)
    _pipeline(["DEL", KEY_PREFIX + rel], ["SREM", DIR_PREFIX + parent, name])


def list_files(directory: Path, pattern: str = "*") -> list[Path]:
    if not using_redis():
        if not directory.is_dir():
            return []
        return sorted(p for p in directory.glob(pattern) if p.is_file())
    names = _pipeline(["SMEMBERS", DIR_PREFIX + _rel(directory)])[0] or []
    return sorted(directory / str(name) for name in names if fnmatch.fnmatch(str(name), pattern))


def delete_tree(directory: Path) -> None:
    if not using_redis():
        if directory.exists():
            shutil.rmtree(directory, ignore_errors=True)
        return
    rel = _rel(directory)
    names = _pipeline(["SMEMBERS", DIR_PREFIX + rel])[0] or []
    commands = [["DEL", f"{KEY_PREFIX}{rel}/{name}"] for name in names]
    commands.append(["DEL", DIR_PREFIX + rel])
    _pipeline(*commands)


def ensure_dir(directory: Path) -> None:
    if not using_redis():
        directory.mkdir(parents=True, exist_ok=True)
