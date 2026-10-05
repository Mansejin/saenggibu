# NAS 배포

NAS 접속 방법(어디서 어떤 SSH 별칭을 쓰는지, Tailscale, 키, sudo)은 이 저장소에 적지 않습니다.  
정본: [Mansejin/ohola-nas](https://github.com/Mansejin/ohola-nas) `README.md` (비공개).

이 문서는 생기부 머신을 NAS에 **배포하는 방법**만 다룹니다.

---

## 1. 자동 배포 (기본)

`main`에 push → GitHub Actions **Deploy to NAS** → Tailscale로 NAS SSH → `scripts/nas-docker-update.sh`.

- 워크플로: `.github/workflows/deploy-nas.yml`
- 필요한 Secrets: `TAILSCALE_AUTHKEY`, `NAS_SSH_HOST`(NAS Tailscale IP), `NAS_SSH_USER`, `NAS_SSH_KEY`  
  선택: `NAS_SSH_PORT`, `NAS_SSH_PASSPHRASE`, `NAS_REPO_PATH`
- `docs/**`, `*.md`, `prompts/**`, `.cursor/**`만 바뀐 push는 배포하지 않습니다.
- 수동 실행: Actions → **Deploy to NAS** → **Run workflow**

## 2. PC에서 즉시 배포

```powershell
ssh nas "cd /volume1/docker/saenggibu && sh scripts/nas-docker-update.sh"
```

또는 `scripts\NAS-배포.bat` 더블클릭 (같은 명령).

옵션: `--full-build`(강제 재빌드), `--no-build`, `--pull-only`, `--logs-only`

## 3. NAS 쪽 구성

| 항목 | 값 |
|------|-----|
| 경로 | `/volume1/docker/saenggibu` (실제 폴더는 난독화된 이름, 이 경로는 심볼릭 링크) |
| 컨테이너 | API · nginx 게이트웨이(8787) · Cloudflare 터널 |
| 공개 주소 | `https://sgb.mansejin.com` (Cloudflare Tunnel → 게이트웨이) |
| 헬스 | `curl -s http://127.0.0.1:8787/health` (NAS 안에서) |
| 로그 | `logs/deploy.log` |
| git | NAS에 git 패키지가 없어 `alpine/git` 컨테이너로 sync |
| docker | `sudo -n /usr/local/bin/docker` (ohola NOPASSWD) |

### NAS `.env` 배포 키

컨테이너·이미지 이름은 `.env`에서 읽습니다. 저장소 기본값은 `saenggibu-*`이고, NAS는 난독화된 이름을 씁니다.

```env
COMPOSE_PROJECT_NAME=...
SGB_API_CONTAINER=...
SGB_API_IMAGE=...:latest
SGB_GATEWAY_CONTAINER=...
SGB_TUNNEL_CONTAINER=...
SGB_DEPLOY_BRANCH=main
SGB_DOCKER_SUDO=1
```

실제 값은 NAS의 `.env`와 `ohola-nas` 폴더 매핑 표를 보세요.

## 4. 문제 해결

| 증상 | 확인 |
|------|------|
| Actions `Cannot reach NAS ... :22` | `NAS_SSH_HOST`가 NAS Tailscale IP인지, NAS가 Tailscale Online인지 |
| `no .git in ...` | `/volume1/docker/saenggibu` 링크와 실제 폴더의 `.git` 확인 |
| 컨테이너 이름 충돌 | NAS `.env`에 위 배포 키가 있는지 확인 |
| 점검 페이지가 안 꺼짐 | `rm data/saenggibu/maintenance.on` |

DSM 작업 스케줄러용 `scripts/nas-dsm-task.sh`도 있지만 현재는 쓰지 않습니다 (Actions가 기본).
