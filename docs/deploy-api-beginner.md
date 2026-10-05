# 생기부 API 배포 — 완전 초보용 가이드

백엔드 지식 없어도 됩니다. **순서대로만** 따라 하세요.

---

## 한 줄 요약

| 무엇 | 어디에 | 역할 |
|------|--------|------|
| **관리자 화면** | mansejin.com/admin/saenggibu | 버튼 누르는 웹페이지 (GitHub Pages) |
| **API 서버** | 별도로 24시간 켜 둘 곳 | 비밀번호 확인, Gemini 호출, 학생 데이터 저장 |

mansejin.com은 **화면만** 있고, **실제 작업은 API 서버**가 합니다.  
그래서 API를 어딘가에 **켜 두어야** 합니다.

---

## 로그인은 어떻게 동작하나? (몰라도 됨)

1. 관리자 페이지에서 **비밀번호** 입력
2. 그 비밀번호가 **API 서버**로 전송됨
3. 서버가 `.env`에 적어 둔 `ADMIN_PASSWORD`와 비교
4. 맞으면 **통행증(token)** 을 브라우저에 잠깐 저장 (24시간)
5. 이후 샘플 업로드·작성 요청은 통행증이 있을 때만 처리

**당신이 할 일**: `.env`에 비밀번호 두 줄만 적어 두면 됩니다.  
나머지(토큰, 암호화)는 코드가 알아서 합니다.

---

## 준비물 체크리스트

