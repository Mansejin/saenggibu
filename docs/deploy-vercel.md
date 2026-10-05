# 배포 — Vercel + Upstash Redis

2026-10부터 생기부 머신은 Vercel에서 돌아갑니다. 회사 NAS의 docker 배포(`p2c6d9e1`)는 삭제했습니다.

## 구성

| 항목 | 값 |
|------|-----|
| Vercel 프로젝트 | `mansejin/saenggibu` (Hobby), 함수 리전 `hnd1` (도쿄) |
| 엔트리포인트 | `app.py` → `src.web.app:app` (FastAPI 자동 감지) |
| 저장소 | Upstash Redis `saenggibu-kv` (Vercel Marketplace, 무료 플랜, `hnd1`) |
| 배포 | `main` push → Vercel Git 연동이 자동 배포. PR은 Preview 배포 |
| 도메인 DNS | Cloudflare에서 A 레코드 `76.76.21.21` (프록시 끔) |

## 데이터 저장 방식

- `src/saenggibu/datastore.py`가 `data/saenggibu/` 경로를 키로 바꿔 Redis에 저장합니다 (`sgb:students/<id>.json`). 디렉터리별 파일 목록은 `sgb-dir:<dir>` 집합에 둡니다.
- `KV_REST_API_URL`·`KV_REST_API_TOKEN`이 없으면 예전처럼 로컬 디스크를 씁니다. 로컬 개발·테스트는 그대로입니다.
- 학생·샘플·패턴·사용량은 `SGB_DATA_KEY`로 AES-GCM 암호화해 저장합니다. 이 키를 잃으면 데이터를 복구할 수 없습니다. 키는 Vercel 환경변수(Secret)에 있고, 사본은 관리자 PC의 git 제외 파일 `.env.vercel-secrets`에 있습니다.
- 로컬 `.env.local`에 Redis 키를 넣지 마세요. `config.py`가 `.env.local`을 읽기 때문에 로컬 실행이 운영 데이터를 바로 건드리게 됩니다. 필요하면 `vercel env pull .env.vercel-prod`처럼 다른 이름으로 받습니다.

## 작성 작업(job)과 5분 제한

Vercel Hobby 함수는 요청당 최대 300초입니다. 일괄 작성은 학생·항목 단위 작업 목록으로 나눠 job 파일에 진행 위치(`cursor`)를 저장합니다.

- 한 번 실행에서 180초(`SGB_JOB_BUDGET_SEC`)가 지나면 새 항목을 시작하지 않고 멈춥니다.
- 브라우저가 `GET /api/jobs/{id}`를 폴링할 때 작업이 멈춰 있으면(리스 만료) 백그라운드로 이어서 실행합니다.
- 실행 중 함수가 강제 종료되면 리스(300초)가 끝난 뒤 같은 방식으로 이어집니다.
- 로컬에서는 시간 제한 없이 한 번에 끝까지 돌립니다.

## 환경변수 (Production)

`GEMINI_API_KEY`, `ADMIN_PASSWORD`, `ADMIN_SESSION_SECRET`, `SGB_DATA_KEY` (Secret) / `GEMINI_MODEL`, `GEMINI_MODEL_FAST`, `SGB_PLAN=admin`, `SGB_COOKIE_SECURE=1`, `SGB_ALLOWED_ORIGINS` / `KV_*` (Upstash 연동이 자동 설정)

변경: `vercel env add <이름> production --force` 후 재배포 (`vercel --prod` 또는 main push).

## 운영 메모

- 로그: `vercel logs` 또는 Vercel 대시보드 → saenggibu → Logs.
- 데이터 이전 스크립트: `scripts/migrate-to-redis.py <data/saenggibu 폴더> --env-file .env.vercel-prod --env-file .env.vercel-secrets` (job은 옮기지 않음).
- NAS 시절 데이터 백업(평문)은 관리자 PC `Backups/saenggibu-nas-backup-20261005.tgz`에만 있습니다.
- Hobby 플랜은 비상업용 조건입니다. 유료 서비스로 바꾸면 Pro로 올려야 합니다.
