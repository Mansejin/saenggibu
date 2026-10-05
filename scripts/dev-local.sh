#!/bin/sh
# Local dev server — test admin UI/API before pushing to main (Vercel)
#   ./scripts/dev-local.sh

set -e
ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [ ! -f .env ]; then
  cp config.example.env .env
fi

if [ ! -f .env.local ] && [ -f config.local.example.env ]; then
  echo "Tip: cp config.local.example.env .env.local  (모델 프로필·비용 실험, docs/model-cost-local.md)"
fi

python3 << 'PY'
import os, secrets
from pathlib import Path

path = Path(".env")
lines = path.read_text(encoding="utf-8").splitlines()
values = {}
order = []
for line in lines:
    if not line.strip() or line.strip().startswith("#") or "=" not in line:
        order.append(line)
        continue
    key, val = line.split("=", 1)
    key = key.strip()
    values[key] = val.strip()
    order.append(key)

changed = False
if not values.get("ADMIN_PASSWORD"):
    values["ADMIN_PASSWORD"] = "dev-local"
    changed = True
    print("  ADMIN_PASSWORD=dev-local (local test only)")
if not values.get("ADMIN_SESSION_SECRET"):
    values["ADMIN_SESSION_SECRET"] = secrets.token_urlsafe(24)
    changed = True
    print("  ADMIN_SESSION_SECRET auto-generated")

if changed:
  out = []
  seen = set()
  for item in order:
    if item in values:
      if item not in seen:
        out.append(f"{item}={values[item]}")
        seen.add(item)
    else:
      out.append(item)
  for key, val in values.items():
    if key not in seen:
      out.append(f"{key}={val}")
  path.write_text("\n".join(out) + "\n", encoding="utf-8")
PY

export SGB_HOST=127.0.0.1
export SGB_PORT="${SGB_PORT:-8787}"
export SGB_RELOAD=0
export SGB_PLAN=admin
export SGB_DEV=1
export SGB_STORE_GENERATED=1
export SGB_ALLOWED_ORIGINS="${SGB_ALLOWED_ORIGINS:-http://127.0.0.1:${SGB_PORT},http://localhost:${SGB_PORT}}"

if ! python3 -c "import fastapi" 2>/dev/null; then
  echo "Installing dependencies..."
  python3 -m pip install -q -r requirements.txt
fi

echo ""
echo "생기부 로컬 테스트 서버"
echo "  Admin UI: http://127.0.0.1:${SGB_PORT}/admin/saenggibu"
echo "  Health:   http://127.0.0.1:${SGB_PORT}/health"
echo ""
echo "  Login password (local): dev-local"
echo "  Dev demo: 검토 목록에 「2-1 99번 김테스트」(작성 완료) 자동 등록"
echo "  Model: write=Pro (3.1) · sample analysis=Pro"
echo "· Python API 수정 → 자동 재시작 (SGB_RELOAD=1)"
echo "· 운영 배포 = main push (Vercel)"
echo ""

exec python3 server.py