- [ ] 이 프로젝트 (`saenggibu`) 폴더
- [ ] [Gemini API 키](https://aistudio.google.com/apikey) (무료 발급)
- [ ] 관리자용 비밀번호 (본인만 아는 긴 문자열)
- [ ] (mansejin 연동 시) tools-site에 admin 페이지 반영

---

## 0단계: 로컬에서 먼저 테스트 (5분)

배포 전에 **내 PC에서만** 돌려 보세요.

### 1) `.env` 파일 만들기

프로젝트 폴더에서:

```powershell
copy config.example.env .env
```

`.env`를 열고 **아래 3줄만** 채우세요:

```env
GEMINI_API_KEY=여기에_제미나이_키
ADMIN_PASSWORD=내가쓸관리자비번123!
ADMIN_SESSION_SECRET=아무랜덤긴문자열32자이상적어도됨
```

`ADMIN_SESSION_SECRET`은 아무 긴 문장이나 됩니다. 예: `mansejin-sgb-2026-xK9mP2qR7vL4nW8`

### 2) 패키지 설치 & 서버 실행

```powershell
pip install -r requirements.txt
python server.py
```

### 3) 브라우저에서 열기

```
http://127.0.0.1:8787/admin/saenggibu
```

`.env`에 적은 `ADMIN_PASSWORD`로 로그인 → 학생/샘플 탭이 보이면 **성공**.

여기까지 되면 API는 정상입니다. 이제 “인터넷에서 mansejin.com이 이 API에 접속”하게만 하면 됩니다.

---

## 배포 방법 선택

| 방법 | 난이도 | 비용 | 추천 상황 |
|------|--------|------|-----------|
| **A. 로컬만** | ★☆☆ | 무료 | 혼자 PC에서만 쓸 때 |
| **B. NAS (Docker)** | ★★☆ | 무료(전기만) | **나스 있으면 최우선** — 24시간, 데이터 나스 저장 |
| **C. Cloudflare Tunnel** | ★★☆ | 무료 | 집 PC 켜 둘 때 |
| **D. Railway** | ★★☆ | 소액/무료티어 | 나스·PC 없을 때 |

> 나스가 있으면 → [`docs/deploy-nas.md`](deploy-nas.md) 먼저 보세요.

---

## A. 로컬만 (mansejin 연동 없음)

- `python server.py` 실행한 상태에서만 사용
- 주소: `http://127.0.0.1:8787/admin/saenggibu`
- **장점**: 설정 제일 쉬움  
- **단점**: PC 끄면 접속 불가, mansejin.com 페이지와 연동 안 됨

---

## B. Cloudflare Tunnel (집 PC + 무료 HTTPS) — 추천

PC에서 서버를 돌리면서, **https://sgb.mansejin.com** 같은 주소로 밖에서 접속하게 합니다.

### B-1. Cloudflare에 도메인 연결

`mansejin.com`이 이미 Cloudflare DNS를 쓰고 있다면 그대로 진행.  
아니면 [Cloudflare](https://dash.cloudflare.com) 가입 후 도메인 추가.

### B-2. cloudflared 설치

Windows: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/

### B-3. 터널 만들기 (대시보드)

1. Cloudflare Zero Trust → **Networks** → **Tunnels** → Create tunnel
2. 이름: `sgb-api`
3. Public hostname 추가:
   - Subdomain: `sgb` (또는 `sgb-api`)
   - Domain: `mansejin.com`
   - Service: `http://localhost:8787`
4. 설치 명령(copy)을 PC에서 실행

### B-4. PC에서 항상 이렇게 실행

터미널 1:

```powershell
cd saenggibu폴더
python server.py
```

터널은 Cloudflare가 백그라운드 서비스로 돌리거나, 터미널 2에서 cloudflared 실행.

### B-5. mansejin.com 페이지 연결

`tools-site`의 `admin/saenggibu/index.html`:

```html
<body data-api-base="https://sgb.mansejin.com">
```

`.env`의 `SGB_ALLOWED_ORIGINS`에 추가:

```env
SGB_ALLOWED_ORIGINS=https://mansejin.com,https://www.mansejin.com,https://sgb.mansejin.com
```

### B-6. 확인

1. 브라우저에서 `https://sgb.mansejin.com/health` → `{"status":"ok"}`
2. `https://mansejin.com/admin/saenggibu/` → 로그인 → 학생 목록 로드

---

## C. Railway (클라우드 24시간)

PC를 안 켜도 됩니다. Docker로 올립니다.

### C-1. Railway 가입

https://railway.app — GitHub로 로그인

### C-2. 새 프로젝트

1. **Deploy from GitHub repo** → `Mansejin/saenggibu` 선택
2. 브랜치: `main`

### C-3. 환경 변수 (Railway Variables)

| 이름 | 값 |
|------|-----|
| `GEMINI_API_KEY` | 제미나이 키 |
| `ADMIN_PASSWORD` | 관리자 비밀번호 |
| `ADMIN_SESSION_SECRET` | 랜덤 긴 문자열 |
| `SGB_HOST` | `0.0.0.0` |
| `SGB_PORT` | `8787` |
| `SGB_ALLOWED_ORIGINS` | `https://mansejin.com,https://www.mansejin.com` |

### C-4. 도메인

Railway가 `https://xxxx.up.railway.app` 주소를 줍니다.  
이 주소를 `admin/saenggibu/index.html`의 `data-api-base`에 넣습니다.

(원하면 Custom Domain으로 `sgb.mansejin.com` 연결 가능)

---

## mansejin.com 관리자 페이지 올리기

API 주소를 정한 뒤:

1. `deploy/tools-site-admin/admin/` 폴더를 **tools-site** 저장소에 복사
2. `admin/saenggibu/index.html`의 `data-api-base`를 API HTTPS 주소로 수정
3. tools-site push → GitHub Pages 자동 배포
4. 접속: **https://mansejin.com/admin/saenggibu/** (메뉴에는 없음, URL 직접 입력)

`robots.txt`에 `Disallow: /admin/` 추가 (검색엔진 차단).

---

## 자주 하는 실수

| 증상 | 원인 | 해결 |
|------|------|------|
| 로그인 안 됨 | `ADMIN_PASSWORD` 틀림 / 서버 미실행 | `.env` 확인, `python server.py` 실행 |
| 로그인은 되는데 목록 안 불러옴 | `data-api-base` 주소 틀림 | HTTPS 주소, 끝에 `/` 없이 |
| CORS 오류 (브라우저 콘솔) | `SGB_ALLOWED_ORIGINS`에 mansejin.com 없음 | `.env`에 도메인 추가 후 서버 재시작 |
| 작성 시 오류 | `GEMINI_API_KEY` 없음/잘못됨 | AI Studio에서 키 재발급 |
| PC 끄면 접속 안 됨 | Tunnel/Railway 안 씀 | B 또는 C 방법 사용 |

---

## 보안 (최소한만)

1. `ADMIN_PASSWORD` — 생기부랑 비슷하게 **추측 어려운** 비밀번호
2. `.env` 파일 — **절대 GitHub에 올리지 말 것** (이미 .gitignore 됨)
3. `GEMINI_API_KEY` — API 서버에만 두기 (mansejin.com HTML에 넣지 말 것)
4. 관리자 URL — 카톡/공개 게시글에 올리지 말 것

---

## 당신이 지금 당장 할 일 (순서)

```
1. copy config.example.env .env  →  키 3개 채우기
2. pip install -r requirements.txt
3. python server.py
4. http://127.0.0.1:8787/admin/saenggibu  로그인 테스트
5. (성공하면) Cloudflare Tunnel 또는 Railway 중 하나 선택
6. API HTTPS 주소를 tools-site admin 페이지에 연결
7. https://mansejin.com/admin/saenggibu/ 에서 최종 테스트
```

막히는 단계 번호를 알려주시면 그 단계만 캡처 없이도 따라 할 수 있게 더 짧게 적어 드리겠습니다.
