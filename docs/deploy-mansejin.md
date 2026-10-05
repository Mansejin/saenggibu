# mansejin.com에서 생기부 관리자 쓰기

**관리자 화면**은 `mansejin.com` (GitHub Pages)에 있고, **실제 작업**은 나스 API가 합니다.  
둘 다 연결되어야 `https://mansejin.com/admin/saenggibu/` 에서 로그인·작성이 됩니다.

---

## 최종 주소

| 주소 | 역할 |
|------|------|
| https://mansejin.com/admin/saenggibu/ | 관리자 화면 (카톡 공유 가능) |
| https://sgb.mansejin.com | API 서버 (화면이 호출하는 백엔드) |

---

## 1단계: 나스 API 실행 (이미 했다면 건너뛰기)

`docker/saenggibu/` 에 `.env` 설정 후:

```bash
docker compose up -d --build
```

집 안에서 확인:

```
http://ohola.synology.me:8787/health
```

`{"status":"ok"}` 가 보이면 API는 정상입니다.

---

## 2단계: API를 인터넷에 공개 (HTTPS)

mansejin.com 페이지는 **https** API만 호출합니다.  
ipTIME에 접속할 수 없을 때는 **Cloudflare Tunnel**을 씁니다 (포트포워딩 불필요).

### A. Cloudflare Tunnel (추천 — 집 밖에서도 DSM만으로 설정 가능)

1. https://one.dash.cloudflare.com 가입 (무료)
2. **Networks** → **Tunnels** → **Create a tunnel**
3. 이름: `sgb-api` → **Docker** 선택
4. **Public Hostname** 추가:
   - Subdomain: `sgb`
   - Domain: `mansejin.com` (목록에 없으면 아래 DNS만 수동 추가)
   - Service: `http://sgb-gateway:8787`
5. 표시되는 **토큰** 복사 → 나스 `.env`에 추가:

```env
CLOUDFLARE_TUNNEL_TOKEN=eyJhIjoi...
```

6. 나스에서 터널 컨테이너 실행:

```bash
cd /volume1/docker/saenggibu
docker compose -f docker-compose.yml -f docker-compose.cloudflare.yml up -d
```

7. **가비아 DNS** (도메인이 Cloudflare가 아닐 때):
   - 타입 **CNAME**, 호스트 `sgb`, 값 `xxxx.cfargotunnel.com` (대시보드에 표시)
8. 몇 분 후 확인:

```
https://sgb.mansejin.com/health
```

`{"status":"ok"}` 나오면 성공.

### B. 시놀로지 역방향 프록시 (집에 가서 ipTIME·443 설정 가능할 때)

[`docs/deploy-synology.md`](deploy-synology.md) 4단계 참고 — `sgb.mansejin.com` → `localhost:8787`

---

## 3단계: .env CORS 확인

나스 `.env`:

```env
SGB_ALLOWED_ORIGINS=https://mansejin.com,https://www.mansejin.com
```

변경 후 `docker compose restart`

---

## 4단계: mansejin.com 주소 연결

**css/js 복사는 더 이상 필요 없습니다.**

`mansejin.com/admin/saenggibu/` → 자동으로 `https://sgb.mansejin.com/admin/saenggibu` 로 이동합니다.

### 한 번만 (둘 중 하나)

**A. 자동 (추천)** — GitHub `saenggibu` → Settings → Secrets → `TOOLS_SITE_PAT`  
(본인 GitHub 토큰, `tools-site` 쓰기 권한)  
이후 `saenggibu` push마다 redirect 페이지가 tools-site에 자동 반영됩니다.

**B. 수동 1회** — `deploy/tools-site-admin/admin/saenggibu/index.html` **한 파일만** tools-site에 push

### 이후 업데이트

UI·업로드 기능 변경은 **나스만** pull + `docker compose up -d --build` 하면 됩니다.

북마크/카톡 공유: `https://mansejin.com/admin/saenggibu/` 또는 `https://sgb.mansejin.com/admin/saenggibu` 둘 다 OK.

---

## 업데이트 방법

### API (나스)

`main`에 push하면 GitHub Actions가 자동 배포합니다. 수동 배포·NAS 설정은 [docs/deploy-nas-auto.md](deploy-nas-auto.md).

NAS 접속 방법(SSH 별칭, Tailscale, 키)은 [Mansejin/ohola-nas](https://github.com/Mansejin/ohola-nas)(비공개) 한 곳에만 정리합니다.

### 관리자 화면 (saenggibu → tools-site)

```bash
./scripts/sync-tools-site-admin.sh
# tools-site 저장소에서 commit & push
```

---

## 문제 해결

| 증상 | 원인 | 해결 |
|------|------|------|
| 흰 화면만 보임 | CSS/JS 경로 오류 또는 페이지 미배포 | tools-site에 `admin/saenggibu/` 배포 확인 |
| 로그인 폼은 보이는데 로그인 실패 | API 미실행 또는 주소 오류 | `https://sgb.mansejin.com/health` 확인 |
| "API 서버에 연결할 수 없습니다" | 터널·역방향 프록시 미설정 | 2단계 Tunnel 또는 역방향 프록시 |
| 로그인은 되는데 목록 안 뜸 | CORS | `.env`의 `SGB_ALLOWED_ORIGINS` 확인 |
| 카톡에서만 이상 | 인앱 브라우저 | **Safari/Chrome에서 열기** |

---

## 체크리스트

```
□ http://나스:8787/health OK
□ https://sgb.mansejin.com/health OK
□ .env SGB_ALLOWED_ORIGINS 에 mansejin.com
□ tools-site admin/saenggibu 배포됨
□ https://mansejin.com/admin/saenggibu/ 로그인 성공
```
