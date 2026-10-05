#!/usr/bin/env python3
"""Upload a local data/saenggibu copy into the Upstash Redis datastore (encrypted).

Usage:
  python scripts/migrate-to-redis.py <source data/saenggibu dir> --env-file .env.vercel-prod --env-file .env.vercel-secrets

Requires KV_REST_API_URL, KV_REST_API_TOKEN and SGB_DATA_KEY. Jobs are not migrated.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("--env-file", action="append", default=[])
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    for env_file in args.env_file:
        load_dotenv(env_file, override=True)

    from src.saenggibu import datastore
    from src.saenggibu.config import DATA_DIR
    from src.saenggibu.data_crypto import decrypt_json, encrypt_data_enabled
    from src.saenggibu.secure_io import save_secure_json

    if not datastore.using_redis():
        print("KV_REST_API_URL / KV_REST_API_TOKEN not set", file=sys.stderr)
        return 1
    if not encrypt_data_enabled():
        print("SGB_DATA_KEY not set; refusing to upload plaintext", file=sys.stderr)
        return 1

    source: Path = args.source.resolve()
    files = [
        path
        for path in sorted(source.rglob("*.json"))
        if path.relative_to(source).parts[0] in ("students", "samples", "outputs")
        or path.relative_to(source).as_posix() in ("patterns.json", "usage.json")
    ]
    counts: dict[str, int] = {}
    copied_as_is: list[str] = []
    for path in files:
        rel = path.relative_to(source)
        raw = path.read_text(encoding="utf-8")
        try:
            data = json.loads(raw)
            if isinstance(data, dict) and data.get("__enc"):
                data = decrypt_json(data)
        except Exception:
            # Unreadable for the app as well (corrupt, or encrypted with a lost key): keep the bytes.
            copied_as_is.append(rel.as_posix())
            if not args.dry_run:
                datastore.write_text(DATA_DIR / rel, raw)
            continue
        if not args.dry_run:
            save_secure_json(DATA_DIR / rel, data)
        counts[rel.parts[0]] = counts.get(rel.parts[0], 0) + 1

    for group, count in sorted(counts.items()):
        print(f"{group}: {count} encrypted with SGB_DATA_KEY")
    if copied_as_is:
        groups: dict[str, int] = {}
        for rel in copied_as_is:
            groups[rel.split("/")[0]] = groups.get(rel.split("/")[0], 0) + 1
        print(f"copied unreadable files as-is: {groups}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
