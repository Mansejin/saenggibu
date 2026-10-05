#!/bin/sh
# NAS: remove ghost samples (index row exists but json + sections are empty)
#   cd /volume1/docker/saenggibu && sh scripts/nas-prune-orphan-samples.sh

set -e
ROOT="${NAS_REPO:-/volume1/docker/saenggibu}"
cd "$ROOT"
API="$(grep -E '^SGB_API_CONTAINER=' .env 2>/dev/null | tail -n 1 | cut -d= -f2 | tr -d '\r\"')"
API="${API:-saenggibu-api}"

if command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' | grep -qx "$API"; then
  docker exec "$API" python -c "
from src.saenggibu.sample_store import reconcile_sample_index, list_samples
removed = reconcile_sample_index()
print('Removed:', removed if removed else '(none)')
print('Remaining:', len(list_samples()))
"
  exit 0
fi

python3 << 'PY'
import json
import os
from pathlib import Path

samples_dir = Path(os.environ.get("NAS_SAMPLES_DIR", "/volume1/docker/saenggibu/data/saenggibu/samples"))
index_path = samples_dir / "index.json"
if not index_path.exists():
    print("ERROR: index.json not found")
    raise SystemExit(1)

def has_content(item):
    sections = item.get("sections") or {}
    if str(sections.get("행발", "")).strip():
        return True
    setuk = sections.get("세특") or {}
    if isinstance(setuk, dict) and any(str(v).strip() for v in setuk.values()):
        return True
    changche = sections.get("창체") or {}
    if isinstance(changche, dict) and any(str(v).strip() for v in changche.values()):
        return True
    return False

items = json.loads(index_path.read_text(encoding="utf-8"))
kept, removed = [], []
for item in items:
    sid = item.get("id")
    if not sid:
        removed.append("(no-id)")
        continue
    json_path = samples_dir / f"{sid}.json"
    if json_path.exists():
        try:
            kept.append(json.loads(json_path.read_text(encoding="utf-8")))
            continue
        except (json.JSONDecodeError, OSError):
            pass
    if has_content(item):
        kept.append(item)
    else:
        removed.append(sid)

if not removed:
    print("No orphan samples to remove.")
    print(f"Remaining: {len(kept)}")
    raise SystemExit(0)

print(f"Removing {len(removed)} orphan sample(s):")
for sid in removed:
    print(f"  - {sid}")
index_path.write_text(json.dumps(kept, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(f"Done. {len(kept)} left.")
PY
