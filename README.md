# saenggibu — 생기부 작성 머신

고등학교 생활기록부를 **과거 샘플 패턴 학습 + 학생 데이터 + Gemini Pro**로 자동 작성합니다. CLI(`sgb.py`)와 관리자 웹(`server.py`, `web/admin/`)을 함께 제공합니다.

> 이 저장소는 예전 `Mansejin/auto_script`에서 분리되었습니다. 디디딧 시트 CLI는 [Mansejin/auto_script](https://github.com/Mansejin/auto_script)에 남아 있습니다.

- 상세 사용법: [`docs/saenggibu.md`](docs/saenggibu.md)
- 관리자 웹·API URL은 공개 README에 적지 않습니다. 운영 환경은 `.env`와 배포 문서를 참고하세요.

## 빠른 시작

```bash
pip install -r requirements.txt
cp config.example.env .env   # GEMINI_API_KEY, ADMIN_PASSWORD 등 설정

python sgb.py init
python sgb.py samples import data/saenggibu/examples/
python sgb.py analyze
python sgb.py students import data/saenggibu/examples/students.example.tsv
python sgb.py run --yes
```

로컬 웹: `python server.py` → `http://127.0.0.1:8787/admin/saenggibu` (Windows는 `scripts\DEV-로컬테스트.bat`)

테스트: `python -m pytest -q`

## 배포

`main`에 push하면 GitHub Actions가 회사 NAS에 자동 배포합니다. → [`docs/deploy-nas-auto.md`](docs/deploy-nas-auto.md)

NAS 접속 방법은 이 저장소에 적지 않고 [Mansejin/ohola-nas](https://github.com/Mansejin/ohola-nas)(비공개) 한 곳에서만 관리합니다.

## 보안 — Git에 올리면 안 되는 것

| 항목 | 위치 | 비고 |
|------|------|------|
| API 키 | `.env`, `GEMINI_API_KEY` | `config*.example.env`는 빈 값만 |
| 관리자 비밀번호 | `.env` `ADMIN_PASSWORD` | 코드·HTML에 힌트 넣지 말 것 |
| NAS 비밀번호·SSH 키 | PC 로컬 (`ohola-nas/.env.local`, `~/.ssh/`) | GitHub Secrets로만 CI에 전달 |

커밋 전 `git status`로 `.env`가 스테이징되지 않았는지 확인하세요.

## 저장소 구조

```
sgb.py, src/saenggibu/   # 생기부 작성 엔진 + CLI
server.py, src/web/      # FastAPI 관리자 API
web/admin/               # 관리자 웹 UI
docker-compose*.yml      # API + nginx 게이트웨이 + Cloudflare 터널
scripts/                 # 로컬 개발·NAS 배포 스크립트
docs/                    # 사용·배포·운영 문서
prompts/saenggibu.md     # 작성 프롬프트
```
