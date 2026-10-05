# AGENTS.md

## Cursor Cloud specific instructions

This repo hosts the 생기부 (saenggibu) writing machine with two entry points:

- **생기부 admin web app** (main product): FastAPI + uvicorn. Run with `python3 server.py` → serves `http://127.0.0.1:8787` (UI at `/admin/saenggibu`, health at `/health`). Static UI is under `web/admin`.
- **`sgb.py`**: 생기부 (saenggibu) writing CLI (`init`, `samples import`, `analyze`, `students import`, `run`).

The 디디딧 Google Sheets CLI used to live here; it moved to `Mansejin/auto_script`.

### NAS deploy

- Deploy = push to `main` (GitHub Actions). Details: `docs/deploy-nas-auto.md`.
- How to reach the NAS (SSH aliases, Tailscale, office vs home) is documented only in the private repo `Mansejin/ohola-nas`. Do not add NAS connection docs here.

### Setup / run notes

- Dependencies come from `requirements.txt`. **`pytest` is NOT in `requirements.txt`** but the test suite needs it — the startup update script installs it. Run tests with `python3 -m pytest -q` (73 tests, all pass without any credentials).
- pip installs to `~/.local/bin`; add it to PATH if you need the `pytest`/`uvicorn` console scripts, otherwise use `python3 -m ...`.
- The web app and both CLIs need a `.env`. Copy `config.example.env` → `.env`. For local dev, `ADMIN_PASSWORD` defaults to `dev-local` and you must set a non-empty `ADMIN_SESSION_SECRET` (login returns 503 if it's missing). `scripts/dev-local.sh` auto-fills both if absent.
- **`GEMINI_API_KEY` is optional**: only the AI writing step (`sgb.py run`, `/api/run/async`) needs it. Everything else — login, students/samples CRUD, import/export, analyze (local stats), inspector — works without it.
- The web app and `sgb.py` share the same `data/saenggibu/` data dir, so a student created via the API shows up in `sgb.py students list` and vice versa.
- Login flow: `POST /api/auth/login` with `{"password": "<ADMIN_PASSWORD>"}` returns a bearer token; pass it as `Authorization: Bearer <token>` to the other `/api/...` endpoints.
- Docker Compose (`docker-compose.yml`) fronts the API with an nginx gateway on port 8787; not needed for local dev — `python3 server.py` is enough.

### Test gotcha (non-obvious)

- The inspector's volume limits are **data-dependent**: `get_volume_limits` reads `data/saenggibu/patterns.json`. Running `sgb.py analyze` (or the web `analyze`) writes that file with sample-derived limits, which can shrink `행발` max and make `tests/test_inspector.py::test_inspect_student_ok_clean_text` fail. `data/saenggibu/{patterns.json,samples,students,outputs}` are gitignored demo/runtime state — delete them to restore the clean state the tests expect before running `python3 -m pytest`.
